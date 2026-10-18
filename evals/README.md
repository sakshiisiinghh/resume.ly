# Evaluating Resume.ly

Numbers instead of claims. This folder holds a labeled dataset, the scripts that measure the ATS engine and the AI against it, the reports they write, and the baselines CI guards.

## Status

| What | Measured? |
|---|---|
| PDF reading, ATS checks, keyword matching, ranking without the AI, determinism | **Yes.** See [the latest report](reports/). |
| AI score consistency, ranking by the AI, latency, tokens, prompt v1 vs v2, median of three | **Yes, on one model: `gemini-3.1-flash-lite`** (60 calls, 2026-10-18). Results below. Not yet on the default model `gemini-3.8-flash`, whose free tier allows only 20 requests a day. |
| An AI baseline for CI | **No.** It's recorded per model, and which model to ship is still open. |

## AI results

Measured on `gemini-3.1-flash-lite`, 6 pairs x 5 repeats x 2 prompts, all 60 runs valid. Full numbers are in the report; the findings are:

- **Repeats gave identical scores.** The standard deviation is 0.00 for every score and both prompts, and each pair's five runs matched down to the exact output token count. For identical input this model is deterministic at temperature 0. It could also be provider-side caching; the effect on this test is the same.
- **So there was no noise to reduce.** A scoring rubric (v2) or a median of three runs can't improve consistency that is already perfect, and the median would triple the cost. This measures sampling noise only. How much the score moves when the *input* changes slightly (a re-exported PDF, different line wrapping) is **not measured**.
- **Ranking was right every time.** Strong beat average beat weak in 150 of 150 comparisons for both prompts.
- **The prompts differ in level, not noise.** v2 scored strong resumes a little lower (88 vs 92) and average ones much lower (55 and 68 vs 65 and 78), so it spreads the tiers further apart. There is no ground truth for what the right score is, so this report can't say which is better. That's a judgment call.
- **Validity is the real difference.** Valid on the first try: v1 83%, v2 100%. v1 needed the corrective retry on one resume every time, and on another it failed outright.
- **Speed and size.** Median latency 3.8 s (v1) and 5.7 s (v2), 95th percentile 13 to 16 s. About 1.2K tokens in and 1.0 to 1.1K out per run, including the model's hidden reasoning tokens, which are billed as output. Cost isn't estimated.

### A bug the AI run found

With prompt v1, one resume failed validation on **all 5 runs**: the model left out the `explanation` text of a tip, and the schema required it. Because the model is deterministic, a retry returns the same output, so that resume would have failed for every user. The explanation is a nicety, so it is now optional (an empty one is shown as just the tip). After the fix all 30 v1 runs were valid.

### Running it on a free key

Free Gemini keys are limited per model, and the limits are tight: 5 requests a minute, plus a daily cap (20 requests a day on `gemini-3.8-flash`; the lite model allowed at least 55). The eval copes:

- It paces itself (`--rpm`, default 4) and waits when the provider says to.
- It stops at once on a daily limit instead of making doomed calls.
- It saves every valid run in `evals/.cache` (gitignored), keyed by the exact input and model, so run the same command again after the limit resets (midnight Pacific time) and it only does what is missing. `--fresh` ignores the saved runs.
- If runs span several days the report says so, because a model can change behind the same name.

## Commands

| Command | What it does |
|---|---|
| `npm run eval` | Runs the deterministic evaluation and writes `reports/<date>-deterministic.md`. No key needed. |
| `npm run eval:baseline` | Records the current deterministic numbers as the baseline. Review the diff before committing it. |
| `npm run eval:llm` | Runs the AI evaluation. Needs `GEMINI_API_KEY`. Options: `--runs`, `--prompts v1,v2`, `--quick`, `--rpm`, `--fresh`, `--check`, `--write-baseline`, `--tolerance`. |
| `npm test` | Includes a regression test: the deterministic numbers may not get worse than `baseline.json`. |

Add `EVAL_PRICE_IN_PER_MTOK` and `EVAL_PRICE_OUT_PER_MTOK` (USD per million tokens) to include a cost estimate. Without them only tokens are reported, because prices change and aren't guessed.

## The dataset

Synthetic and hand-written, so there is no personal data and no permission question. It lives in `dataset/` as readable TypeScript. PDFs are generated from it on the fly, so the same code always gives the same files.

- **25 resumes.** Three domains (backend, full-stack, data) at three quality levels each (strong, average, weak), plus 14 variants of one strong resume that each break **one** thing: two-column layout, interleaved columns, no email, no phone, mixed date formats, reversed dates, no dates, hidden keyword-stuffing text, an instruction-like sentence, three pages, tiny font, very little text, a renamed Skills heading, and an email only in the footer. Two more files are unreadable on purpose: a scanned (image-only) PDF and a malformed one.
- **6 job descriptions** with required and nice-to-have skills.
- **37 pairs** (35 readable). Each resume is paired with the descriptions for its domain, and the variants with one backend job. A few cross-domain pairs test a poor match.
- **A version hash** over every file and label. If the dataset changes, the baseline must be re-recorded on purpose.

### How it was labeled

Labels come from how each file was *built*, not from what the engine says.

