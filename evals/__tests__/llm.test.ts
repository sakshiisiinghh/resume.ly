import { describe, expect, it, vi } from "vitest";
import { LLM_PAIRS } from "../dataset";
import { TransientError, PermanentError } from "~/.server/jobs/errors";
import { FileRunStore, runKey, type RunStore } from "../lib/cache";
import { METRICS, Pacer, runLlmEval, summarize, type MetricName, type RunRecord } from "../lib/llm";
import { renderLlmReport } from "../lib/report";
import { validFeedback } from "../../test/fixtures";

const scores = (overall: number, final = overall): Record<MetricName, number> =>
    Object.fromEntries(METRICS.map((m) => [m, m === "final" ? final : overall])) as Record<MetricName, number>;

let counter = 0;
const record = (over: Partial<RunRecord> & { overall?: number }): RunRecord => {
    const { overall = 70, ...rest } = over;
    return {
        pair: "p",
        job: "job",
        tier: "strong",
        prompt: "v1",
        run: counter++,
        ok: true,
        attempts: 1,
        scores: scores(overall),
        tokensIn: 1000,
        tokensOut: 500,
        latencyMs: 100,
        ...rest,
    };
};

describe("summarize", () => {
    it("computes per-pair sample standard deviation and range", () => {
        const records = [80, 84, 82].map((overall) => record({ pair: "a", overall })).concat([60, 60, 60].map((overall) => record({ pair: "b", tier: "average", overall })));

        const { spread } = summarize(records, "v1");

        expect(spread.overall).toEqual({ meanStdev: 1, maxStdev: 2, meanRange: 2 });
    });

    it("ignores pairs with fewer than two valid runs when measuring spread", () => {
        const records = [record({ pair: "a", overall: 70 }), record({ pair: "b", overall: 50 }), record({ pair: "b", overall: 54 })];

        expect(summarize(records, "v1").spread.overall?.meanStdev).toBe(2.83);
    });

    it("estimates how much a median of three runs would calm the score", () => {
        const records = [80, 84, 82, 90].map((overall) => record({ pair: "a", overall }));

        const { medianOf3, spread } = summarize(records, "v1");

        expect(spread.overall?.meanStdev).toBe(4.32);
        expect(medianOf3).toEqual({ stdev: 1.15, singleStdev: 4.32 });
    });

    it("has no spread at all, rather than a spread of zero, when no pair has two valid runs", () => {
        const { spread } = summarize([record({ pair: "a" }), record({ pair: "b" }), record({ ok: false, scores: undefined, pair: "c" })], "v1");

        expect(spread.overall).toBeNull();
        expect(Object.values(spread).every((s) => s === null)).toBe(true);
    });

    it("has no median estimate with fewer than three runs", () => {
        expect(summarize([record({ overall: 70 }), record({ overall: 72 })], "v1").medianOf3).toBeNull();
    });

    it("compares every run of a stronger tier with every run of a weaker one", () => {
        const records = [
            ...[90, 80].map((overall) => record({ pair: "s", tier: "strong", overall })),
            ...[70, 80].map((overall) => record({ pair: "a", tier: "average", overall })),
            ...[50, 85].map((overall) => record({ pair: "w", tier: "weak", overall })),
        ];

        const { ranking, groups } = summarize(records, "v1");

        // strong>average: 4 pairs, one tie (80=80). average>weak: 4 pairs, 2 agree, 2 violations. strong>weak: 4 pairs, 3 agree, 1 violation.
        expect(ranking.overall).toEqual({ comparisons: 12, agree: 8, ties: 1, violations: 3 });
        expect(groups).toEqual([{ job: "job", means: { strong: 85, average: 75, weak: 67.5 } }]);
    });

    it("ranks within each job description, never across them", () => {
        const records = [
            record({ pair: "s1", job: "one", tier: "strong", overall: 90 }),
            record({ pair: "w1", job: "one", tier: "weak", overall: 40 }),
            record({ pair: "s2", job: "two", tier: "strong", overall: 30 }),
            record({ pair: "w2", job: "two", tier: "weak", overall: 20 }),
        ];

        expect(summarize(records, "v1").ranking.overall).toEqual({ comparisons: 2, agree: 2, ties: 0, violations: 0 });
    });

    it("separates runs that were valid first time from those rescued by the retry", () => {
        const records = [record({ attempts: 1 }), record({ attempts: 1 }), record({ attempts: 2 }), record({ ok: false, scores: undefined, attempts: 2, error: "bad" })];

        const summary = summarize(records, "v1");

        expect(summary).toMatchObject({ validRate: 0.75, firstTryRate: 0.5 });
    });

    it("reports validity, retries and failure reasons", () => {
        const records = [
            record({ attempts: 1 }),
            record({ attempts: 2 }),
            record({ ok: false, scores: undefined, attempts: 2, error: "Response was not valid JSON" }),
            record({ ok: false, scores: undefined, attempts: 0, error: "The AI service is temporarily unavailable." }),
        ];

        const summary = summarize(records, "v1");

        expect(summary).toMatchObject({ runs: 4, valid: 2, validRate: 0.5, retryRate: 0.5 });
        expect(summary.failures.map((f) => f.message).sort()).toEqual(["Response was not valid JSON", "The AI service is temporarily unavailable."]);
    });

    it("reports latency percentiles and token totals", () => {
        const records = [100, 200, 300, 400].map((latencyMs) => record({ latencyMs }));

        const summary = summarize(records, "v1");

        expect(summary.latencyMs).toEqual({ p50: 200, p95: 400 });
        expect(summary.tokens).toEqual({ meanIn: 1000, meanOut: 500, totalIn: 4000, totalOut: 2000 });
    });

    it("only estimates cost when prices are given", () => {
        const records = [record({}), record({})];

        expect(summarize(records, "v1").costUsd).toBeNull();
        expect(summarize(records, "v1", { inPerMTok: 1, outPerMTok: 4 }).costUsd).toBe(0.006);
    });

    it("keeps prompt versions apart", () => {
        const records = [record({ prompt: "v1", overall: 70 }), record({ prompt: "v2", overall: 90 }), record({ prompt: "v2", overall: 90 })];

        expect(summarize(records, "v2").runs).toBe(2);
        expect(summarize(records, "v1").runs).toBe(1);
    });
});

