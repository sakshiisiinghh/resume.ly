import { describe, expect, it, vi } from "vitest";
import { checkReadiness, type ReadinessDeps } from "../health";

const healthy = (): ReadinessDeps => ({
    database: async () => ({ rows: [{ "?column?": 1 }] }),
    redis: async () => "PONG",
    queue: async () => ({ waiting: 3, active: 1, delayed: 0, failed: 2 }),
});

describe("checkReadiness", () => {
    it("is ready when the database and Redis answer, and reports the queue", async () => {
        const result = await checkReadiness(healthy());

        expect(result).toMatchObject({ status: "ready", queue: { waiting: 3, active: 1, delayed: 0, failed: 2 } });
        expect(result.checks.database.ok).toBe(true);
        expect(result.checks.redis.ok).toBe(true);
    });

    it("is unavailable when the database is down, and says which part", async () => {
        const result = await checkReadiness({ ...healthy(), database: async () => Promise.reject(new Error("ECONNREFUSED 10.0.0.5:5432 password=hunter2")) });

        expect(result.status).toBe("unavailable");
        expect(result.checks.database).toMatchObject({ ok: false, problem: "unreachable" });
        expect(result.checks.redis.ok).toBe(true);
    });

    it("is unavailable when Redis is down, and skips the queue", async () => {
        const queue = vi.fn();
        const result = await checkReadiness({ ...healthy(), redis: async () => Promise.reject(new Error("down")), queue });

        expect(result.status).toBe("unavailable");
        expect(result.checks.redis.ok).toBe(false);
        expect(result.queue).toBeUndefined();
        expect(queue).not.toHaveBeenCalled();
    });

    it("never leaks connection details from an error", async () => {
        const result = await checkReadiness({ ...healthy(), database: async () => Promise.reject(new Error("password=hunter2 host=10.0.0.5")) });

        expect(JSON.stringify(result)).not.toContain("hunter2");
        expect(JSON.stringify(result)).not.toContain("10.0.0.5");
    });

    it("gives up on a dependency that hangs, instead of hanging the health check", async () => {
        const started = Date.now();

        const result = await checkReadiness({ ...healthy(), database: () => new Promise(() => {}) }, 100);

        expect(Date.now() - started).toBeLessThan(1000);
        expect(result.checks.database).toMatchObject({ ok: false, problem: "timeout" });
    });

    it("checks both dependencies at the same time", async () => {
        const started = Date.now();
        const slow = () => new Promise<void>((resolve) => setTimeout(resolve, 150));

        await checkReadiness({ ...healthy(), database: slow, redis: slow });

        expect(Date.now() - started).toBeLessThan(280);
    });

    it("stays ready when only the queue counts can't be read", async () => {
        const result = await checkReadiness({ ...healthy(), queue: async () => Promise.reject(new Error("boom")) });

        expect(result.status).toBe("ready");
        expect(result.queue).toBeUndefined();
    });

    it("records how long each check took", async () => {
        const result = await checkReadiness(healthy());

        expect(result.checks.database.ms).toBeGreaterThanOrEqual(0);
        expect(result.checks.redis.ms).toBeGreaterThanOrEqual(0);
    });
});
