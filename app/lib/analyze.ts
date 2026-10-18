import { parseFeedback, type Feedback } from "~/lib/schemas";

type SendMessage = (message: string) => Promise<AIResponse | undefined>;

export type AnalyzeResult =
    | { ok: true; feedback: Feedback; attempts: number }
    | { ok: false; error: string; attempts: number };

export function getResponseText(response: AIResponse): string {
    const { content } = response.message;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((block) => (typeof block?.text === "string" ? block.text : ""))
            .join("");
    }
    return "";
}

export async function analyzeWithRetry(
    send: SendMessage,
    instructions: string,
    maxAttempts = 2
): Promise<AnalyzeResult> {
    let lastError = "No response from the AI service.";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const message =
            attempt === 1
                ? instructions
                : `${instructions}\n\nYour previous response was rejected: ${lastError}\nReturn ONLY the corrected JSON object.`;

        const response = await send(message);
        if (!response) {
            lastError = "No response from the AI service.";
            continue;
        }

        const parsed = parseFeedback(getResponseText(response));
        if (parsed.ok) return { ok: true, feedback: parsed.feedback, attempts: attempt };
        if (parsed.fatal) return { ok: false, error: parsed.error, attempts: attempt };
        lastError = parsed.error;
    }

    return { ok: false, error: lastError, attempts: maxAttempts };
}
