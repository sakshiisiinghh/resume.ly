import { SKILLS } from "~/.server/ats/skills";
import type { DeterministicResults, Scores } from "./deterministic";
import { METRICS, type MetricName, type PromptSummary } from "./llm";

export interface ReportMeta {
    date: string;
    commit: string;
    datasetVersion: string;
}

const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(1)}%`);
const row = (...cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
const table = (header: string[], rows: (string | number)[][]) =>
    [row(...header), row(...header.map(() => "---")), ...rows.map((r) => row(...r))].join("\n");
const list = (items: string[]) => (items.length === 0 ? "None." : items.map((i) => `- ${i}`).join("\n"));
const prf = (s: Scores) => `${pct(s.precision)} / ${pct(s.recall)}`;

export function renderDeterministicReport(r: DeterministicResults, meta: ReportMeta): string {
    const checkRows = Object.entries(r.checks).map(([id, c]) => [id, pct(c.precision), pct(c.recall), c.confusion.tp, c.confusion.fp, c.confusion.fn]);
    const errors = Object.entries(r.checks).flatMap(([id, c]) => [
        ...c.falsePositives.map((resume) => `\`${id}\` flagged on \`${resume}\`, which has no such issue`),
        ...c.falseNegatives.map((resume) => `\`${id}\` missed on \`${resume}\``),
    ]);
    const { extraction, matching } = r;
    const dictionaryMisses = extraction.missed.filter((m) => !m.inDictionary);
    const dictionarySize = SKILLS.length;

    return `# Deterministic evaluation

Measures the parts of Resume.ly that don't call an AI model: PDF reading, the ATS checks, and keyword matching. The same dataset gives the same numbers every time.

| | |
|---|---|
| Date | ${meta.date} |
| Commit | \`${meta.commit}\` |
| Dataset version | \`${meta.datasetVersion}\` |
| Resumes | ${r.counts.resumes} (${r.counts.unsupported} deliberately unreadable) |
| Resume and job pairs | ${r.counts.pairs} (${r.counts.readablePairs} readable) |
| Skills in the dictionary | ${dictionarySize} |

## Read this first

- The dataset is **synthetic and small**. The resumes, job descriptions and labels were written by the same person who wrote the engine. Labels come from what each file was built to contain, not from the engine's output.
- The engine was **tuned on this same dataset** after the first run (see the findings in \`evals/README.md\`). The numbers below are therefore *not* a held-out estimate and say little about real-world resumes, which are messier. Treat them as a regression guard and a list of known gaps, not a claim of accuracy.
- Perfect scores on a few examples per check mean "no known failures here", not "always right".
- **Not measured in this report:** AI score consistency, ranking by the AI, latency and token use. Those need a Gemini key. See the LLM report.

## 1. Parseability checks

A check counts as "flagged" when its severity isn't ok. Each resume was built from a clean base with at most one thing broken, so the expected flags are known.

${table(["Check", "Precision", "Recall", "TP", "FP", "FN"], checkRows)}

Errors:

${list(errors)}

## 2. Unreadable PDFs

Scanned (image only) and malformed files must be refused with the right reason, and no readable file may be refused.

${table(["Expected refusals", "Refused with the right reason", "Readable files wrongly refused", "Wrong reasons"], [[r.unsupported.expected, r.unsupported.detected, r.unsupported.falseRejects.length, r.unsupported.wrongCodes.length]])}

## 3. Reading skills from the job description

Judged against the skills a reviewer would list for each of the ${r.counts.jobs} job descriptions. This includes skills the dictionary doesn't contain, so recall can't reach 100%.

${table(
    ["Group", "Precision / recall", "TP", "FP", "FN"],
    [
        ["All skills", prf(extraction.any), extraction.any.confusion.tp, extraction.any.confusion.fp, extraction.any.confusion.fn],
        ["Required", prf(extraction.required), extraction.required.confusion.tp, extraction.required.confusion.fp, extraction.required.confusion.fn],
        ["Nice to have", prf(extraction.nice), extraction.nice.confusion.tp, extraction.nice.confusion.fp, extraction.nice.confusion.fn],
    ]
)}

Required vs nice-to-have placed correctly, for skills that were found: **${pct(extraction.classificationAccuracy)}**.

Skills missed (${extraction.missed.length}): ${extraction.missed.length === 0 ? "none" : extraction.missed.map((m) => `${m.term}${m.inDictionary ? "" : " (not in the dictionary)"}`).join(", ")}.${dictionaryMisses.length === extraction.missed.length && extraction.missed.length > 0 ? " Every miss is a skill outside the dictionary; that is the main limit of this approach." : ""}

Skills wrongly found: ${extraction.spurious.length === 0 ? "none" : extraction.spurious.map((s) => `${s.term} (${s.jobs.join(", ")})`).join(", ")}.

Wrongly classified: ${extraction.misclassified.length === 0 ? "none" : extraction.misclassified.map((m) => `${m.term} in ${m.job}`).join(", ")}.

## 4. Finding those skills in a resume

Judged only on skills the extractor found, so dictionary gaps aren't counted twice. This is where the traps live: "go-to-market", "React to customer feedback", "Tailwind CSS" (which is not a separate CSS mention), and skill names split across a line wrap.

${table(["Precision", "Recall", "TP", "FP", "FN", "TN"], [[pct(matching.precision), pct(matching.recall), matching.confusion.tp, matching.confusion.fp, matching.confusion.fn, matching.confusion.tn]])}

False positives:

${list(matching.falsePositives.map((e) => `\`${e.term}\` in ${e.pair}`))}

