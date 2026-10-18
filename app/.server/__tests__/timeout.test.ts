import { describe, expect, it } from "vitest";
import { withTimeout } from "~/.server/timeout";

describe("withTimeout", () => {
    it("passes through a result that arrives in time", async () => {
        await expect(withTimeout(Promise.resolve("ok"), 100, "x")).resolves.toBe("ok");
    });

    it("passes through the original rejection", async () => {
        await expect(withTimeout(Promise.reject(new Error("boom")), 100, "x")).rejects.toThrow("boom");
    });

    it("rejects when the promise never settles", async () => {
        const started = Date.now();
        await expect(withTimeout(new Promise(() => {}), 50, "publish")).rejects.toThrow("publish timed out after 50ms");
        expect(Date.now() - started).toBeLessThan(500);
    });
});
