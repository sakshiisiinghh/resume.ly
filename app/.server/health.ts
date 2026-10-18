import { pool } from "~/.server/db";
import { logger } from "~/.server/logger";
import { getQueue } from "~/.server/queue";
import { getRedis } from "~/.server/redis";
import { withTimeout } from "~/.server/timeout";

export interface ReadinessDeps {
    database: () => Promise<unknown>;
    redis: () => Promise<unknown>;
    queue: () => Promise<Record<string, number>>;
}

interface Check {
    ok: boolean;
    ms: number;
    /** Deliberately vague: this endpoint is public, and the details go to the logs. */
    problem?: "timeout" | "unreachable";
}

export interface Readiness {
    status: "ready" | "unavailable";
    checks: { database: Check; redis: Check };
    queue?: Record<string, number>;
}

const defaultDeps: ReadinessDeps = {
    database: () => pool.query("select 1"),
    redis: () => getRedis().ping(),
    queue: () => getQueue().getJobCounts("waiting", "active", "delayed", "failed"),
};

async function timed(name: string, run: () => Promise<unknown>, timeoutMs: number): Promise<Check> {
    const started = Date.now();
    try {
        await withTimeout(run(), timeoutMs, name);
        return { ok: true, ms: Date.now() - started };
    } catch (err) {
        logger.error({ err, check: name }, "readiness check failed");
        return { ok: false, ms: Date.now() - started, problem: /timed out/.test(String(err)) ? "timeout" : "unreachable" };
    }
}

export async function checkReadiness(deps: ReadinessDeps = defaultDeps, timeoutMs = 1500): Promise<Readiness> {
    const [database, redis] = await Promise.all([timed("database", deps.database, timeoutMs), timed("redis", deps.redis, timeoutMs)]);
    const ready = database.ok && redis.ok;

    // Queue depth is useful to see, but it isn't a reason to stop sending traffic.
    const queue = redis.ok ? await withTimeout(deps.queue(), timeoutMs, "queue").catch(() => undefined) : undefined;

    return { status: ready ? "ready" : "unavailable", checks: { database, redis }, ...(queue && { queue }) };
}
