import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { findLlmRegressions, findRegressions, toBaseline, toLlmBaseline, type Baseline } from "../lib/baseline";
import { runDeterministicEval, type DeterministicResults } from "../lib/deterministic";
import type { PromptSummary } from "../lib/llm";

const baseline = JSON.parse(readFileSync("evals/baseline.json", "utf8")) as Baseline;
let results: DeterministicResults;

beforeAll(async () => {
    results = await runDeterministicEval();
}, 60_000);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("deterministic evaluation against the recorded baseline", () => {
    it("runs on the dataset the baseline was recorded on", () => {
        expect(results.datasetVersion, "The dataset changed. Review it, then run `npm run eval:baseline`.").toBe(baseline.datasetVersion);
    });

    it("is no worse than the baseline on any metric", () => {
        expect(findRegressions(results, baseline)).toEqual([]);
    });

    it("refuses no readable PDF and every unreadable one", () => {
        expect(results.unsupported.falseRejects).toEqual([]);
        expect(results.unsupported.detected).toBe(results.unsupported.expected);
    });

    it("gives the same report for the same input every time", () => {
        expect(results.determinism.identical).toBe(results.determinism.cases);
    });
});

describe("findRegressions", () => {
    it("passes when nothing changed", () => {
        expect(findRegressions(results, toBaseline(results, "x"))).toEqual([]);
    });

    it("flags a drop in precision or recall", () => {
        const worse = clone(results);
        worse.checks["sections"].precision = 0.5;
        worse.matching.recall = 0.9;

        expect(findRegressions(worse, toBaseline(results, "x")).map((r) => r.metric).sort()).toEqual(["check sections precision", "matching recall"]);
    });

    it("flags a metric that stopped being measurable", () => {
        const worse = clone(results);
        worse.matching.precision = null;

        expect(findRegressions(worse, toBaseline(results, "x"))).toEqual([{ metric: "matching precision", baseline: 1, current: null }]);
    });

    it("ignores improvements and metrics the baseline never had a value for", () => {
        const base = toBaseline(results, "x");
        base.checks["columns"].precision = null;
        const better = clone(results);
        better.coverage.mae = 0;

        expect(findRegressions(better, base)).toEqual([]);
    });

    it("flags the metrics where lower is better", () => {
        const worse = clone(results);
        worse.coverage.mae = results.coverage.mae + 1;
        worse.ranking.violations = 2;
        worse.unsupported.falseRejects = ["backend-strong"];

        expect(findRegressions(worse, toBaseline(results, "x")).map((r) => r.metric).sort()).toEqual([
            "coverage error (MAE)",
            "ranking violations",
            "readable PDFs wrongly refused",
        ]);
    });

    it("flags reports that stopped being identical", () => {
        const worse = clone(results);
        worse.determinism.identical = worse.determinism.cases - 1;

        expect(findRegressions(worse, toBaseline(results, "x")).map((r) => r.metric)).toEqual(["determinism"]);
    });
});

describe("findLlmRegressions", () => {
    const spread = { meanStdev: 2, maxStdev: 4, meanRange: 4 };
    const summary = (patch: Partial<PromptSummary> = {}): PromptSummary => ({
        prompt: "v1",
        runs: 30,
        valid: 30,
        validRate: 1,
        firstTryRate: 1,
        retryRate: 0,
        failures: [],
        spread: { overall: spread, final: { ...spread, meanStdev: 1.5 } } as PromptSummary["spread"],
        medianOf3: null,
        groups: [],
        ranking: { overall: { comparisons: 100, agree: 90, ties: 0, violations: 10 }, final: { comparisons: 100, agree: 90, ties: 0, violations: 10 } },
        latencyMs: { p50: 1, p95: 2 },
        tokens: { meanIn: 1, meanOut: 1, totalIn: 1, totalOut: 1 },
        costUsd: null,
        ...patch,
    });
    const base = toLlmBaseline(summary(), { model: "m", datasetVersion: "d", recordedAt: "x", runsPerPair: 5 });

    it("records the numbers worth guarding", () => {
        expect(base).toMatchObject({ validRate: 1, overallMeanStdev: 2, finalMeanStdev: 1.5, rankingAgreement: 0.9 });
    });

    it("tolerates noise within the allowed margin", () => {
        const noisy = summary({ spread: { overall: { ...spread, meanStdev: 3.2 }, final: spread } as PromptSummary["spread"] });

        expect(findLlmRegressions(noisy, base)).toEqual([]);
    });

    it("flags a clear loss of consistency, validity or ranking", () => {
        const worse = summary({
            validRate: 0.8,
            spread: { overall: { ...spread, meanStdev: 5 }, final: { ...spread, meanStdev: 5 } } as PromptSummary["spread"],
            ranking: { overall: { comparisons: 100, agree: 70, ties: 0, violations: 30 }, final: { comparisons: 100, agree: 70, ties: 0, violations: 30 } },
        });

        expect(findLlmRegressions(worse, base).map((r) => r.metric).sort()).toEqual([
            "final score std-dev",
            "overall score std-dev",
            "ranking agreement",
            "valid output rate",
        ]);
    });

    it("refuses to record a baseline without enough valid runs", () => {
        const empty = summary({ spread: { overall: null, final: null } as PromptSummary["spread"] });

        expect(() => toLlmBaseline(empty, { model: "m", datasetVersion: "d", recordedAt: "x", runsPerPair: 5 })).toThrow(/valid runs/);
    });

    it("reports a regression, instead of crashing, when there are too few valid runs to measure", () => {
        const empty = summary({ validRate: 0.2, spread: { overall: null, final: null } as PromptSummary["spread"] });

        expect(findLlmRegressions(empty, base).map((r) => r.metric).sort()).toEqual(["pairs with two or more valid runs", "valid output rate"]);
    });

    it("lets the caller widen the tolerance", () => {
        const worse = summary({ spread: { overall: { ...spread, meanStdev: 5 }, final: spread } as PromptSummary["spread"] });

        expect(findLlmRegressions(worse, base, { stdevTolerance: 4 })).toEqual([]);
    });
});
