import { buildAtsReport } from "~/.server/ats";
import { computeScoring } from "~/.server/ats/score";
import type { LLMProvider } from "~/.server/llm";
import type { LLMRequest } from "~/.server/llm/types";
import { PermanentError, TransientError, detailOf } from "~/.server/jobs/errors";
import { analyzeResume, requestFor } from "~/.server/llm/analyze-resume";
import type { PromptVersion } from "~/.server/llm/prompts";
import { readPdf } from "~/.server/pdf";
import type { Pair, Tier } from "../dataset";
import { runKey, type RunStore } from "./cache";
import { combinations, mean, median, percentile, round, stdev, sum } from "./metrics";

export const METRICS = ["overall", "ats", "toneAndStyle", "content", "structure", "skills", "meanOfCategories", "final"] as const;
export type MetricName = (typeof METRICS)[number];

export interface RunRecord {
    pair: string;
    job: string;
    tier: Tier;
    prompt: PromptVersion;
    run: number;
    /** When the call was made (ISO date), kept so runs from different days can be told apart. */
    at?: string;
    ok: boolean;
    attempts: number;
    error?: string;
    scores?: Record<MetricName, number>;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
}

/** A longer wait than this means a daily limit, not a per-minute one, so waiting isn't worth it. */
const MAX_RETRY_WAIT_MS = 5 * 60 * 1000;

/** Below this share of valid runs, a result is too incomplete to trust or to record as a baseline. */
export const MIN_VALID_RATE = 0.9;

export interface LlmEvalOptions {
    provider: LLMProvider;
    pairs: Pair[];
    prompts: PromptVersion[];
    runs: number;
    concurrency?: number;
    /** Stay under a provider limit. Free Gemini keys allow 5 a minute per model. */
    requestsPerMinute?: number;
    /** How often to retry a call the provider says to retry. */
    retries?: number;
    /** Reuse valid runs from an earlier session and save new ones, so a run can span several days. */
    cache?: RunStore;
    /** Called once if the provider says its daily limit is used up; the rest of the run is skipped. */
    onStop?: (reason: string) => void;
    onProgress?: (done: number, total: number) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Hands out start times at least `intervalMs` apart, however many callers ask at once. */
export class Pacer {
    private next = 0;

    constructor(private intervalMs: number, private now: () => number = Date.now, private sleep: (ms: number) => Promise<void> = defaultSleep) {}

    async wait() {
        const start = Math.max(this.now(), this.next);
        this.next = start + this.intervalMs;
        const delay = start - this.now();
        if (delay > 0) await this.sleep(delay);
    }
}

interface TimedProvider {
    provider: LLMProvider;
    /** Time spent inside the model, not waiting for a rate limit. */
    elapsed: () => number;
}

function timedProvider(base: LLMProvider, { pacer, retries, sleep, now }: { pacer?: Pacer; retries: number; sleep: (ms: number) => Promise<void>; now: () => number }): TimedProvider {
    let ms = 0;
    return {
        elapsed: () => ms,
        provider: {
            model: base.model,
            async generate(request: LLMRequest) {
                for (let attempt = 0; ; attempt++) {
                    await pacer?.wait();
                    const started = now();
                    try {
                        const result = await base.generate(request);
                        ms += now() - started;
                        return result;
                    } catch (err) {
                        ms += now() - started;
                        if (!(err instanceof TransientError) || attempt >= retries) throw err;
                        const wait = err.retryAfterMs !== undefined ? err.retryAfterMs + 1000 : 2000 * (attempt + 1);
                        if (wait > MAX_RETRY_WAIT_MS) throw err;
                        await sleep(wait);
                    }
                }
            },
        },
    };
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

export async function runLlmEval({ provider, pairs, prompts, runs, concurrency = 3, requestsPerMinute, retries = 3, cache, onStop, onProgress, sleep = defaultSleep, now = Date.now }: LlmEvalOptions): Promise<RunRecord[]> {
    const pacer = requestsPerMinute ? new Pacer(60_000 / requestsPerMinute, now, sleep) : undefined;
    const prepared = await Promise.all(pairs.map(prepare));
    const jobs = prompts.flatMap((prompt) => prepared.flatMap((p) => Array.from({ length: runs }, (_, run) => ({ prompt, p, run }))));

    const records: RunRecord[] = [];
    let stopped = false;
    await pool(jobs, concurrency, async ({ prompt, p, run }) => {
        if (stopped) return;

        const input = { resumeText: p.resumeText, jobTitle: p.pair.job.title, jobDescription: p.pair.job.description, promptVersion: prompt };
        const { instructions, user } = requestFor(input);
        const key = runKey({ model: provider.model, system: instructions, user, run });
        const cached = cache?.get(key);
        if (cached) {
            records.push(cached);
            return onProgress?.(records.length, jobs.length);
        }

        const base = { pair: p.pair.id, job: p.pair.job.id, tier: p.pair.resume.tier, prompt, run, at: new Date(now()).toISOString().slice(0, 10) };
        const timed = timedProvider(provider, { pacer, retries, sleep, now });
        try {
            const out = await analyzeResume(timed.provider, input);
            const common = { tokensIn: out.tokensIn, tokensOut: out.tokensOut, latencyMs: timed.elapsed() };

            if (!out.result.ok) {
                records.push({ ...base, ...common, ok: false, attempts: out.result.attempts, error: out.result.error });
            } else {
                const f = out.result.feedback;
                const categories = [f.toneAndStyle.score, f.content.score, f.structure.score, f.skills.score];
                const overall = f.overallScore;
                const record: RunRecord = {
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
                };
                records.push(record);
                cache?.set(key, record);
            }
        } catch (err) {
            if (err instanceof PermanentError && err.code === "llm_quota_exhausted" && !stopped) {
                stopped = true;
                onStop?.(err.detail ?? err.message);
            }
            records.push({ ...base, ok: false, attempts: 0, error: [err instanceof Error ? err.message : String(err), detailOf(err)].filter(Boolean).join(" | "), tokensIn: 0, tokensOut: 0, latencyMs: timed.elapsed() });
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
    /** Valid without needing the corrective retry. */
    firstTryRate: number;
    retryRate: number;
    failures: { message: string; count: number }[];
    /** Null when no pair has two valid runs, so there is nothing to compare. */
    spread: Record<MetricName, Spread | null>;
    medianOf3: { stdev: number; singleStdev: number } | null;
    groups: { job: string; means: Record<Tier, number | null> }[];
    ranking: { overall: Comparisons; final: Comparisons };
    latencyMs: { p50: number; p95: number };
    tokens: { meanIn: number; meanOut: number; totalIn: number; totalOut: number };
    costUsd: number | null;
}

const TIERS: Tier[] = ["strong", "average", "weak"];
const TIER_PAIRS: [Tier, Tier][] = [["strong", "average"], ["average", "weak"], ["strong", "weak"]];

function spreadOf(byPair: number[][]): Spread | null {
    const usable = byPair.filter((values) => values.length >= 2);
    if (usable.length === 0) return null;
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
    ) as Record<MetricName, Spread | null>;

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
        firstTryRate: mine.length === 0 ? 0 : round(valid.filter((r) => r.attempts === 1).length / mine.length, 4),
        retryRate: valid.length === 0 ? 0 : round(valid.filter((r) => r.attempts > 1).length / valid.length, 4),
        failures: [...failureCounts].map(([message, count]) => ({ message, count })),
        spread,
        medianOf3: medians.length === 0 ? null : { stdev: round(mean(medians), 2), singleStdev: spread.overall?.meanStdev ?? 0 },
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
