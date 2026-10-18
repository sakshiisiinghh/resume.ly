import { describe, expect, it, vi } from "vitest";
import { LLM_PAIRS } from "../dataset";
import { METRICS, runLlmEval, summarize, type MetricName, type RunRecord } from "../lib/llm";
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

        expect(summarize(records, "v1").spread.overall.meanStdev).toBe(2.83);
    });

    it("estimates how much a median of three runs would calm the score", () => {
        const records = [80, 84, 82, 90].map((overall) => record({ pair: "a", overall }));

        const { medianOf3, spread } = summarize(records, "v1");

        expect(spread.overall.meanStdev).toBe(4.32);
        expect(medianOf3).toEqual({ stdev: 1.15, singleStdev: 4.32 });
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
