export interface LLMRequest {
    system: string;
    user: string;
}

export interface LLMResult {
    text: string;
    tokensIn?: number;
    tokensOut?: number;
}

export interface LLMProvider {
    readonly model: string;
    generate(request: LLMRequest): Promise<LLMResult>;
}
