import { createHash } from "node:crypto";
import { JOBS, job } from "./jobs";
import { RESUMES } from "./resumes";
import type { Domain, JobCase, Pair, ResumeCase, Tier } from "./types";

export { JOBS, RESUMES };
export type { Domain, JobCase, Pair, ResumeCase, Tier };

const resume = (id: string): ResumeCase => {
    const found = RESUMES.find((r) => r.id === id);
    if (!found) throw new Error(`Unknown resume ${id}`);
    return found;
};

const DOMAIN_JOBS = {
    backend: ["backend-go", "backend-java"],
    fullstack: ["fullstack-ts", "fullstack-frontend"],
    data: ["data-ml", "data-eng"],
} as const;

const pair = (resumeId: string, jobId: string): Pair => ({ id: `${resumeId} × ${jobId}`, resume: resume(resumeId), job: job(jobId) });

export const PAIRS: Pair[] = [
    ...RESUMES.filter((r) => r.variant === "base").flatMap((r) => DOMAIN_JOBS[r.domain].map((jobId) => pair(r.id, jobId))),
    ...RESUMES.filter((r) => r.variant !== "base").map((r) => pair(r.id, "backend-go")),
    pair("backend-strong", "data-ml"),
    pair("fullstack-strong", "backend-go"),
    pair("data-strong", "fullstack-ts"),
];

/** The pairs the LLM evals run on: three quality tiers for two domains. */
export const LLM_PAIRS: Pair[] = [
    ...(["strong", "average", "weak"] as const).map((tier) => pair(`backend-${tier}`, "backend-go")),
    ...(["strong", "average", "weak"] as const).map((tier) => pair(`fullstack-${tier}`, "fullstack-ts")),
];

export function datasetVersion(): string {
    const hash = createHash("sha256");
    for (const j of JOBS) hash.update(JSON.stringify(j));
    for (const r of RESUMES) {
        hash.update(JSON.stringify({ id: r.id, mentions: r.mentions, issues: r.issues, unsupported: r.unsupported }));
        hash.update(r.pdf());
    }
    hash.update(JSON.stringify(PAIRS.map((p) => p.id)));
    return hash.digest("hex").slice(0, 12);
}
