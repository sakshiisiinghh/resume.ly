import { describe, expect, it, vi } from "vitest";
import { analyzeWithRetry } from "~/lib/analyze";
import { validFeedback } from "../../../test/fixtures";

const json = JSON.stringify(validFeedback);

describe("analyzeWithRetry", () => {
    it("returns feedback on the first valid response", async () => {
        const send = vi.fn().mockResolvedValue(json);
        const result = await analyzeWithRetry(send);

        expect(result).toEqual({ ok: true, feedback: validFeedback, attempts: 1 });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(undefined);
    });

    it("retries once with the validation error, then succeeds", async () => {
        const send = vi.fn().mockResolvedValueOnce("{ not json").mockResolvedValueOnce(json);

        const result = await analyzeWithRetry(send);

        expect(result.ok).toBe(true);
        expect(result.attempts).toBe(2);
        expect(send.mock.calls[1][0]).toContain("previous response was rejected");
    });

    it("stops after maxAttempts and reports the last error", async () => {
        const send = vi.fn().mockResolvedValue(JSON.stringify({ overallScore: 50 }));
        const result = await analyzeWithRetry(send, 2);

        expect(send).toHaveBeenCalledTimes(2);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain("feedback format");
    });

    it("does not retry when the model declines to evaluate", async () => {
        const send = vi.fn().mockResolvedValue(JSON.stringify({ error: "not a resume" }));
        const result = await analyzeWithRetry(send);

        expect(send).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain("not a resume");
    });

    it("treats an empty response as a failed attempt", async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const result = await analyzeWithRetry(send);

        expect(result).toEqual({ ok: false, error: "No response from the AI service.", attempts: 2 });
    });
});