False negatives:

${list(matching.falseNegatives.map((e) => `\`${e.term}\` in ${e.pair}`))}

## 5. Keyword coverage error

How far the reported coverage % is from what the labels say it should be, over ${r.counts.readablePairs} pairs. This includes the effect of skills the dictionary can't see.

**Mean absolute error: ${r.coverage.mae} points.**

${table(["Worst pairs", "Expected", "Reported"], r.coverage.worst.map((w) => [w.pair, `${w.expected}%`, `${w.actual}%`]))}

## 6. Ranking without the AI

ATS readiness (parseability and keywords only) for strong, average and weak resumes of the same candidate type against the same job. It should never put a weaker resume above a stronger one. It is not expected to separate writing quality; that is the AI's job.

${table(["Comparisons", "Correct order", "Ties", "Wrong order"], [[r.ranking.comparisons, r.ranking.agree, r.ranking.ties, r.ranking.violations]])}

${r.ranking.violationPairs.length ? list(r.ranking.violationPairs) : ""}

## 7. Determinism and speed

${table(["Pairs re-run from fresh PDF bytes", "Identical reports", "Read and check p50", "Read and check p95"], [[r.determinism.cases, r.determinism.identical, `${r.timingMs.p50} ms`, `${r.timingMs.p95} ms`]])}

## Known limitations