- **Expected check failures.** A variant starts from a clean resume and changes one thing, so which check should fire is known by construction. The clean bases are expected to trigger nothing.
- **Skills.** Each resume and each job description lists the skills it really contains, by canonical name. `__tests__/dataset.test.ts` checks every label against the real extracted text with a deliberately simple matcher that is independent of the engine's.
- **A skill named inside a longer one isn't a separate mention.** "Tailwind CSS" is not a mention of "CSS".
- **Planted traps**, written to look like real text: `go-to-market` and `R&D`, a sentence starting with "React to customer feedback", a job sentence starting with "Express ownership", and skills the dictionary doesn't know (ClickHouse, Prisma, tRPC, MLflow, dbt).

## What each number means

| Measure | Definition |
|---|---|
| Check precision / recall | Over resumes: a check is "flagged" when its severity isn't ok. Precision is how many flags were real; recall is how many real issues were flagged. |
| Skill extraction | Skills found in a job description vs the skills a reviewer would list, including ones outside the dictionary. |
| Skill matching | For skills the extractor found, whether it found them in the resume when the label says they're there. Judged separately so a dictionary gap isn't counted twice. |
| Coverage error | Mean absolute difference, in points, between the reported keyword coverage and what the labels imply. |
| Ranking | Strong should beat average, average should beat weak, strong should beat weak, for the same job and candidate type. |
| Determinism | Every readable pair is re-read from fresh bytes; the two reports must be identical. |
| AI std-dev | Per pair, across repeats of the identical input (sample std-dev), then averaged across pairs. |
| Median of three | Estimated from the recorded runs (every combination of three), so it needs no extra calls. Costs about 3x. |
| AI ranking agreement | Every run of the higher tier compared with every run of the lower tier; ties and wrong orders are counted separately. |

## What the first run found

The first run of the deterministic evaluation showed problems the unit tests had missed. Each was fixed in the engine and given a unit test.

| Finding | First run | After the fix | Fix |
|---|---|---|---|
| Two-column pages merged left and right text at the same height into one line, so section headings were lost | `sections` precision 33% (2 false positives) | 100% | Lines are built per column |
| "Tailwind CSS" was also counted as "CSS", and phrases like "REST APIs" counted twice per mention | 4 matching false positives; inflated counts | 0 | Skills inside a longer skill are dropped; overlapping matches count once |
| Ordinary English read as skills ("React to customer feedback", "Express ownership of your work") | 3 spurious skills; required precision 78% | 100% | Ambiguous names count only with tech context |
| Headings like "A plus:" and "It would be great if you also know:" weren't recognised as nice-to-have | Section placement correct 86% | 100% | Heading cues |
| A skill name split by a line wrap ("Tailwind" / "CSS") was missed | counted a bare CSS instead | fixed | Spaces in skill names match any whitespace |

One discrepancy was a bug in the evaluation itself (ranking compared resumes across domains, producing 4 phantom violations), and it was fixed in the harness.

### Label corrections

Some first-run discrepancies were my labeling mistakes. Each was corrected from what the text says, not from what would improve a number, but they were found by looking at the results:

- Concurrency added as required for `backend-go` ("Strong Go experience, including concurrency").
- Hibernate moved from nice-to-have to required for `backend-java` ("PostgreSQL with Hibernate", under "What you'll need").
- Prisma added to the full-stack strong resume, which mentions it.
- Unit Testing added as required for `fullstack-frontend` ("Unit tests with Jest").

## Prompt versions

`v1` is what ships. `v2` is `v1` plus a scoring rubric (what a 40, 70 or 90 means, a definition for each category, and "overall is the mean of the four categories"). On `gemini-3.1-flash-lite` it did not reduce noise, because there was none to reduce (see AI results). It does change the score levels and gave 100% first-try validity vs 83% for v1. Switching is a judgment call about which levels you want, not something the data decides. To switch, change `PROMPT_VERSION` in `constants/index.ts`. Existing analyses keep the version they were created with, and new ones re-analyse because the version is part of the idempotency key.

## Regression checks

- `npm test` runs the deterministic evaluation and fails if any metric is worse than `baseline.json`. Changing the dataset also fails it until the baseline is re-recorded on purpose.
- `.github/workflows/eval.yml` runs when `constants/`, `app/.server/llm/`, `app/.server/ats/` or `evals/` change. It always runs the deterministic check. If the repository has a `GEMINI_API_KEY` secret it also runs the AI regression (`--quick`, about 9 calls), which compares against `baseline.llm.json`. That file doesn't exist yet, so the AI check currently only reports. A baseline is tied to the model it was recorded on; a check on a different model is skipped with a notice.
- Model output is noisy, so the AI check allows a tolerance (default 1.5 points of std-dev). Thresholds come from a recorded baseline, not from guesses.

## Limitations

- Synthetic, small, and written by the author of the engine. The engine was tuned on this same data after the first run, so the post-fix numbers are **not a held-out estimate** and say little about real resumes.
- The PDFs come from a simple generator (one font, absolute positions). Word, LaTeX and Canva output is messier, and extraction on it isn't measured.
- The skills dictionary has 125 entries, so skills outside it are invisible. All five misses in the first report are of this kind.
- English only.
- The AI numbers come from one model and 6 pairs, and only measure repeat-to-repeat noise on identical input.
