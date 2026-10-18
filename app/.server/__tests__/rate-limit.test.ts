import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
    MemoryRateLimitStore,
    RULES,
    RedisRateLimitStore,
    checkRateLimits,
    peekRateLimit,
    recordHit,
    tooManyRequests,
    type RateLimitRule,
    type RateLimitStore,
} from "../rate-limit";

const SECOND = 1000;
const rule: RateLimitRule = { name: "test", limit: 3, windowMs: 30 * SECOND };

const redisUrl = process.env.TEST_REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl) : undefined;
afterAll(() => redis?.quit());

const stores: [string, () => RateLimitStore][] = [["in memory", () => new MemoryRateLimitStore()]];
if (redis) stores.push(["Redis", () => new RedisRateLimitStore(() => redis)]);

describe.each(stores)("rate limit store (%s)", (_name, make) => {
    const fresh = () => ({ store: make(), key: `rl:test:${randomUUID()}` });

    it("allows requests up to the limit, then refuses", async () => {
        const { store, key } = fresh();

        const results = [];
        for (let i = 0; i < 4; i++) results.push(await store.hit(key, rule, 1000 + i));

        expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
        expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    });

    it("says how long until the oldest request leaves the window", async () => {
        const { store, key } = fresh();
        const t0 = 10_000;
        await store.hit(key, rule, t0);
        await store.hit(key, rule, t0 + 5 * SECOND);
        await store.hit(key, rule, t0 + 10 * SECOND);

        const refused = await store.hit(key, rule, t0 + 12 * SECOND);

        expect(refused).toMatchObject({ allowed: false, retryAfterMs: 18 * SECOND });
    });

    it("slides: a request is allowed again as soon as the oldest one ages out", async () => {
        const { store, key } = fresh();
        const t0 = 10_000;
        for (const offset of [0, 10, 20]) await store.hit(key, rule, t0 + offset * SECOND);

        expect((await store.hit(key, rule, t0 + 25 * SECOND)).allowed).toBe(false);
        expect((await store.hit(key, rule, t0 + 31 * SECOND)).allowed).toBe(true);
        expect((await store.hit(key, rule, t0 + 32 * SECOND)).allowed).toBe(false);
    });

    it("doesn't count refused requests, so hammering doesn't extend the lockout", async () => {
        const { store, key } = fresh();
        const t0 = 10_000;
        for (const offset of [0, 1, 2]) await store.hit(key, rule, t0 + offset * SECOND);

        const early = await store.hit(key, rule, t0 + 3 * SECOND);
        for (let i = 4; i < 20; i++) await store.hit(key, rule, t0 + i * SECOND);
        const late = await store.hit(key, rule, t0 + 20 * SECOND);

        expect(early.retryAfterMs).toBe(27 * SECOND);
        expect(late.retryAfterMs).toBe(10 * SECOND);
        expect((await store.hit(key, rule, t0 + 31 * SECOND)).allowed).toBe(true);
    });

    it("keeps different keys apart", async () => {
        const { store, key } = fresh();
        for (let i = 0; i < 3; i++) await store.hit(key, rule, 1000);

        expect((await store.hit(key, rule, 1001)).allowed).toBe(false);
        expect((await store.hit(`${key}:other`, rule, 1001)).allowed).toBe(true);
    });

    it("peeks without counting", async () => {
        const { store, key } = fresh();
        await store.hit(key, rule, 1000);

        for (let i = 0; i < 10; i++) expect((await store.peek(key, rule, 1001)).allowed).toBe(true);
        expect((await store.peek(key, rule, 1001)).remaining).toBe(2);
    });

    it("peeks as blocked once the limit is used up, and as free again after the window", async () => {
        const { store, key } = fresh();
        for (let i = 0; i < 3; i++) await store.hit(key, rule, 1000);

        expect(await store.peek(key, rule, 2000)).toMatchObject({ allowed: false, retryAfterMs: 29 * SECOND });
        expect((await store.peek(key, rule, 1000 + 31 * SECOND)).allowed).toBe(true);
    });

    it("lets exactly the limit through when requests arrive at once", async () => {
        const { store, key } = fresh();

        const results = await Promise.all(Array.from({ length: 20 }, () => store.hit(key, rule, 5000)));

        expect(results.filter((r) => r.allowed)).toHaveLength(3);
    });
});

