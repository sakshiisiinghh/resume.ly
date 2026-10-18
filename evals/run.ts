import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_GEMINI_MODEL, PROMPT_VERSION } from "../constants";
import { GeminiProvider } from "~/.server/llm/gemini";
import { isPromptVersion, type PromptVersion } from "~/.server/llm/prompts";
import { LLM_PAIRS, datasetVersion } from "./dataset";
import { findLlmRegressions, findRegressions, toBaseline, toLlmBaseline, type Baseline, type LlmBaseline, type Regression } from "./lib/baseline";
import { runDeterministicEval } from "./lib/deterministic";
import { FileRunStore } from "./lib/cache";
import { MIN_VALID_RATE, runLlmEval, summarize } from "./lib/llm";
import { renderDeterministicReport, renderLlmReport } from "./lib/report";

try {
    process.loadEnvFile();
} catch {}

const BASELINE = "evals/baseline.json";
const LLM_BASELINE = "evals/baseline.llm.json";
const REPORTS = "evals/reports";
const CACHE = "evals/.cache/llm-runs.json";

const USAGE = `Usage: tsx evals/run.ts <deterministic|llm> [options]

deterministic   Check the ATS engine against the labeled dataset. No API key needed.
  --write-baseline   Record the current numbers as the baseline (review the diff first).
  --check            Exit 1 if anything is worse than the baseline.

llm             Measure the AI's consistency and ranking. Needs GEMINI_API_KEY.
  --runs <n>         Repeats per pair (default 5, or 3 with --quick).
  --prompts <list>   Comma-separated prompt versions, e.g. v1,v2 (default: the production one).
  --quick            3 pairs, 3 repeats. Meant for CI.
  --fresh            Ignore saved runs. By default valid runs are kept in evals/.cache so a run
                     cut short by a daily limit can be finished on another day.
  --concurrency <n>  Parallel calls (default 3).
  --rpm <n>          Requests per minute to stay under (default 4; free Gemini keys allow 5 per model).
                     Use 0 for no limit on a paid plan. Also settable with EVAL_REQUESTS_PER_MINUTE.
  --write-baseline   Record the production prompt's numbers as the baseline.
  --check            Compare with the baseline; exit 1 on a regression.
  --tolerance <pts>  How much worse the std-dev may get before --check fails (default 1.5).

Optional: EVAL_PRICE_IN_PER_MTOK and EVAL_PRICE_OUT_PER_MTOK (USD per million tokens) add a cost estimate.`;

const today = () => new Date().toISOString().slice(0, 10);

function commit(): string {
    const git = (args: string) => execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    try {
        return git("status --porcelain -- app evals constants") ? `${git("rev-parse --short HEAD")} + uncommitted changes` : git("rev-parse --short HEAD");
    } catch {
        return "unknown";
    }
}

function write(path: string, content: string) {
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
}

function reportRegressions(regressions: Regression[]) {
    if (regressions.length === 0) return console.log("No regressions against the baseline.");
    console.error("Regressions against the baseline:");
    for (const r of regressions) console.error(`  ${r.metric}: ${r.baseline} -> ${r.current ?? "n/a"}`);
    process.exitCode = 1;
}

async function deterministic(flags: { "write-baseline"?: boolean; check?: boolean }) {
    const results = await runDeterministicEval();
    const meta = { date: today(), commit: commit(), datasetVersion: results.datasetVersion };

    write(`${REPORTS}/${meta.date}-deterministic.md`, renderDeterministicReport(results, meta));
    write(`${REPORTS}/${meta.date}-deterministic.json`, JSON.stringify(results, null, 2));

    const { extraction, matching } = results;
    console.log(`checks: ${Object.values(results.checks).filter((c) => (c.precision ?? 1) < 1 || (c.recall ?? 1) < 1).length} of ${Object.keys(results.checks).length} below 100%`);
    console.log(`extraction precision ${extraction.any.precision} recall ${extraction.any.recall}; matching precision ${matching.precision} recall ${matching.recall}; coverage MAE ${results.coverage.mae}`);
    console.log(`determinism ${results.determinism.identical}/${results.determinism.cases}; ranking violations ${results.ranking.violations}`);

    if (flags["write-baseline"]) {
        writeFileSync(BASELINE, `${JSON.stringify(toBaseline(results, meta.date), null, 2)}\n`);
        console.log(`wrote ${BASELINE}`);
    }
    if (flags.check) {
        if (!existsSync(BASELINE)) return console.log("No baseline recorded yet; run with --write-baseline.");
        const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
        if (baseline.datasetVersion !== results.datasetVersion) {
            console.error(`The dataset changed (${baseline.datasetVersion} -> ${results.datasetVersion}). Review it, then re-record with --write-baseline.`);
            process.exitCode = 1;
            return;
        }
        reportRegressions(findRegressions(results, baseline));
    }
}

