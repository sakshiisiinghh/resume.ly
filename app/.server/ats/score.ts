import type { AtsReport, Scoring } from "~/lib/ats";

export const SCORE_WEIGHTS = { parseability: 0.3, keywords: 0.3, quality: 0.4 } as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeScoring(report: Pick<AtsReport, "parseability" | "keywords">, quality: number): Scoring {
    const parts = [
        { id: "parseability" as const, label: "Parseability", score: report.parseability, weight: SCORE_WEIGHTS.parseability },
        ...(report.keywords ? [{ id: "keywords" as const, label: "Job keyword match", score: report.keywords.coverage, weight: SCORE_WEIGHTS.keywords }] : []),
        { id: "quality" as const, label: "Writing quality (AI)", score: Math.round(quality), weight: SCORE_WEIGHTS.quality },
    ];

    // Weights are renormalized over the components that exist, so a resume without a job description isn't penalized.
    const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
    const components = parts.map((p) => ({ ...p, contribution: round1((p.score * p.weight) / totalWeight) }));

    const atsParts = components.filter((c) => c.id !== "quality");
    const atsWeight = atsParts.reduce((sum, c) => sum + c.weight, 0);

    return {
        components,
        atsReadiness: Math.round(atsParts.reduce((sum, c) => sum + c.score * c.weight, 0) / atsWeight),
        final: Math.round(components.reduce((sum, c) => sum + c.contribution, 0)),
    };
}
