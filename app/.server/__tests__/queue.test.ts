import { describe, expect, it } from "vitest";
import { TransientError } from "~/.server/jobs/errors";
import { backoffDelay, limiterFor } from "~/.server/queue";

describe("backoffDelay", () => {
    it("backs off exponentially when the provider gave no hint", () => {
        expect([1, 2, 3].map((attempt) => backoffDelay(attempt, new Error("boom")))).toEqual([2000, 4000, 8000]);
        expect(backoffDelay(1)).toBe(2000);
    });

    it("waits as long as the provider asked, plus a small margin", () => {
        const rateLimited = new TransientError("busy", "llm_unavailable", "429", 52_000);

        expect(backoffDelay(1, rateLimited)).toBe(53_000);
        expect(backoffDelay(3, rateLimited)).toBe(53_000);
    });

    it("never waits longer than five minutes", () => {
        expect(backoffDelay(1, new TransientError("busy", "llm_unavailable", "429", 3_600_000))).toBe(300_000);
    });

    it("uses the exponential delay for a transient error with no delay", () => {
        expect(backoffDelay(2, new TransientError("busy", "llm_unavailable", "503"))).toBe(4000);
    });
});

describe("limiterFor", () => {
    it("limits jobs per minute when a rate is configured", () => {
        expect(limiterFor(5)).toEqual({ max: 5, duration: 60_000 });
    });

    it("is off by default", () => {
        expect(limiterFor(undefined)).toBeUndefined();
    });
});
