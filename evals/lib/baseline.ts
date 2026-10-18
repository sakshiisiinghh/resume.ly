import type { DeterministicResults, Scores } from "./deterministic";
import type { PromptSummary } from "./llm";

export interface Baseline {
    datasetVersion: string;
    recordedAt: string;
    checks: Record<string, Scores>;
    extraction: { any: Scores; required: Scores; nice: Scores; classificationAccuracy: number | null };
    matching: Scores;
    coverageMae: number;
    unsupportedDetected: number;
    falseRejects: number;
    rankingViolations: number;
    determinism: number;
}

export interface Regression {
    metric: string;
    baseline: number;
    current: number | null;
}

const scores = (s: Scores): Scores => ({ precision: s.precision, recall: s.recall });

export function toBaseline(r: DeterministicResults, recordedAt: string): Baseline {
    return {
        datasetVersion: r.datasetVersion,
        recordedAt,
        checks: Object.fromEntries(Object.entries(r.checks).map(([id, c]) => [id, scores(c)])),
        extraction: { any: scores(r.extraction.any), required: scores(r.extraction.required), nice: scores(r.extraction.nice), classificationAccuracy: r.extraction.classificationAccuracy },
        matching: scores(r.matching),
        coverageMae: r.coverage.mae,
        unsupportedDetected: r.unsupported.detected,
        falseRejects: r.unsupported.falseRejects.length,
        rankingViolations: r.ranking.violations,
        determinism: r.determinism.cases === 0 ? 1 : r.determinism.identical / r.determinism.cases,
    };
}

/** Anything worse than the baseline. The numbers are exact because the engine is deterministic. */
export function findRegressions(current: DeterministicResults, baseline: Baseline): Regression[] {
    const now = toBaseline(current, baseline.recordedAt);
    const regressions: Regression[] = [];

    const higher = (metric: string, was: number | null, is: number | null) => {
        if (was !== null && (is === null || is < was)) regressions.push({ metric, baseline: was, current: is });
    };
    const lower = (metric: string, was: number, is: number) => {
        if (is > was) regressions.push({ metric, baseline: was, current: is });
    };

    for (const [id, was] of Object.entries(baseline.checks)) {
        higher(`check ${id} precision`, was.precision, now.checks[id]?.precision ?? null);
        higher(`check ${id} recall`, was.recall, now.checks[id]?.recall ?? null);
    }
    for (const group of ["any", "required", "nice"] as const) {
        higher(`extraction ${group} precision`, baseline.extraction[group].precision, now.extraction[group].precision);
        higher(`extraction ${group} recall`, baseline.extraction[group].recall, now.extraction[group].recall);
    }
    higher("extraction classification accuracy", baseline.extraction.classificationAccuracy, now.extraction.classificationAccuracy);
    higher("matching precision", baseline.matching.precision, now.matching.precision);
    higher("matching recall", baseline.matching.recall, now.matching.recall);
    higher("unsupported PDFs detected", baseline.unsupportedDetected, now.unsupportedDetected);
    higher("determinism", baseline.determinism, now.determinism);
    lower("coverage error (MAE)", baseline.coverageMae, now.coverageMae);
    lower("readable PDFs wrongly refused", baseline.falseRejects, now.falseRejects);
    lower("ranking violations", baseline.rankingViolations, now.rankingViolations);

    return regressions;
}

export interface LlmBaseline {
    model: string;
    promptVersion: string;
    datasetVersion: string;
    recordedAt: string;
    runsPerPair: number;
    validRate: number;
    overallMeanStdev: number;
    finalMeanStdev: number;
    rankingAgreement: number | null;
}

export function toLlmBaseline(summary: PromptSummary, meta: { model: string; datasetVersion: string; recordedAt: string; runsPerPair: number }): LlmBaseline {
    const { overall, final } = summary.spread;
    if (!overall || !final) throw new Error("Not enough valid runs to record a baseline");

    const { comparisons, agree } = summary.ranking.overall;
    return {
        ...meta,
        promptVersion: summary.prompt,
        validRate: summary.validRate,
        overallMeanStdev: overall.meanStdev,
        finalMeanStdev: final.meanStdev,
        rankingAgreement: comparisons === 0 ? null : Math.round((agree / comparisons) * 10000) / 10000,
    };
}

/** Model output is noisy, so the caller picks how much worse than the baseline still passes. */
export function findLlmRegressions(summary: PromptSummary, baseline: LlmBaseline, { stdevTolerance = 1.5, rateTolerance = 0.05 } = {}): Regression[] {
    const out: Regression[] = [];
    if (summary.validRate < baseline.validRate - rateTolerance) out.push({ metric: "valid output rate", baseline: baseline.validRate, current: summary.validRate });
    if (!summary.spread.overall || !summary.spread.final) {
        out.push({ metric: "pairs with two or more valid runs", baseline: 1, current: 0 });
        return out;
    }

    const now = toLlmBaseline(summary, { model: baseline.model, datasetVersion: baseline.datasetVersion, recordedAt: baseline.recordedAt, runsPerPair: baseline.runsPerPair });

    if (now.overallMeanStdev > baseline.overallMeanStdev + stdevTolerance) out.push({ metric: "overall score std-dev", baseline: baseline.overallMeanStdev, current: now.overallMeanStdev });
    if (now.finalMeanStdev > baseline.finalMeanStdev + stdevTolerance) out.push({ metric: "final score std-dev", baseline: baseline.finalMeanStdev, current: now.finalMeanStdev });
    if (baseline.rankingAgreement !== null && (now.rankingAgreement === null || now.rankingAgreement < baseline.rankingAgreement - rateTolerance)) {
        out.push({ metric: "ranking agreement", baseline: baseline.rankingAgreement, current: now.rankingAgreement });
    }
    return out;
}
