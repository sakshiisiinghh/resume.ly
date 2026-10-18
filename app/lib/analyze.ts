import { parseFeedback, type Feedback } from "~/lib/schemas";

type Send = (retryNote?: string) => Promise<string | undefined>;

export type AnalyzeResult =
    | { ok: true; feedback: Feedback; attempts: number }
    | { ok: false; error: string; attempts: number };

export async function analyzeWithRetry(send: Send, maxAttempts = 2): Promise<AnalyzeResult> {
    let lastError = "No response from the AI service.";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const note =
            attempt === 1 ? undefined : `Your previous response was rejected: ${lastError}\nReturn ONLY the corrected JSON object.`;

        const text = await send(note);
        if (!text) {
            lastError = "No response from the AI service.";
            continue;
        }

        const parsed = parseFeedback(text);
        if (parsed.ok) return { ok: true, feedback: parsed.feedback, attempts: attempt };
        if (parsed.fatal) return { ok: false, error: parsed.error, attempts: attempt };
        lastError = parsed.error;
    }

    return { ok: false, error: lastError, attempts: maxAttempts };
}
