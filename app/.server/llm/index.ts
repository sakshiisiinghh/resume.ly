import { env } from "~/.server/env";
import { GeminiProvider } from "./gemini";
import type { LLMProvider } from "./types";

export function createLLMProvider(): LLMProvider {
    const { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_BASE_URL } = env();
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to run the worker");
    return new GeminiProvider(GEMINI_MODEL, GEMINI_API_KEY, GEMINI_BASE_URL);
}

export type { LLMProvider } from "./types";
