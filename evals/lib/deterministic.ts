import { buildAtsReport } from "~/.server/ats";
import type { ExtractedDoc } from "~/.server/ats/document";
import { extractJobTerms, matchKeywords } from "~/.server/ats/keywords";
import { computeScoring } from "~/.server/ats/score";
import { SKILLS } from "~/.server/ats/skills";
import { readPdf } from "~/.server/pdf";
import { PAIRS, RESUMES, datasetVersion, type Pair, type ResumeCase } from "../dataset";
import { emptyConfusion, mean, percentile, precision, recall, tally, type Confusion } from "./metrics";

export const CHECK_IDS = [
    "columns",
    "reading-order",
    "sections",
    "contact-email",
    "contact-phone",
    "dates",
    "date-format",
    "date-ranges",
    "page-count",
    "text-density",
    "font-size",
    "hidden-text",
    "prompt-injection",
] as const;

export interface Scores {
    precision: number | null;
    recall: number | null;
}

export interface CheckResult extends Scores {
    confusion: Confusion;
    falsePositives: string[];
    falseNegatives: string[];
}

export interface KeywordErrors {
    pair: string;
    term: string;
}

export interface DeterministicResults {
    datasetVersion: string;
    counts: { resumes: number; pairs: number; readablePairs: number; unsupported: number; jobs: number };
    checks: Record<string, CheckResult>;
    unsupported: { expected: number; detected: number; falseRejects: string[]; wrongCodes: string[] };
    extraction: {
        any: Scores & { confusion: Confusion };
        required: Scores & { confusion: Confusion };
        nice: Scores & { confusion: Confusion };
        classificationAccuracy: number | null;
        misclassified: { term: string; job: string; expected: "required" | "nice" }[];
        missed: { term: string; inDictionary: boolean; jobs: string[] }[];
        spurious: { term: string; jobs: string[] }[];
    };
    matching: Scores & { confusion: Confusion; falsePositives: KeywordErrors[]; falseNegatives: KeywordErrors[] };
    coverage: { mae: number; worst: { pair: string; expected: number; actual: number }[] };
    ranking: { comparisons: number; agree: number; ties: number; violations: number; violationPairs: string[] };
    determinism: { cases: number; identical: number };
    timingMs: { p50: number; p95: number };
}

const DICTIONARY = new Set(SKILLS.map((s) => s.name));
const names = (skills: { name: string }[]) => skills.map((s) => s.name);

async function read(resume: ResumeCase): Promise<ExtractedDoc> {
    return (await readPdf(resume.pdf(), { thumbnail: false })).doc;
}

function addTo(map: Map<string, Set<string>>, key: string, value: string) {
    map.set(key, (map.get(key) ?? new Set()).add(value));
}

function expectedCoverage(pair: Pair): number {
    const { job, resume } = pair;
    const has = (skill: string) => resume.mentions.includes(skill);
    const earned = job.required.filter(has).length + job.nice.filter(has).length * 0.5;
    const possible = job.required.length + job.nice.length * 0.5;
    return Math.round((earned / possible) * 100);
}

