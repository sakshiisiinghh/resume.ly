import { buildAtsReport } from "~/.server/ats";
import { computeScoring } from "~/.server/ats/score";
import type { LLMProvider } from "~/.server/llm";
import { analyzeResume } from "~/.server/llm/analyze-resume";
import type { PromptVersion } from "~/.server/llm/prompts";
import { readPdf } from "~/.server/pdf";
import type { Pair, Tier } from "../dataset";
import { combinations, mean, median, percentile, round, stdev, sum } from "./metrics";

export const METRICS = ["overall", "ats", "toneAndStyle", "content", "structure", "skills", "meanOfCategories", "final"] as const;
export type MetricName = (typeof METRICS)[number];

export interface RunRecord {
    pair: string;
    job: string;
    tier: Tier;
    prompt: PromptVersion;
    run: number;
    ok: boolean;
    attempts: number;
    error?: string;
    scores?: Record<MetricName, number>;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
}

export interface LlmEvalOptions {
    provider: LLMProvider;
    pairs: Pair[];
    prompts: PromptVersion[];
    runs: number;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
}

interface Prepared {
    pair: Pair;
    resumeText: string;
    report: ReturnType<typeof buildAtsReport>;
}

async function prepare(pair: Pair): Promise<Prepared> {
    const { doc } = await readPdf(pair.resume.pdf(), { thumbnail: false });
    return { pair, resumeText: doc.text, report: buildAtsReport(doc, pair.job.description) };
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(size, items.length) }, async () => {
            while (next < items.length) await work(items[next++]);
        })
    );
}

export async function runLlmEval({ provider, pairs, prompts, runs, concurrency = 3, onProgress }: LlmEvalOptions): Promise<RunRecord[]> {
    const prepared = await Promise.all(pairs.map(prepare));
    const jobs = prompts.flatMap((prompt) => prepared.flatMap((p) => Array.from({ length: runs }, (_, run) => ({ prompt, p, run }))));

    const records: RunRecord[] = [];
    await pool(jobs, concurrency, async ({ prompt, p, run }) => {
        const base = { pair: p.pair.id, job: p.pair.job.id, tier: p.pair.resume.tier, prompt, run };
        try {
            const out = await analyzeResume(provider, {
                resumeText: p.resumeText,
                jobTitle: p.pair.job.title,
                jobDescription: p.pair.job.description,
                promptVersion: prompt,
            });
            const common = { tokensIn: out.tokensIn, tokensOut: out.tokensOut, latencyMs: out.latencyMs };

            if (!out.result.ok) {
                records.push({ ...base, ...common, ok: false, attempts: out.result.attempts, error: out.result.error });
            } else {
                const f = out.result.feedback;
                const categories = [f.toneAndStyle.score, f.content.score, f.structure.score, f.skills.score];
                const overall = f.overallScore;
                records.push({
                    ...base,
                    ...common,
                    ok: true,
                    attempts: out.result.attempts,
                    scores: {
                        overall,
                        ats: f.ATS.score,
                        toneAndStyle: f.toneAndStyle.score,
                        content: f.content.score,
                        structure: f.structure.score,
                        skills: f.skills.score,
                        meanOfCategories: mean(categories),
                        final: computeScoring(p.report, overall).final,
                    },
                });
            }
        } catch (err) {
            records.push({ ...base, ok: false, attempts: 0, error: err instanceof Error ? err.message : String(err), tokensIn: 0, tokensOut: 0, latencyMs: 0 });
        }
        onProgress?.(records.length, jobs.length);
    });

    return records;
}

export interface Spread {
    meanStdev: number;
    maxStdev: number;
    meanRange: number;
}

export interface Comparisons {
    comparisons: number;
    agree: number;
    ties: number;
    violations: number;
}

export interface PromptSummary {
    prompt: PromptVersion;
    runs: number;
    valid: number;
    validRate: number;
    retryRate: number;
    failures: { message: string; count: number }[];
    spread: Record<MetricName, Spread>;
    medianOf3: { stdev: number; singleStdev: number } | null;
    groups: { job: string; means: Record<Tier, number | null> }[];
    ranking: { overall: Comparisons; final: Comparisons };
    latencyMs: { p50: number; p95: number };
    tokens: { meanIn: number; meanOut: number; totalIn: number; totalOut: number };
    costUsd: number | null;
}

