import { randomUUID } from "node:crypto";
import { data } from "react-router";
import type { Redis } from "ioredis";
import { env } from "~/.server/env";
import { logger } from "~/.server/logger";
import { getRedis } from "~/.server/redis";
import { withTimeout } from "~/.server/timeout";

export interface RateLimitRule {
    name: string;
    limit: number;
    windowMs: number;
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
}

export interface RateLimitStore {
    /** Counts this request and says whether it is within the limit. A refused request isn't counted. */
    hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitResult>;
    /** Says whether the limit is already reached, without counting anything. */
    peek(key: string, rule: RateLimitRule, now: number): Promise<RateLimitResult>;
}

const MINUTE = 60_000;

export const RULES = {
    login: { name: "login", limit: 20, windowMs: 15 * MINUTE },
    // Counts only failed sign-ins, so someone can't lock a person out by hammering their address.
    loginFailures: { name: "login-failures", limit: 10, windowMs: 15 * MINUTE },
    signup: { name: "signup", limit: 5, windowMs: 60 * MINUTE },
    analysis: { name: "analysis", limit: 10, windowMs: 60 * MINUTE },
} satisfies Record<string, RateLimitRule>;

// Counts requests in the last `windowMs`, not in a calendar bucket, so a burst can't be doubled across a boundary.
// A request that is refused isn't counted, so hammering the endpoint doesn't extend the lockout.
export class MemoryRateLimitStore implements RateLimitStore {
    private hits = new Map<string, number[]>();

    private recent(key: string, rule: RateLimitRule, now: number) {
        const recent = (this.hits.get(key) ?? []).filter((t) => t > now - rule.windowMs);
        this.hits.set(key, recent);
        return recent;
    }

    async hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitResult> {
        const recent = this.recent(key, rule, now);
        if (recent.length >= rule.limit) return { allowed: false, remaining: 0, retryAfterMs: recent[0] + rule.windowMs - now };

        recent.push(now);
        return { allowed: true, remaining: rule.limit - recent.length, retryAfterMs: 0 };
    }

    async peek(key: string, rule: RateLimitRule, now: number): Promise<RateLimitResult> {
        const recent = this.recent(key, rule, now);
        if (recent.length >= rule.limit) return { allowed: false, remaining: 0, retryAfterMs: recent[0] + rule.windowMs - now };
        return { allowed: true, remaining: rule.limit - recent.length, retryAfterMs: 0 };
    }
}

export class RedisRateLimitStore implements RateLimitStore {
    constructor(private redis: () => Redis = getRedis) {}

    async hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitResult> {
        const redis = this.redis();
        const member = `${now}-${randomUUID()}`;

        const results = await redis
            .multi()
            .zremrangebyscore(key, 0, now - rule.windowMs)
            .zadd(key, now, member)
            .zcard(key)
            .zrange(key, "0", "0")
            .pexpire(key, rule.windowMs)
            .exec();

        const count = Number(results?.[2]?.[1]);
        // Members are "<time>-<id>", so the oldest one says when the window frees up.
        const oldest = Number((results?.[3]?.[1] as string[] | undefined)?.[0]?.split("-")[0] ?? now);

        if (count > rule.limit) {
            await redis.zrem(key, member);
            return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, oldest + rule.windowMs - now) };
        }
        return { allowed: true, remaining: rule.limit - count, retryAfterMs: 0 };
    }

    async peek(key: string, rule: RateLimitRule, now: number): Promise<RateLimitResult> {
        const results = await this.redis().multi().zremrangebyscore(key, 0, now - rule.windowMs).zcard(key).zrange(key, "0", "0").exec();

        const count = Number(results?.[1]?.[1]);
        const oldest = Number((results?.[2]?.[1] as string[] | undefined)?.[0]?.split("-")[0] ?? now);
        if (count >= rule.limit) return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, oldest + rule.windowMs - now) };
        return { allowed: true, remaining: rule.limit - count, retryAfterMs: 0 };
    }
}

export interface RateLimitCheck {
    rule: RateLimitRule;
    /** What is being limited: an IP, an email, a user id. Skipped when undefined. */
    subject: string | undefined;
}

interface Deps {
    store?: RateLimitStore;
    now?: () => number;
    enabled?: boolean;
    multiplier?: number;
}

let defaultStore: RateLimitStore = new RedisRateLimitStore();

/** Swaps the store the routes use. For tests. */
export const setRateLimitStore = (store: RateLimitStore) => void (defaultStore = store);

function settings(deps: Deps) {
    return { store: deps.store ?? defaultStore, now: deps.now ?? Date.now, enabled: deps.enabled ?? env().RATE_LIMIT_ENABLED, multiplier: deps.multiplier ?? env().RATE_LIMIT_MULTIPLIER };
}

// If the limiter itself is down, let the request through: an outage in Redis shouldn't also lock everyone out.
async function attempt(method: "hit" | "peek", { rule, subject }: RateLimitCheck, deps: Deps): Promise<RateLimitResult | null> {
    const { store, now, enabled, multiplier } = settings(deps);
    if (!enabled || !subject) return null;

    const scaled = { ...rule, limit: Math.max(1, Math.round(rule.limit * multiplier)) };
    try {
        const result = await withTimeout(store[method](`rl:${rule.name}:${subject}`, scaled, now()), 500, "rate limit");
        if (!result.allowed) logger.warn({ rule: rule.name, retryAfterMs: result.retryAfterMs }, "rate limit exceeded");
        return result.allowed ? null : result;
    } catch (err) {
        logger.warn({ err, rule: rule.name }, "rate limiter unavailable, allowing the request");
        return null;
    }
}

/** Counts each request and returns the first limit that is exceeded, if any. */
export async function checkRateLimits(checks: RateLimitCheck[], deps: Deps = {}): Promise<RateLimitResult | null> {
    for (const check of checks) {
        const refused = await attempt("hit", check, deps);
        if (refused) return refused;
    }
    return null;
}

/** Whether a limit is already used up, without counting this request. */
export const peekRateLimit = (check: RateLimitCheck, deps: Deps = {}) => attempt("peek", check, deps);

/** Counts an event (like a failed sign-in) without deciding anything about it. */
export async function recordHit(check: RateLimitCheck, deps: Deps = {}): Promise<void> {
    await attempt("hit", check, deps);
}

export function tooManyRequests(result: RateLimitResult) {
    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    const wait = seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;

    return data({ error: `Too many attempts. Try again in ${wait}.` }, { status: 429, headers: { "Retry-After": String(seconds) } });
}
