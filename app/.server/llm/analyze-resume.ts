import { analyzeWithRetry, type AnalyzeResult } from "~/lib/analyze";
import type { LLMProvider } from "./types";
import { buildInstructions, buildResumeMessage, type PromptVersion } from "./prompts";

export const MAX_RESUME_CHARS = 20_000;

export interface ResumeAnalysisInput {
    resumeText: string;
    jobTitle: string;
    jobDescription: string;
    promptVersion: PromptVersion;
}

export interface ResumeAnalysis {
    result: AnalyzeResult;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
}

export function requestFor(input: ResumeAnalysisInput) {
    return {
        instructions: buildInstructions(input.promptVersion, input),
        user: buildResumeMessage(input.resumeText.slice(0, MAX_RESUME_CHARS)),
    };
}

// Shared by the worker and the evals so that what we measure is what ships.
export async function analyzeResume(llm: LLMProvider, input: ResumeAnalysisInput): Promise<ResumeAnalysis> {
    const { instructions, user } = requestFor(input);
    let tokensIn = 0;
    let tokensOut = 0;

    const started = Date.now();
    const result = await analyzeWithRetry(async (retryNote) => {
        const response = await llm.generate({ system: retryNote ? `${instructions}\n\n${retryNote}` : instructions, user });
        tokensIn += response.tokensIn ?? 0;
        tokensOut += response.tokensOut ?? 0;
        return response.text;
    });

    return { result, tokensIn, tokensOut, latencyMs: Date.now() - started };
}
