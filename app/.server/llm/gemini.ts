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
                // Thinking models bill their reasoning tokens as output, and report them separately.
                tokensOut: (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
            };
        } catch (err) {
            throw classify(err);
        }
    }
}

interface ApiErrorBody {
    error?: { message?: string; details?: Record<string, unknown>[] };
}

// Google puts the useful parts (which quota, how long to wait) in a JSON body inside the error message.
export function readApiError(err: unknown): { status?: number; detail: string; retryAfterMs?: number; dailyQuota: boolean } {
    const status = err instanceof ApiError ? err.status : undefined;
    const raw = err instanceof Error ? err.message : String(err);

    let body: ApiErrorBody | undefined;
    try {
        body = JSON.parse(raw);
    } catch {}

    const details = body?.error?.details ?? [];
    const ofType = (suffix: string) => details.find((d) => String(d["@type"]).endsWith(suffix));

    const delay = parseFloat(String(ofType("RetryInfo")?.retryDelay ?? ""));
    const retryAfterMs = Number.isFinite(delay) ? Math.round(delay * 1000) : undefined;

    const violation = (ofType("QuotaFailure")?.violations as { quotaId?: string; quotaValue?: string }[] | undefined)?.[0];
    const reason = violation ? `quota ${violation.quotaId} (limit ${violation.quotaValue})` : (body?.error?.message ?? raw);
    const wait = retryAfterMs ? `; retry in ${Math.round(retryAfterMs / 1000)}s` : "";

    return { status, retryAfterMs, dailyQuota: /PerDay/i.test(violation?.quotaId ?? ""), detail: `${status ?? "no response"}: ${reason}${wait}`.slice(0, 600) };
}

export function classify(err: unknown) {
    const { status, detail, retryAfterMs, dailyQuota } = readApiError(err);

    if (status === 401 || status === 403) {
        return new PermanentError("The AI service rejected our credentials.", "llm_auth", detail);
    }
    if (status === 429 && dailyQuota) {
        return new PermanentError("The AI service's daily limit has been reached. Try again later.", "llm_quota_exhausted", detail);
    }
    if (status === 404) {
        return new PermanentError("The configured AI model isn't available.", "llm_model_not_found", detail);
    }
    const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
    return retryable
        ? new TransientError("The AI service is temporarily unavailable.", "llm_unavailable", detail, retryAfterMs)
        : new PermanentError("The AI service rejected the request.", "llm_rejected", detail);
}