export async function runDeterministicEval(): Promise<DeterministicResults> {
    const readable = RESUMES.filter((r) => !r.unsupported);
    const timings: number[] = [];
    const docs = new Map<string, ExtractedDoc>();

    const unsupported = { expected: 0, detected: 0, falseRejects: [] as string[], wrongCodes: [] as string[] };
    for (const resume of RESUMES) {
        const started = performance.now();
        try {
            const doc = await read(resume);
            timings.push(performance.now() - started);
            docs.set(resume.id, doc);
            if (resume.unsupported) unsupported.expected++;
        } catch (err) {
            if (!resume.unsupported) unsupported.falseRejects.push(resume.id);
            else {
                unsupported.expected++;
                if ((err as { code?: string }).code === resume.unsupported) unsupported.detected++;
                else unsupported.wrongCodes.push(`${resume.id}: ${(err as { code?: string }).code}`);
            }
        }
        if (resume.unsupported && docs.has(resume.id)) unsupported.wrongCodes.push(`${resume.id}: not refused`);
    }

    const checks: Record<string, CheckResult> = {};
    for (const id of CHECK_IDS) checks[id] = { confusion: emptyConfusion(), precision: null, recall: null, falsePositives: [], falseNegatives: [] };
    for (const resume of readable) {
        const report = buildAtsReport(docs.get(resume.id)!, "");
        const flagged = new Set(report.checks.filter((c) => c.severity !== "ok").map((c) => c.id));
        for (const id of CHECK_IDS) {
            const predicted = flagged.has(id);
            const expected = resume.issues.includes(id);
            tally(checks[id].confusion, predicted, expected);
            if (predicted && !expected) checks[id].falsePositives.push(resume.id);
            if (!predicted && expected) checks[id].falseNegatives.push(resume.id);
        }
    }
    for (const id of CHECK_IDS) {
        checks[id].precision = precision(checks[id].confusion);
        checks[id].recall = recall(checks[id].confusion);
    }

    const any = emptyConfusion();
    const requiredConfusion = emptyConfusion();
    const niceConfusion = emptyConfusion();
    const missed = new Map<string, Set<string>>();
    const spurious = new Map<string, Set<string>>();
    let classified = 0;
    let classifiedRight = 0;
    const misclassified: DeterministicResults["extraction"]["misclassified"] = [];
    const jobs = [...new Map(PAIRS.map((p) => [p.job.id, p.job])).values()];
    for (const job of jobs) {
        const terms = extractJobTerms(job.description);
        const foundRequired = new Set(names(terms.required));
        const foundNice = new Set(names(terms.nice));
        const labeled = new Set([...job.required, ...job.nice]);
        const found = new Set([...foundRequired, ...foundNice]);

        for (const term of new Set([...labeled, ...found])) {
            tally(any, found.has(term), labeled.has(term));
            tally(requiredConfusion, foundRequired.has(term), job.required.includes(term));
            tally(niceConfusion, foundNice.has(term), job.nice.includes(term));
            if (labeled.has(term) && !found.has(term)) addTo(missed, term, job.id);
            if (found.has(term) && !labeled.has(term)) addTo(spurious, term, job.id);
            if (labeled.has(term) && found.has(term)) {
                classified++;
                if (foundRequired.has(term) === job.required.includes(term)) classifiedRight++;
                else misclassified.push({ term, job: job.id, expected: job.required.includes(term) ? "required" : "nice" });
            }
        }
    }

    // Resume matching: judged only on the terms the extractor found, so dictionary gaps don't count twice.
    const matching = emptyConfusion();
    const matchFp: KeywordErrors[] = [];
    const matchFn: KeywordErrors[] = [];
    const coverageErrors: { pair: string; expected: number; actual: number }[] = [];
    const readablePairs = PAIRS.filter((p) => !p.resume.unsupported);
    for (const pair of readablePairs) {
        const terms = extractJobTerms(pair.job.description);
        const result = matchKeywords(docs.get(pair.resume.id)!.text, terms);
        const matched = new Set([...(result?.required.matched ?? []), ...(result?.nice.matched ?? [])].map((m) => m.term));

        for (const term of new Set([...names(terms.required), ...names(terms.nice)])) {
            const expected = pair.resume.mentions.includes(term);
            tally(matching, matched.has(term), expected);
            if (matched.has(term) && !expected) matchFp.push({ pair: pair.id, term });
            if (!matched.has(term) && expected) matchFn.push({ pair: pair.id, term });
        }
        coverageErrors.push({ pair: pair.id, expected: expectedCoverage(pair), actual: result?.coverage ?? 0 });
    }

    // Ranking sanity without the AI: ATS readiness should never put a weaker tier above a stronger one.
    const ranking = { comparisons: 0, agree: 0, ties: 0, violations: 0, violationPairs: [] as string[] };
    const readiness = (pair: Pair) => computeScoring(buildAtsReport(docs.get(pair.resume.id)!, pair.job.description), 0).atsReadiness;
    for (const job of jobs) {
        const sameDomain = PAIRS.filter((p) => p.job.id === job.id && p.resume.variant === "base" && p.resume.domain === job.domain);
        const byTier = new Map(sameDomain.map((p) => [p.resume.tier, readiness(p)]));
        for (const [higher, lower] of [["strong", "average"], ["average", "weak"], ["strong", "weak"]] as const) {
            const a = byTier.get(higher);
            const b = byTier.get(lower);
            if (a === undefined || b === undefined) continue;
            ranking.comparisons++;
            if (a > b) ranking.agree++;
            else if (a === b) ranking.ties++;
            else {
                ranking.violations++;
                ranking.violationPairs.push(`${job.id}: ${higher} ${a} < ${lower} ${b}`);
            }
        }
    }

    let identical = 0;
    for (const pair of readablePairs) {
        const again = buildAtsReport(await read(pair.resume), pair.job.description);
        if (JSON.stringify(again) === JSON.stringify(buildAtsReport(docs.get(pair.resume.id)!, pair.job.description))) identical++;
    }

    const worst = [...coverageErrors].sort((a, b) => Math.abs(b.actual - b.expected) - Math.abs(a.actual - a.expected)).slice(0, 5);
    return {
        datasetVersion: datasetVersion(),
        counts: { resumes: RESUMES.length, pairs: PAIRS.length, readablePairs: readablePairs.length, unsupported: RESUMES.filter((r) => r.unsupported).length, jobs: jobs.length },
        checks,
        unsupported,
        extraction: {
            any: { confusion: any, precision: precision(any), recall: recall(any) },
            required: { confusion: requiredConfusion, precision: precision(requiredConfusion), recall: recall(requiredConfusion) },
            nice: { confusion: niceConfusion, precision: precision(niceConfusion), recall: recall(niceConfusion) },
            misclassified,
            classificationAccuracy: classified === 0 ? null : Math.round((classifiedRight / classified) * 10000) / 10000,
            missed: [...missed].map(([term, j]) => ({ term, inDictionary: DICTIONARY.has(term), jobs: [...j] })),
            spurious: [...spurious].map(([term, j]) => ({ term, jobs: [...j] })),
        },
        matching: { confusion: matching, precision: precision(matching), recall: recall(matching), falsePositives: matchFp, falseNegatives: matchFn },
        coverage: { mae: Math.round(mean(coverageErrors.map((e) => Math.abs(e.actual - e.expected))) * 100) / 100, worst },
        ranking,
        determinism: { cases: readablePairs.length, identical },
        timingMs: { p50: Math.round(percentile(timings, 50) * 10) / 10, p95: Math.round(percentile(timings, 95) * 10) / 10 },
    };
}
