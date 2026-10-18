import { z } from "zod";

const score = z.number().min(0).max(100);
const tipType = z.enum(["good", "improve"]);

const atsTip = z.object({
    type: tipType,
    tip: z.string().min(1),
});

// The explanation is a nicety. Some models leave it out, and that shouldn't discard an otherwise valid analysis.
const detailedTip = atsTip.extend({
    explanation: z.string().default(""),
});

const category = z.object({
    score,
    tips: z.array(detailedTip).min(1).max(10),
});

export const FeedbackSchema = z.object({
    overallScore: score,
    ATS: z.object({
        score,
        tips: z.array(atsTip).min(1).max(10),
    }),
    toneAndStyle: category,
    content: category,
    structure: category,
    skills: category,
});

export type Feedback = z.infer<typeof FeedbackSchema>;
export type FeedbackTip = z.infer<typeof detailedTip>;

export type ParseResult =
    | { ok: true; feedback: Feedback }
    | { ok: false; error: string; fatal?: boolean };

// A model that never saw the resume tends to fill the template with zeros.
function isNonEvaluation(f: Feedback): boolean {
    return [f.overallScore, f.ATS.score, f.toneAndStyle.score, f.content.score, f.structure.score, f.skills.score]
        .every((score) => score === 0);
}

// Models often wrap JSON in code fences or add a sentence around it.
function extractJson(raw: string): string {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return raw.trim();
    return raw.slice(start, end + 1);
}

export function parseFeedback(raw: string): ParseResult {
    let json: unknown;
    try {
        json = JSON.parse(extractJson(raw));
    } catch {
        return { ok: false, error: "Response was not valid JSON (it may have been truncated)." };
    }

    if (json && typeof json === "object" && "error" in json && !("overallScore" in json)) {
        const reason = String((json as { error: unknown }).error);
        return { ok: false, fatal: true, error: `The AI could not evaluate this resume: ${reason}` };
    }

    const result = FeedbackSchema.safeParse(json);
    if (!result.success) {
        const issues = result.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
        return { ok: false, error: `Response did not match the feedback format: ${issues}` };
    }

    if (isNonEvaluation(result.data)) {
        return { ok: false, fatal: true, error: "The AI returned an empty evaluation (all scores 0), so it was not saved." };
    }

    return { ok: true, feedback: result.data };
}
