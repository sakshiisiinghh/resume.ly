import { ApiError } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermanentError, TransientError } from "../../jobs/errors";

const generateContent = vi.fn();
const constructed = vi.fn();

vi.mock("@google/genai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@google/genai")>()),
    GoogleGenAI: class {
        models = { generateContent };
        constructor(options: unknown) {
            constructed(options);
        }
    },
}));

import { GeminiProvider, readApiError } from "../gemini";

const provider = () => new GeminiProvider("test-model", "key");
const apiError = (status: number, message = "boom") => new ApiError({ status, message });

describe("GeminiProvider", () => {
    beforeEach(() => {
        generateContent.mockReset();
        constructed.mockClear();
    });

    it("asks for deterministic JSON with the instructions as the system prompt", async () => {
        generateContent.mockResolvedValue({ text: "{}" });

        await provider().generate({ system: "be strict", user: "the resume" });

        expect(generateContent).toHaveBeenCalledWith({
            model: "test-model",
            contents: "the resume",
            config: { systemInstruction: "be strict", temperature: 0, responseMimeType: "application/json" },
        });
    });

    it("counts thinking tokens as output, since they are billed that way", async () => {
        generateContent.mockResolvedValue({ text: "{}", usageMetadata: { promptTokenCount: 17, candidatesTokenCount: 5, thoughtsTokenCount: 130 } });

        expect(await provider().generate({ system: "s", user: "u" })).toEqual({ text: "{}", tokensIn: 17, tokensOut: 135 });
    });

    it("copes with a response that has no usage data or text", async () => {
        generateContent.mockResolvedValue({});

        expect(await provider().generate({ system: "s", user: "u" })).toEqual({ text: "", tokensIn: undefined, tokensOut: 0 });
    });

    it("can point at a different base URL", () => {
        new GeminiProvider("m", "key", "http://localhost:4010");

        expect(constructed).toHaveBeenCalledWith({ apiKey: "key", httpOptions: { baseUrl: "http://localhost:4010" } });
    });

    describe("errors", () => {
        const failWith = async (err: unknown) => {
            generateContent.mockRejectedValue(err);
            return provider().generate({ system: "s", user: "u" }).catch((e) => e);
        };

        it.each([401, 403])("treats %i as bad credentials, permanently", async (status) => {
            const error = await failWith(apiError(status));

            expect(error).toBeInstanceOf(PermanentError);
            expect(error.code).toBe("llm_auth");
        });

        it("explains an unavailable model, permanently, and keeps Google's reason for the logs", async () => {
            const error = await failWith(apiError(404, "This model is no longer available to new users"));

            expect(error).toBeInstanceOf(PermanentError);
            expect(error).toMatchObject({ code: "llm_model_not_found", message: "The configured AI model isn't available." });
            expect(error.detail).toContain("no longer available to new users");
        });

        it("treats other 4xx responses as a permanent rejection", async () => {
            const error = await failWith(apiError(400, "API key not valid"));

            expect(error).toBeInstanceOf(PermanentError);
            expect(error.code).toBe("llm_rejected");
        });

        it.each([408, 429, 500, 503])("treats %i as worth retrying", async (status) => {
            const error = await failWith(apiError(status));

            expect(error).toBeInstanceOf(TransientError);
            expect(error.code).toBe("llm_unavailable");
        });

        it("treats a network failure with no status as worth retrying", async () => {
            expect(await failWith(new Error("fetch failed"))).toBeInstanceOf(TransientError);
        });

        describe("rate limits", () => {
            const body = JSON.stringify({
                error: {
                    code: 429,
                    message: "You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 5",
                    details: [
                        { "@type": "type.googleapis.com/google.rpc.Help", links: [] },
                        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quotaValue: "5" }] },
                        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "52s" },
                    ],
                },
            });

            it("keeps Google's retry delay so callers can wait the right amount", async () => {
                const error = await failWith(apiError(429, body));

                expect(error).toBeInstanceOf(TransientError);
                expect(error.retryAfterMs).toBe(52_000);
            });

            it("says which quota was hit and how long to wait", async () => {
                const error = await failWith(apiError(429, body));

                expect(error.detail).toBe("429: quota GenerateRequestsPerMinutePerProjectPerModel-FreeTier (limit 5); retry in 52s");
            });

            it("treats a daily quota as permanent: waiting a few minutes can't help", async () => {
                const daily = JSON.stringify({
                    error: { details: [{ "@type": "x.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }, { "@type": "x.RetryInfo", retryDelay: "34193s" }] },
                });

                const error = await failWith(apiError(429, daily));

                expect(error).toBeInstanceOf(PermanentError);
                expect(error).toMatchObject({ code: "llm_quota_exhausted", message: "The AI service's daily limit has been reached. Try again later." });
                expect(error.detail).toContain("limit 20");
            });

            it("reads fractional delays", () => {
                const fractional = JSON.stringify({ error: { details: [{ "@type": "x.RetryInfo", retryDelay: "52.287725827s" }] } });

                expect(readApiError(apiError(429, fractional)).retryAfterMs).toBe(52_288);
            });

            it("has no delay when Google doesn't give one", () => {
                expect(readApiError(apiError(503, "overloaded")).retryAfterMs).toBeUndefined();
            });

            it("falls back to the raw text when the body isn't JSON", () => {
                expect(readApiError(apiError(500, "plain text failure")).detail).toBe("500: plain text failure");
            });
        });

        it("never puts provider text in the message shown to users", async () => {
            const error = await failWith(apiError(400, "secret internal detail"));

            expect(error.message).not.toContain("secret internal detail");
            expect(error.detail).toContain("secret internal detail");
        });
    });
});
