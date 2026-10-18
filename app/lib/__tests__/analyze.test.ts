import { describe, expect, it, vi } from "vitest";
import { analyzeWithRetry, getResponseText } from "~/lib/analyze";
import { aiResponse, validFeedback } from "../../../test/fixtures";

describe("getResponseText", () => {
    it("handles string content", () => {
        expect(getResponseText(aiResponse("hello"))).toBe("hello");
    });

    it("joins text from content blocks", () => {
        expect(getResponseText(aiResponse([{ type: "text", text: "a" }, { type: "text", text: "b" }]))).toBe("ab");
    });
});

describe("analyzeWithRetry", () => {
    it("returns feedback on the first valid response", async () => {
        const send = vi.fn().mockResolvedValue(aiResponse(JSON.stringify(validFeedback)));
        const result = await analyzeWithRetry(send, "analyze");

        expect(result).toEqual({ ok: true, feedback: validFeedback, attempts: 1 });
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("retries once with the validation error, then succeeds", async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce(aiResponse("{ not json"))
            .mockResolvedValueOnce(aiResponse(JSON.stringify(validFeedback)));

        const result = await analyzeWithRetry(send, "analyze");

        expect(result.ok).toBe(true);
        expect(result.attempts).toBe(2);
        expect(send.mock.calls[1][0]).toContain("previous response was rejected");
    });

    it("stops after maxAttempts and reports the last error", async () => {
        const send = vi.fn().mockResolvedValue(aiResponse(JSON.stringify({ overallScore: 50 })));
        const result = await analyzeWithRetry(send, "analyze", 2);

        expect(send).toHaveBeenCalledTimes(2);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain("feedback format");
    });

    it("does not retry when the model declines to evaluate", async () => {
        const send = vi.fn().mockResolvedValue(aiResponse(JSON.stringify({ error: "not a resume" })));
        const result = await analyzeWithRetry(send, "analyze");

        expect(send).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain("not a resume");
    });

    it("treats a missing response as a failed attempt", async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const result = await analyzeWithRetry(send, "analyze");

        expect(result).toEqual({ ok: false, error: "No response from the AI service.", attempts: 2 });
    });
});
