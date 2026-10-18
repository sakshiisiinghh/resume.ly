import type { Feedback } from "~/lib/schemas";

const tips = [
    { type: "good" as const, tip: "Clear headings", explanation: "Sections are easy to scan." },
    { type: "improve" as const, tip: "Add metrics", explanation: "Quantify impact in bullets." },
];

export const validFeedback: Feedback = {
    overallScore: 72,
    ATS: {
        score: 80,
        tips: [
            { type: "good", tip: "Standard section names" },
            { type: "improve", tip: "Add more JD keywords" },
        ],
    },
    toneAndStyle: { score: 70, tips },
    content: { score: 65, tips },
    structure: { score: 75, tips },
    skills: { score: 68, tips },
};

export const aiResponse = (content: string | unknown[]): AIResponse => ({
    index: 0,
    message: { role: "assistant", content: content as AIResponse["message"]["content"], refusal: null, annotations: [] },
    logprobs: null,
    finish_reason: "stop",
    usage: [],
    via_ai_chat_service: true,
});