async function llm(flags: { runs?: string; prompts?: string; quick?: boolean; fresh?: boolean; concurrency?: string; rpm?: string; "write-baseline"?: boolean; check?: boolean; tolerance?: string }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error("GEMINI_API_KEY isn't set. Add it to .env (a key from Google AI Studio) and run this again.");
        process.exit(1);
    }

    const prompts = (flags.prompts ?? PROMPT_VERSION).split(",").map((p) => p.trim());
    const unknown = prompts.find((p) => !isPromptVersion(p));
    if (unknown) {
        console.error(`Unknown prompt version "${unknown}".`);
        process.exit(1);
    }

    const model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
    const runs = Number(flags.runs ?? (flags.quick ? 3 : 5));
    const pairs = flags.quick ? LLM_PAIRS.slice(0, 3) : LLM_PAIRS;
    const prices = process.env.EVAL_PRICE_IN_PER_MTOK && process.env.EVAL_PRICE_OUT_PER_MTOK
        ? { inPerMTok: Number(process.env.EVAL_PRICE_IN_PER_MTOK), outPerMTok: Number(process.env.EVAL_PRICE_OUT_PER_MTOK) }
        : undefined;

    const rpm = Number(flags.rpm ?? process.env.EVAL_REQUESTS_PER_MINUTE ?? 4);
    const calls = pairs.length * runs * prompts.length;
    console.log(`${pairs.length} pairs x ${runs} runs x ${prompts.length} prompt(s) = ${calls} calls on ${model}`);
    console.log(rpm > 0 ? `Limited to ${rpm} requests a minute, so this takes about ${Math.ceil(calls / rpm)} minutes.` : "No request limit.");
    const provider = new GeminiProvider(model, key, process.env.GEMINI_BASE_URL);
    const store = flags.fresh ? undefined : new FileRunStore(CACHE);
    let stoppedBecause: string | undefined;
    const records = await runLlmEval({
        cache: store,
        onStop: (reason) => (stoppedBecause = reason),
        provider,
        pairs,
        prompts: prompts as PromptVersion[],
        runs,
        concurrency: Number(flags.concurrency ?? 3),
        requestsPerMinute: rpm > 0 ? rpm : undefined,
        onProgress: (done, total) => process.stdout.write(`\r${done}/${total} calls`),
    });
    process.stdout.write("\n");

    const summaries = prompts.map((p) => summarize(records, p as PromptVersion, prices));
    if (stoppedBecause) {
        const done = records.filter((r) => r.ok).length;
        console.error(`\nStopped early: the provider's daily limit is used up (${stoppedBecause}).`);
        console.error(`${done} of ${calls} runs are valid so far${store ? " and saved. Run the same command again after the limit resets (midnight Pacific time) to continue where this left off" : ""}. A paid key, or another model via GEMINI_MODEL, avoids the daily cap.`);
        process.exit(1);
    }
    if (summaries.every((s) => s.valid === 0)) {
        console.error("Every call failed, so nothing was measured and no report was written. The reasons:");
        for (const failure of new Set(summaries.flatMap((s) => s.failures.map((f) => f.message)))) console.error(`  ${failure}`);
        process.exit(1);
    }
    const runDates = [...new Set(records.map((r) => r.at ?? today()))].sort();
    const meta = { date: today(), commit: commit(), datasetVersion: datasetVersion(), model, runDates, runsPerPair: runs, pairs: pairs.length, productionPrompt: PROMPT_VERSION, pricesGiven: Boolean(prices) };
    const slug = `${meta.date}-llm-${model}`;

    write(`${REPORTS}/${slug}.md`, renderLlmReport(summaries, meta));
    write(`${REPORTS}/${slug}.json`, JSON.stringify({ meta, summaries, records }, null, 2));

    for (const s of summaries) {
        console.log(`${s.prompt}: valid ${s.valid}/${s.runs}, overall std-dev ${s.spread.overall?.meanStdev ?? "n/a"}, final std-dev ${s.spread.final?.meanStdev ?? "n/a"}`);
    }

    const incomplete = summaries.filter((s) => s.validRate < MIN_VALID_RATE);
    if (incomplete.length) {
        console.error(`\nIncomplete: ${incomplete.map((s) => `${s.prompt} had ${s.runs - s.valid} failed calls`).join(", ")}. The report is marked incomplete and no baseline will be recorded. Failure reasons:`);
        for (const failure of new Set(incomplete.flatMap((s) => s.failures.map((f) => f.message)))) console.error(`  ${failure}`);
        process.exitCode = 1;
    }

    const production = summaries.find((s) => s.prompt === PROMPT_VERSION) ?? summaries[0];
    const baselineMeta = { model, datasetVersion: meta.datasetVersion, recordedAt: meta.date, runsPerPair: runs };
    if (flags["write-baseline"] && (production.validRate < MIN_VALID_RATE || !production.spread.overall)) {
        console.error(`Not recording a baseline from an incomplete run (${production.prompt}: ${production.valid} of ${production.runs} valid).`);
    } else if (flags["write-baseline"]) {
        writeFileSync(LLM_BASELINE, `${JSON.stringify(toLlmBaseline(production, baselineMeta), null, 2)}\n`);
        console.log(`wrote ${LLM_BASELINE}`);
    }
    if (flags.check) {
        if (!existsSync(LLM_BASELINE)) return console.log("No AI baseline recorded yet; run `npm run eval:llm -- --write-baseline` once to create it.");
        const baseline = JSON.parse(readFileSync(LLM_BASELINE, "utf8")) as LlmBaseline;
        if (baseline.model !== model) return console.log(`The AI baseline was recorded on ${baseline.model}, not ${model}, so it can't be compared. Record one for this model with --write-baseline.`);
        reportRegressions(findLlmRegressions(production, baseline, { stdevTolerance: Number(flags.tolerance ?? 1.5) }));
    }
}

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
        "write-baseline": { type: "boolean" },
        check: { type: "boolean" },
        quick: { type: "boolean" },
        runs: { type: "string" },
        prompts: { type: "string" },
        concurrency: { type: "string" },
        fresh: { type: "boolean" },
        rpm: { type: "string" },
        tolerance: { type: "string" },
        help: { type: "boolean" },
    },
});

const [command = "deterministic"] = positionals;
if (values.help || !["deterministic", "llm"].includes(command)) {
    console.log(USAGE);
} else if (command === "deterministic") {
    await deterministic(values);
} else {
    await llm(values);
}
