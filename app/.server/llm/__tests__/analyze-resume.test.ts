import { describe, expect, it, vi } from "vitest";
import { analyzeResume } from "../analyze-resume";
import { validFeedback } from "../../../../test/fixtures";

const input = { resumeText: "Sakshi Singh\nBackend Engineer", jobTitle: "Backend Engineer", jobDescription: "Go", promptVersion: "v1" as const };
const json = JSON.stringify(validFeedback);

describe("analyzeResume", () => {
    it("returns validated feedback with token counts and latency", async () => {
        const generate = vi.fn().mockResolvedValue({ text: json, tokensIn: 100, tokensOut: 50 });

        const out = await analyzeResume({ model: "m", generate }, input);

        expect(out.result).toEqual({ ok: true, feedback: validFeedback, attempts: 1 });
        expect(out).toMatchObject({ tokensIn: 100, tokensOut: 50 });
        expect(out.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("sends instructions as system and the resume as the user message", async () => {
        const generate = vi.fn().mockResolvedValue({ text: json });

        await analyzeResume({ model: "m", generate }, input);

        const { system, user } = generate.mock.calls[0][0];
        expect(system).toContain("Backend Engineer");
        expect(user).toContain("<resume>\nSakshi Singh");
        expect(system).not.toContain("Sakshi Singh");
    });

    it("adds up tokens across a retry and tells the model why it was rejected", async () => {
        const generate = vi
            .fn()
            .mockResolvedValueOnce({ text: "{ nope", tokensIn: 100, tokensOut: 10 })
            .mockResolvedValueOnce({ text: json, tokensIn: 110, tokensOut: 60 });

        const out = await analyzeResume({ model: "m", generate }, input);

        expect(out.result).toMatchObject({ ok: true, attempts: 2 });
        expect(out).toMatchObject({ tokensIn: 210, tokensOut: 70 });
        expect(generate.mock.calls[1][0].system).toContain("previous response was rejected");
    });

    it("uses the requested prompt version", async () => {
        const generate = vi.fn().mockResolvedValue({ text: json });

        await analyzeResume({ model: "m", generate }, { ...input, promptVersion: "v2" });

        expect(generate.mock.calls[0][0].system).toContain("Scoring rubric");
    });

    it("lets provider errors through for the caller to classify", async () => {
        const generate = vi.fn().mockRejectedValue(new Error("boom"));

        await expect(analyzeResume({ model: "m", generate }, input)).rejects.toThrow("boom");
    });
});
