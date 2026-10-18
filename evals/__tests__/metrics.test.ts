import { describe, expect, it } from "vitest";
import { combinations, emptyConfusion, mean, median, percentile, precision, recall, stdev, tally } from "../lib/metrics";

describe("precision and recall", () => {
    it("counts a confusion matrix", () => {
        const c = emptyConfusion();
        tally(c, true, true);
        tally(c, true, false);
        tally(c, false, true);
        tally(c, false, false);
        tally(c, true, true);

        expect(c).toEqual({ tp: 2, fp: 1, fn: 1, tn: 1 });
        expect(precision(c)).toBe(0.6667);
        expect(recall(c)).toBe(0.6667);
    });

    it("is null, not perfect, when nothing was predicted or nothing was there to find", () => {
        expect(precision({ tp: 0, fp: 0, fn: 3, tn: 5 })).toBeNull();
        expect(recall({ tp: 0, fp: 2, fn: 0, tn: 5 })).toBeNull();
    });
});

describe("statistics", () => {
    it("uses the sample standard deviation", () => {
        expect(stdev([80, 84, 82])).toBe(2);
    });

    it("is zero for fewer than two values", () => {
        expect(stdev([])).toBe(0);
        expect(stdev([5])).toBe(0);
    });

    it("takes nearest-rank percentiles", () => {
        expect(percentile([400, 100, 300, 200], 50)).toBe(200);
        expect(percentile([400, 100, 300, 200], 95)).toBe(400);
        expect(percentile([], 50)).toBe(0);
    });

    it("finds the median of odd and even counts", () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 2, 3])).toBe(2.5);
    });

    it("averages, and treats an empty list as zero", () => {
        expect(mean([2, 4])).toBe(3);
        expect(mean([])).toBe(0);
    });

    it("lists combinations without repeats", () => {
        expect(combinations([1, 2, 3, 4], 3)).toEqual([[1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4]]);
        expect(combinations([1, 2], 3)).toEqual([]);
    });
});