const TIERS: Tier[] = ["strong", "average", "weak"];
const TIER_PAIRS: [Tier, Tier][] = [["strong", "average"], ["average", "weak"], ["strong", "weak"]];

function spreadOf(byPair: number[][]): Spread {
    const usable = byPair.filter((values) => values.length >= 2);
    const sds = usable.map(stdev);
    return {
        meanStdev: round(mean(sds), 2),
        maxStdev: round(Math.max(0, ...sds), 2),
        meanRange: round(mean(usable.map((v) => Math.max(...v) - Math.min(...v))), 2),
    };
}

function compare(byGroup: Map<string, Map<Tier, number[]>>): Comparisons {
    const out = { comparisons: 0, agree: 0, ties: 0, violations: 0 };
    for (const tiers of byGroup.values()) {
        for (const [higher, lower] of TIER_PAIRS) {
            for (const a of tiers.get(higher) ?? []) {
                for (const b of tiers.get(lower) ?? []) {
                    out.comparisons++;
                    if (a > b) out.agree++;
                    else if (a === b) out.ties++;
                    else out.violations++;
                }
            }
        }
    }
    return out;
}

export function summarize(records: RunRecord[], prompt: PromptVersion, prices?: { inPerMTok: number; outPerMTok: number }): PromptSummary {
    const mine = records.filter((r) => r.prompt === prompt);
    const valid = mine.filter((r) => r.ok && r.scores);
    const pairs = [...new Set(mine.map((r) => r.pair))];
    const validFor = (pair: string) => valid.filter((r) => r.pair === pair);

    const spread = Object.fromEntries(
        METRICS.map((metric) => [metric, spreadOf(pairs.map((pair) => validFor(pair).map((r) => r.scores![metric])))])
    ) as Record<MetricName, Spread>;

    const medians = pairs
        .filter((pair) => validFor(pair).length >= 3)
        .map((pair) => stdev(combinations(validFor(pair).map((r) => r.scores!.overall), 3).map(median)));

    const byGroup = (metric: MetricName) => {
        const groups = new Map<string, Map<Tier, number[]>>();
        for (const r of valid) {
            const tiers = groups.get(r.job) ?? new Map<Tier, number[]>();
            tiers.set(r.tier, [...(tiers.get(r.tier) ?? []), r.scores![metric]]);
            groups.set(r.job, tiers);
        }
        return groups;
    };
    const overallGroups = byGroup("overall");

    const failureCounts = new Map<string, number>();
    for (const r of mine.filter((x) => !x.ok)) failureCounts.set(r.error ?? "unknown", (failureCounts.get(r.error ?? "unknown") ?? 0) + 1);

    const tokensIn = sum(mine.map((r) => r.tokensIn));
    const tokensOut = sum(mine.map((r) => r.tokensOut));

    return {
        prompt,
        runs: mine.length,
        valid: valid.length,
        validRate: mine.length === 0 ? 0 : round(valid.length / mine.length, 4),
        retryRate: valid.length === 0 ? 0 : round(valid.filter((r) => r.attempts > 1).length / valid.length, 4),
        failures: [...failureCounts].map(([message, count]) => ({ message, count })),
        spread,
        medianOf3: medians.length === 0 ? null : { stdev: round(mean(medians), 2), singleStdev: spread.overall.meanStdev },
        groups: [...overallGroups].map(([job, tiers]) => ({
            job,
            means: Object.fromEntries(TIERS.map((t) => [t, tiers.has(t) ? round(mean(tiers.get(t)!), 1) : null])) as Record<Tier, number | null>,
        })),
        ranking: { overall: compare(overallGroups), final: compare(byGroup("final")) },
        latencyMs: { p50: Math.round(percentile(mine.map((r) => r.latencyMs), 50)), p95: Math.round(percentile(mine.map((r) => r.latencyMs), 95)) },
        tokens: {
            meanIn: mine.length === 0 ? 0 : Math.round(tokensIn / mine.length),
            meanOut: mine.length === 0 ? 0 : Math.round(tokensOut / mine.length),
            totalIn: tokensIn,
            totalOut: tokensOut,
        },
        costUsd: prices ? round((tokensIn / 1e6) * prices.inPerMTok + (tokensOut / 1e6) * prices.outPerMTok, 4) : null,
    };
}
