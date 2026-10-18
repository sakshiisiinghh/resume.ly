import { describe, expect, it } from "vitest";
import type { Keywords } from "~/lib/ats";
import { SCORE_WEIGHTS, computeScoring } from "../score";

const keywords = (coverage: number): Keywords => ({ coverage, required: { matched: [], missing: [] }, nice: { matched: [], missing: [] } });

describe("computeScoring", () => {
    it("blends the three components by their weights", () => {
        const scoring = computeScoring({ parseability: 100, keywords: keywords(50) }, 80);

        expect(scoring.final).toBe(Math.round(100 * 0.3 + 50 * 0.3 + 80 * 0.4));
        expect(scoring.components.map((c) => [c.id, c.score, c.weight])).toEqual([
            ["parseability", 100, 0.3],
            ["keywords", 50, 0.3],
            ["quality", 80, 0.4],
        ]);
    });

    it("lets the components' contributions add up to the final score", () => {
        const scoring = computeScoring({ parseability: 90, keywords: keywords(70) }, 60);

        expect(scoring.components.reduce((sum, c) => sum + c.contribution, 0)).toBeCloseTo(scoring.final, 0);
    });

    it("computes ATS readiness from parseability and keywords only", () => {
        expect(computeScoring({ parseability: 100, keywords: keywords(50) }, 0).atsReadiness).toBe(75);
    });

    it("drops the keyword component, instead of scoring 0, when there is no job description", () => {
        const scoring = computeScoring({ parseability: 90, keywords: null }, 70);

        expect(scoring.components.map((c) => c.id)).toEqual(["parseability", "quality"]);
        expect(scoring.final).toBe(Math.round((90 * 0.3 + 70 * 0.4) / 0.7));
        expect(scoring.atsReadiness).toBe(90);
    });

    it("rounds a fractional AI score", () => {
        expect(computeScoring({ parseability: 80, keywords: null }, 72.6).components.find((c) => c.id === "quality")!.score).toBe(73);
    });

    it("weights sum to one", () => {
        expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    });
});
