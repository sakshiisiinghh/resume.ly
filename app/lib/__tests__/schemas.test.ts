import { describe, expect, it } from "vitest";
import { parseFeedback } from "~/lib/schemas";
import { validFeedback } from "../../../test/fixtures";

describe("parseFeedback", () => {
    it("accepts a valid feedback object", () => {
        const result = parseFeedback(JSON.stringify(validFeedback));
        expect(result).toEqual({ ok: true, feedback: validFeedback });
    });

    it("strips markdown fences and surrounding text", () => {
        const raw = "Here you go:\n```json\n" + JSON.stringify(validFeedback) + "\n```";
        expect(parseFeedback(raw).ok).toBe(true);
    });

    it("rejects truncated JSON", () => {
        const raw = JSON.stringify(validFeedback).slice(0, 120);
        const result = parseFeedback(raw);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/not valid JSON/);
    });

    it("rejects a missing category and names the field", () => {
        const { skills, ...withoutSkills } = validFeedback;
        const result = parseFeedback(JSON.stringify(withoutSkills));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain("skills");
    });

    it("rejects out-of-range scores", () => {
        const result = parseFeedback(JSON.stringify({ ...validFeedback, overallScore: 140 }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain("overallScore");
    });

    it("rejects scores sent as strings", () => {
        const result = parseFeedback(JSON.stringify({ ...validFeedback, overallScore: "72" }));
        expect(result.ok).toBe(false);
    });

    it("treats an explicit {error} from the model as fatal", () => {
        const result = parseFeedback(JSON.stringify({ error: "No resume content provided" }));
        expect(result).toEqual({
            ok: false,
            fatal: true,
            error: "The AI could not evaluate this resume: No resume content provided",
        });
    });

    it("rejects an all-zero evaluation as fatal", () => {
        const zeroCategory = { score: 0, tips: [{ type: "improve", tip: "File Processing Error Detected", explanation: "Could not read file." }] };
        const zeros = {
            overallScore: 0,
            ATS: { score: 0, tips: [{ type: "improve", tip: "Upload Standard Formats (.pdf or .docx)" }] },
            toneAndStyle: zeroCategory, content: zeroCategory, structure: zeroCategory, skills: zeroCategory,
        };
        const result = parseFeedback(JSON.stringify(zeros));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.fatal).toBe(true);
    });

    it("still accepts a genuinely low but non-zero evaluation", () => {
        const low = { ...validFeedback, overallScore: 0, ATS: { ...validFeedback.ATS, score: 12 } };
        expect(parseFeedback(JSON.stringify(low)).ok).toBe(true);
    });

    it("rejects unknown tip types", () => {
        const bad = { ...validFeedback, ATS: { score: 50, tips: [{ type: "meh", tip: "x" }] } };
        expect(parseFeedback(JSON.stringify(bad)).ok).toBe(false);
    });
});
