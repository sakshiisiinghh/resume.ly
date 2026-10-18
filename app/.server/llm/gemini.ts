import { ApiError, GoogleGenAI } from "@google/genai";
import { PermanentError, TransientError } from "~/.server/jobs/errors";
import type { LLMProvider, LLMRequest, LLMResult } from "./types";

export class GeminiProvider implements LLMProvider {
    private client: GoogleGenAI;

    constructor(readonly model: string, apiKey: string, baseUrl?: string) {
        this.client = new GoogleGenAI({ apiKey, ...(baseUrl && { httpOptions: { baseUrl } }) });
    }

    async generate({ system, user }: LLMRequest): Promise<LLMResult> {
        try {
            const response = await this.client.models.generateContent({
                model: this.model,
                contents: user,
                config: { systemInstruction: system, temperature: 0, responseMimeType: "application/json" },
            });
            return {
                text: response.text ?? "",
                tokensIn: response.usageMetadata?.promptTokenCount,
                tokensOut: response.usageMetadata?.candidatesTokenCount,
            };
        } catch (err) {
            throw classify(err);
        }
    }
}

function classify(err: unknown) {
    const status = err instanceof ApiError ? err.status : undefined;

    if (status === 401 || status === 403) {
        return new PermanentError("The AI service rejected our credentials.", "llm_auth");
    }
    const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
    return retryable
        ? new TransientError("The AI service is temporarily unavailable.", "llm_unavailable")
        : new PermanentError("The AI service rejected the request.", "llm_rejected");
}