describe("runLlmEval", () => {
    const json = JSON.stringify(validFeedback);
    const pairs = LLM_PAIRS.slice(0, 2);

    it("runs every pair, prompt and repeat once", async () => {
        const generate = vi.fn().mockResolvedValue({ text: json, tokensIn: 10, tokensOut: 5 });

        const records = await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1", "v2"], runs: 3 });

        expect(records).toHaveLength(2 * 2 * 3);
        expect(generate).toHaveBeenCalledTimes(12);
        expect(records.every((r) => r.ok)).toBe(true);
        expect(records[0]).toMatchObject({ tokensIn: 10, tokensOut: 5 });
        expect(new Set(records.map((r) => r.prompt))).toEqual(new Set(["v1", "v2"]));
    });

    it("scores each run, including the hybrid score users would see", async () => {
        const generate = vi.fn().mockResolvedValue({ text: json });

        const [record] = await runLlmEval({ provider: { model: "m", generate }, pairs: pairs.slice(0, 1), prompts: ["v1"], runs: 1 });

        expect(record.scores).toMatchObject({ overall: 72, ats: 80, toneAndStyle: 70, content: 65, structure: 75, skills: 68, meanOfCategories: 69.5 });
        expect(record.scores!.final).toBeGreaterThan(0);
        expect(record.scores!.final).toBeLessThanOrEqual(100);
    });

    it("sends the resume to the model with the chosen prompt version", async () => {
        const generate = vi.fn().mockResolvedValue({ text: json });

        await runLlmEval({ provider: { model: "m", generate }, pairs: pairs.slice(0, 1), prompts: ["v2"], runs: 1 });

        const { system, user } = generate.mock.calls[0][0];
        expect(system).toContain("Scoring rubric");
        expect(user).toContain("<resume>");
    });

    it("records provider errors and invalid output as failed runs instead of stopping", async () => {
        const generate = vi
            .fn()
            .mockRejectedValueOnce(new Error("The AI service is temporarily unavailable."))
            .mockResolvedValue({ text: "not json" });

        const records = await runLlmEval({ provider: { model: "m", generate }, pairs: pairs.slice(0, 1), prompts: ["v1"], runs: 2, concurrency: 1 });

        expect(records).toHaveLength(2);
        expect(records.every((r) => !r.ok)).toBe(true);
        expect(records.map((r) => r.error).join(" ")).toContain("temporarily unavailable");
    });

    it("never runs more calls at once than the concurrency limit", async () => {
        let inFlight = 0;
        let peak = 0;
        const generate = vi.fn(async () => {
            peak = Math.max(peak, ++inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight--;
            return { text: json };
        });

        await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1"], runs: 4, concurrency: 2 });

        expect(peak).toBe(2);
    });

    it("reports progress", async () => {
        const generate = vi.fn().mockResolvedValue({ text: json });
        const progress = vi.fn();

        await runLlmEval({ provider: { model: "m", generate }, pairs: pairs.slice(0, 1), prompts: ["v1"], runs: 2, onProgress: progress });

        expect(progress).toHaveBeenLastCalledWith(2, 2);
    });
});

describe("Pacer", () => {
    const setup = (intervalMs: number) => {
        let time = 0;
        const sleeps: number[] = [];
        // Recording the wait without moving the clock models callers that all asked at the same instant.
        const sleep = async (ms: number) => {
            sleeps.push(ms);
        };
        return { pacer: new Pacer(intervalMs, () => time, sleep), sleeps, advance: (ms: number) => (time += ms) };
    };

    it("lets the first call through and spaces the rest, even when they all ask at once", async () => {
        const { pacer, sleeps } = setup(12_000);

        await Promise.all([pacer.wait(), pacer.wait(), pacer.wait()]);

        expect(sleeps).toEqual([12_000, 24_000]);
    });

    it("doesn't wait when calls are already far enough apart", async () => {
        const { pacer, sleeps, advance } = setup(12_000);

        await pacer.wait();
        advance(15_000);
        await pacer.wait();

        expect(sleeps).toEqual([]);
    });
});

describe("runLlmEval rate limits", () => {
    const json = JSON.stringify(validFeedback);
    const pairs = LLM_PAIRS.slice(0, 1);
    const rateLimited = () => new TransientError("The AI service is temporarily unavailable.", "llm_unavailable", "429: quota", 52_000);

    const harness = () => {
        let time = 0;
        const sleeps: number[] = [];
        return {
            sleeps,
            advance: (ms: number) => (time += ms),
            options: {
                now: () => time,
                sleep: async (ms: number) => {
                    sleeps.push(ms);
                    time += ms;
                },
            },
        };
    };

    it("spaces calls to stay under the requests-per-minute budget", async () => {
        const h = harness();
        const generate = vi.fn().mockResolvedValue({ text: json });

        await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1"], runs: 3, concurrency: 1, requestsPerMinute: 5, ...h.options });

        expect(generate).toHaveBeenCalledTimes(3);
        expect(h.sleeps).toEqual([12_000, 12_000]);
    });

    it("waits the time the provider asked for, then retries the call", async () => {
        const h = harness();
        const generate = vi.fn().mockRejectedValueOnce(rateLimited()).mockResolvedValue({ text: json });

        const [record] = await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1"], runs: 1, ...h.options });

        expect(record.ok).toBe(true);
        expect(generate).toHaveBeenCalledTimes(2);
        expect(h.sleeps).toEqual([53_000]);
    });

    it("gives up after the allowed number of retries and records why", async () => {
        const h = harness();
        const generate = vi.fn().mockRejectedValue(rateLimited());

        const [record] = await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1"], runs: 1, retries: 2, ...h.options });

        expect(record.ok).toBe(false);
        expect(generate).toHaveBeenCalledTimes(3);
        expect(record.error).toContain("429: quota");
    });

    it("gives up at once on a wait that long, since it means a daily limit", async () => {
        const h = harness();
        const generate = vi.fn().mockRejectedValue(new TransientError("busy", "llm_unavailable", "429: daily quota", 3 * 60 * 60 * 1000));

        const [record] = await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1"], runs: 1, ...h.options });

        expect(record.ok).toBe(false);
        expect(generate).toHaveBeenCalledOnce();
        expect(h.sleeps).toEqual([]);
    });

    it("doesn't retry a permanent error", async () => {
        const h = harness();
        const generate = vi.fn().mockRejectedValue(new PermanentError("The configured AI model isn't available.", "llm_model_not_found", "404"));

        const [record] = await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1"], runs: 1, ...h.options });

        expect(record.ok).toBe(false);
        expect(generate).toHaveBeenCalledOnce();
        expect(h.sleeps).toEqual([]);
    });

    it("measures time spent in the model, not time spent waiting for the rate limit", async () => {
        const h = harness();
        const generate = vi
            .fn()
            .mockImplementationOnce(async () => {
                h.advance(2_000);
                throw rateLimited();
            })
            .mockImplementation(async () => {
                h.advance(5_000);
                return { text: json };
            });

        const [record] = await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1"], runs: 1, ...h.options });

        expect(record.latencyMs).toBe(7_000);
    });
});

describe("renderLlmReport", () => {
    const meta = { date: "2026-10-18", commit: "abc", datasetVersion: "d", model: "m", runDates: ["2026-10-18"], runsPerPair: 5, pairs: 6, productionPrompt: "v1", pricesGiven: false };
    const records = (prompt: "v1" | "v2", overalls: number[]) => overalls.map((overall) => record({ prompt, pair: "a", overall }));

    it("shows plain numbers for a complete run", () => {
        const report = renderLlmReport([summarize(records("v1", [80, 84, 82]), "v1")], meta);

        expect(report).not.toContain("Incomplete run");
        expect(report).toContain("2.00 (max 2.00, range 4.00)");
    });

    it("warns loudly when too many calls failed", () => {
        const failed = [1, 2, 3, 4, 5, 6, 7, 8].map(() => record({ ok: false, scores: undefined, error: "429" }));
        const report = renderLlmReport([summarize([...records("v1", [80, 84]), ...failed], "v1")], meta);

        expect(report).toContain("Incomplete run");
        expect(report).toContain("2 of 10 calls gave a valid result");
        expect(report).toContain("must not be recorded as a baseline");
    });

    it("says plainly when every repeat gave the same scores, instead of presenting zeros as a win", () => {
        const identical = [80, 80, 80].map((overall) => record({ pair: "a", overall }));

        const report = renderLlmReport([summarize(identical, "v1")], meta);

        expect(report).toContain("Every repeat gave exactly the same scores");
        expect(report).toContain("deterministic at temperature 0");
    });

    it("doesn't say that when the scores did vary", () => {
        const varied = [80, 84, 82].map((overall) => record({ pair: "a", overall }));

        expect(renderLlmReport([summarize(varied, "v1")], meta)).not.toContain("Every repeat gave exactly the same scores");
    });

    it("says n/a, not 0.00, when a prompt has nothing to compare, and doesn't claim a change between prompts", () => {
        const report = renderLlmReport([summarize(records("v1", [80, 84, 82]), "v1"), summarize([record({ prompt: "v2", ok: false, scores: undefined })], "v2")], meta);

        expect(report).toContain("n/a (needs 2+ valid runs per pair)");
        expect(report).not.toContain("Change from v1 to v2");
    });
});

describe("runLlmEval resuming and stopping", () => {
    const json = JSON.stringify(validFeedback);
    const pairs = LLM_PAIRS.slice(0, 2);

    const memoryStore = (): RunStore & { saved: Map<string, RunRecord> } => {
        const saved = new Map<string, RunRecord>();
        return { saved, get: (key) => saved.get(key), set: (key, record) => void saved.set(key, record) };
    };

    it("saves valid runs and doesn't ask the model for them again", async () => {
        const store = memoryStore();
        const generate = vi.fn().mockResolvedValue({ text: json });
        const options = { provider: { model: "m", generate }, pairs, prompts: ["v1" as const], runs: 2, cache: store };

        const first = await runLlmEval(options);
        const second = await runLlmEval(options);

        expect(first).toHaveLength(4);
        expect(generate).toHaveBeenCalledTimes(4);
        expect(store.saved.size).toBe(4);
        expect(second.map((r) => r.scores)).toEqual(first.map((r) => r.scores));
    });

    it("only runs what is missing", async () => {
        const store = memoryStore();
        const generate = vi.fn().mockResolvedValue({ text: json });
        await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1"], runs: 1, cache: store });
        generate.mockClear();

        await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1"], runs: 3, cache: store });

        expect(generate).toHaveBeenCalledTimes(2 * 2);
    });

    it("doesn't reuse a run made with another model or another prompt", async () => {
        const store = memoryStore();
        const generate = vi.fn().mockResolvedValue({ text: json });
        await runLlmEval({ provider: { model: "a", generate }, pairs: pairs.slice(0, 1), prompts: ["v1"], runs: 1, cache: store });
        generate.mockClear();

        await runLlmEval({ provider: { model: "b", generate }, pairs: pairs.slice(0, 1), prompts: ["v1"], runs: 1, cache: store });
        await runLlmEval({ provider: { model: "a", generate }, pairs: pairs.slice(0, 1), prompts: ["v2"], runs: 1, cache: store });

        expect(generate).toHaveBeenCalledTimes(2);
    });

    it("doesn't save failed runs, so they are tried again next time", async () => {
        const store = memoryStore();
        const generate = vi.fn().mockResolvedValue({ text: "not json" });

        await runLlmEval({ provider: { model: "m", generate }, pairs: pairs.slice(0, 1), prompts: ["v1"], runs: 1, cache: store });

        expect(store.saved.size).toBe(0);
    });

    it("records when each run was made", async () => {
        const generate = vi.fn().mockResolvedValue({ text: json });

        const [record] = await runLlmEval({ provider: { model: "m", generate }, pairs: pairs.slice(0, 1), prompts: ["v1"], runs: 1, now: () => Date.UTC(2026, 9, 18, 12) });

        expect(record.at).toBe("2026-10-18");
    });

    it("stops at once when the daily limit is used up, instead of making doomed calls", async () => {
        const generate = vi.fn().mockRejectedValue(new PermanentError("The AI service's daily limit has been reached.", "llm_quota_exhausted", "429: quota PerDay (limit 20)"));
        const onStop = vi.fn();

        const records = await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1", "v2"], runs: 5, concurrency: 1, onStop });

        expect(generate).toHaveBeenCalledTimes(1);
        expect(onStop).toHaveBeenCalledExactlyOnceWith("429: quota PerDay (limit 20)");
        expect(records).toHaveLength(1);
    });

    it("keeps the runs that worked before the limit hit", async () => {
        const store = memoryStore();
        const generate = vi
            .fn()
            .mockResolvedValueOnce({ text: json })
            .mockResolvedValueOnce({ text: json })
            .mockRejectedValue(new PermanentError("limit", "llm_quota_exhausted", "429: PerDay"));

        await runLlmEval({ provider: { model: "m", generate }, pairs, prompts: ["v1"], runs: 5, concurrency: 1, cache: store });

        expect(store.saved.size).toBe(2);
    });
});

describe("runKey", () => {
    const base = { model: "m", system: "s", user: "u", run: 0 };

    it("changes with anything that could change the answer", () => {
        const keys = [base, { ...base, model: "n" }, { ...base, system: "t" }, { ...base, user: "v" }, { ...base, run: 1 }].map(runKey);

        expect(new Set(keys).size).toBe(5);
    });

    it("is stable", () => {
        expect(runKey(base)).toBe(runKey({ ...base }));
    });
});

describe("FileRunStore", () => {
    it("keeps runs between sessions", async () => {
        const { mkdtempSync, rmSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const path = await import("node:path");
        const dir = mkdtempSync(path.join(tmpdir(), "run-store-"));
        const file = path.join(dir, "nested", "runs.json");

        try {
            const first = new FileRunStore(file);
            first.set("k", record({ overall: 77 }));

            const second = new FileRunStore(file);
            expect(second.get("k")?.scores?.overall).toBe(77);
            expect(second.get("missing")).toBeUndefined();
            expect(second.size).toBe(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