describe("checkRateLimits", () => {
    const deps = (over = {}) => ({ store: new MemoryRateLimitStore(), now: () => 1000, enabled: true, multiplier: 1, ...over });

    it("returns null while within the limits", async () => {
        expect(await checkRateLimits([{ rule, subject: "a" }], deps())).toBeNull();
    });

    it("returns the result of the first limit that is exceeded", async () => {
        const d = deps();
        for (let i = 0; i < 3; i++) await checkRateLimits([{ rule, subject: "a" }], d);

        const refused = await checkRateLimits([{ rule: RULES.signup, subject: "a" }, { rule, subject: "a" }], d);

        expect(refused).toMatchObject({ allowed: false });
    });

    it("skips a check with no subject, such as an unknown IP", async () => {
        const d = deps();
        for (let i = 0; i < 10; i++) expect(await checkRateLimits([{ rule, subject: undefined }], d)).toBeNull();
    });

    it("does nothing when rate limiting is turned off", async () => {
        const d = deps({ enabled: false });
        for (let i = 0; i < 10; i++) expect(await checkRateLimits([{ rule, subject: "a" }], d)).toBeNull();
    });

    it("scales every limit by the multiplier, never below one", async () => {
        const doubled = deps({ multiplier: 2 });
        const results = [];
        for (let i = 0; i < 7; i++) results.push((await checkRateLimits([{ rule, subject: "a" }], doubled)) === null);
        expect(results).toEqual([true, true, true, true, true, true, false]);

        const tiny = deps({ multiplier: 0.01 });
        expect(await checkRateLimits([{ rule, subject: "b" }], tiny)).toBeNull();
        expect(await checkRateLimits([{ rule, subject: "b" }], tiny)).not.toBeNull();
    });

    it("lets requests through when the limiter itself fails, instead of locking everyone out", async () => {
        const broken: RateLimitStore = {
            hit: vi.fn().mockRejectedValue(new Error("redis down")),
            peek: vi.fn().mockRejectedValue(new Error("redis down")),
        };

        expect(await checkRateLimits([{ rule, subject: "a" }], deps({ store: broken }))).toBeNull();
        expect(await peekRateLimit({ rule, subject: "a" }, deps({ store: broken }))).toBeNull();
    });

    it("lets requests through when the limiter hangs", async () => {
        const hanging: RateLimitStore = { hit: () => new Promise(() => {}), peek: () => new Promise(() => {}) };
        const started = Date.now();

        expect(await checkRateLimits([{ rule, subject: "a" }], deps({ store: hanging }))).toBeNull();
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it("counts events with recordHit, and peekRateLimit sees them", async () => {
        const d = deps();
        const check = { rule, subject: "a" };

        expect(await peekRateLimit(check, d)).toBeNull();
        for (let i = 0; i < 3; i++) await recordHit(check, d);

        expect(await peekRateLimit(check, d)).toMatchObject({ allowed: false });
    });
});

describe("tooManyRequests", () => {
    it("is a 429 with a Retry-After header", () => {
        const response = tooManyRequests({ allowed: false, remaining: 0, retryAfterMs: 20_000 });

        expect(response.init?.status).toBe(429);
        expect(new Headers(response.init?.headers).get("Retry-After")).toBe("20");
        expect(response.data).toEqual({ error: "Too many attempts. Try again in 20 seconds." });
    });

    it("rounds up, and speaks in minutes for long waits", () => {
        expect(tooManyRequests({ allowed: false, remaining: 0, retryAfterMs: 200 }).data.error).toContain("1 seconds");
        expect(tooManyRequests({ allowed: false, remaining: 0, retryAfterMs: 14 * 60_000 }).data.error).toContain("14 minutes");
    });
});

describe("limits", () => {
    it("have unique names, so buckets never collide", () => {
        const names = Object.values(RULES).map((r) => r.name);
        expect(new Set(names).size).toBe(names.length);
    });
});