- Synthetic PDFs come from a simple generator (one font, absolute positions). Real PDFs from Word, LaTeX or Canva are messier, and extraction on them isn't measured here.
- Expected issues come from how each file was built; edge cases the author didn't think of aren't in the set.
- No held-out set: fixing the engine and measuring it used the same data.
- English-language resumes only.
`;
}

const fixed = (n: number, places = 2) => n.toFixed(places);

export interface LlmReportMeta extends ReportMeta {
    model: string;
    runsPerPair: number;
    pairs: number;
    productionPrompt: string;
    pricesGiven: boolean;
}

const LABELS: Record<MetricName, string> = {
    overall: "Overall (as the model reports it)",
    ats: "ATS (AI tips only; not in the final score)",
    toneAndStyle: "Tone & style",
    content: "Content",
    structure: "Structure",
    skills: "Skills",
    meanOfCategories: "Mean of the four categories",
    final: "Final score shown to users",
};

export function renderLlmReport(summaries: PromptSummary[], meta: LlmReportMeta): string {
    const [first, second] = summaries;
    const agreement = (s: PromptSummary, key: "overall" | "final") => {
        const c = s.ranking[key];
        return c.comparisons === 0 ? "n/a" : `${((c.agree / c.comparisons) * 100).toFixed(1)}% (${c.agree} of ${c.comparisons}; ${c.ties} ties, ${c.violations} wrong)`;
    };
    const head = summaries.map((s) => s.prompt);

    const summaryRows: (string | number)[][] = [
        ["Runs", ...summaries.map((s) => s.runs)],
        ["Valid output", ...summaries.map((s) => pct(s.validRate))],
        ["Needed a retry", ...summaries.map((s) => pct(s.retryRate))],
        ["Latency p50 / p95", ...summaries.map((s) => `${s.latencyMs.p50} / ${s.latencyMs.p95} ms`)],
        ["Tokens in / out per run", ...summaries.map((s) => `${s.tokens.meanIn} / ${s.tokens.meanOut}`)],
        ["Estimated cost", ...summaries.map((s) => (s.costUsd === null ? "not estimated" : `$${s.costUsd}`))],
    ];

    const spreadRows = METRICS.map((m) => [LABELS[m], ...summaries.map((s) => `${fixed(s.spread[m].meanStdev)} (max ${fixed(s.spread[m].maxStdev)}, range ${fixed(s.spread[m].meanRange)})`)]);

    const delta = second
        ? `\n### Change from ${first.prompt} to ${second.prompt}\n\n${table(
              ["Metric", "Std-dev change"],
              (["overall", "final"] as const).map((m) => [LABELS[m], `${fixed(second.spread[m].meanStdev - first.spread[m].meanStdev)} points`])
          )}\n\nA negative change means ${second.prompt} is more consistent. With ${meta.runsPerPair} runs on ${meta.pairs} pairs, differences of a point or less may be noise.\n`
        : "";

    const groupRows = summaries.flatMap((s) => s.groups.map((g) => [s.prompt, g.job, g.means.strong ?? "n/a", g.means.average ?? "n/a", g.means.weak ?? "n/a"]));

    const median = summaries.map((s) => (s.medianOf3 ? `${fixed(s.medianOf3.stdev)} vs ${fixed(s.medianOf3.singleStdev)} for one run` : "needs 3+ runs"));

    return `# AI evaluation

Measures how consistent and sensible the AI's scores are. Every number here comes from real model calls.

| | |
|---|---|
| Date | ${meta.date} |
| Commit | \`${meta.commit}\` |
| Model | \`${meta.model}\` |
| Prompt versions | ${head.join(", ")} (production: ${meta.productionPrompt}) |
| Dataset version | \`${meta.datasetVersion}\` |
| Pairs x repeats | ${meta.pairs} x ${meta.runsPerPair} |

## Read this first

- Resumes are synthetic, and there are only ${meta.pairs} pairs, so every number is an estimate with a wide margin.
- Standard deviation is measured **per pair across repeats of the identical input**, then averaged. It shows how much the score moves when nothing changed.
- Prompt changes were not tuned on this set before these runs.

## Summary

${table(["", ...head], summaryRows)}

${summaries.some((s) => s.failures.length) ? `Failures:\n\n${list(summaries.flatMap((s) => s.failures.map((f) => `${s.prompt}: ${f.message} (${f.count}x)`)))}\n` : ""}
## Score consistency (standard deviation in points)

${table(["Score", ...head], spreadRows)}
${delta}
### Would a median of three runs help?

Estimated by resampling the recorded runs (every combination of three), so it needs no extra calls. It costs about three times the calls and latency.

${table(["", ...head], [["Overall score std-dev with median of 3", ...median]])}

## Does the AI rank resumes sensibly?

Strong should outscore average, average should outscore weak, and strong should outscore weak, for the same job. Every run of the higher tier is compared with every run of the lower tier.

${table(["Score", ...head], [["Overall", ...summaries.map((s) => agreement(s, "overall"))], ["Final (with ATS engine)", ...summaries.map((s) => agreement(s, "final"))]])}

Average overall score by tier:

${table(["Prompt", "Job", "Strong", "Average", "Weak"], groupRows)}

## Known limitations

- The weak, average and strong resumes were written by one person, and "strong" means well-written, not that the candidate is better.
- The model can change behind the same name, so results can drift between dates.
- Latency depends on the network and the provider's load at that moment.
${meta.pricesGiven ? "" : "- Cost isn't estimated: set `EVAL_PRICE_IN_PER_MTOK` and `EVAL_PRICE_OUT_PER_MTOK` (USD per million tokens) to include it.\n"}`;
}
