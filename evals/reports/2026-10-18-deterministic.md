# Deterministic evaluation

Measures the parts of Resume.ly that don't call an AI model: PDF reading, the ATS checks, and keyword matching. The same dataset gives the same numbers every time.

| | |
|---|---|
| Date | 2026-10-18 |
| Commit | `88550bc + uncommitted changes` |
| Dataset version | `bffeb81c8c3c` |
| Resumes | 25 (2 deliberately unreadable) |
| Resume and job pairs | 37 (35 readable) |
| Skills in the dictionary | 125 |

## Read this first

- The dataset is **synthetic and small**. The resumes, job descriptions and labels were written by the same person who wrote the engine. Labels come from what each file was built to contain, not from the engine's output.
- The engine was **tuned on this same dataset** after the first run (see the findings in `evals/README.md`). The numbers below are therefore *not* a held-out estimate and say little about real-world resumes, which are messier. Treat them as a regression guard and a list of known gaps, not a claim of accuracy.
- Perfect scores on a few examples per check mean "no known failures here", not "always right".
- **Not measured in this report:** AI score consistency, ranking by the AI, latency and token use. Those need a Gemini key. See the LLM report.

## 1. Parseability checks

A check counts as "flagged" when its severity isn't ok. Each resume was built from a clean base with at most one thing broken, so the expected flags are known.

| Check | Precision | Recall | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| columns | 100.0% | 100.0% | 2 | 0 | 0 |
| reading-order | 100.0% | 100.0% | 1 | 0 | 0 |
| sections | 100.0% | 100.0% | 1 | 0 | 0 |
| contact-email | 100.0% | 100.0% | 2 | 0 | 0 |
| contact-phone | 100.0% | 100.0% | 1 | 0 | 0 |
| dates | 100.0% | 100.0% | 1 | 0 | 0 |
| date-format | 100.0% | 100.0% | 1 | 0 | 0 |
| date-ranges | 100.0% | 100.0% | 1 | 0 | 0 |
| page-count | 100.0% | 100.0% | 1 | 0 | 0 |
| text-density | 100.0% | 100.0% | 1 | 0 | 0 |
| font-size | 100.0% | 100.0% | 1 | 0 | 0 |
| hidden-text | 100.0% | 100.0% | 1 | 0 | 0 |
| prompt-injection | 100.0% | 100.0% | 1 | 0 | 0 |

Errors:

None.

## 2. Unreadable PDFs

Scanned (image only) and malformed files must be refused with the right reason, and no readable file may be refused.

| Expected refusals | Refused with the right reason | Readable files wrongly refused | Wrong reasons |
| --- | --- | --- | --- |
| 2 | 2 | 0 | 0 |

## 3. Reading skills from the job description

Judged against the skills a reviewer would list for each of the 6 job descriptions. This includes skills the dictionary doesn't contain, so recall can't reach 100%.

| Group | Precision / recall | TP | FP | FN |
| --- | --- | --- | --- | --- |
| All skills | 100.0% / 93.0% | 66 | 0 | 5 |
| Required | 100.0% / 100.0% | 42 | 0 | 0 |
| Nice to have | 100.0% / 82.8% | 24 | 0 | 5 |

Required vs nice-to-have placed correctly, for skills that were found: **100.0%**.

Skills missed (5): ClickHouse (not in the dictionary), Prisma (not in the dictionary), tRPC (not in the dictionary), MLflow (not in the dictionary), dbt (not in the dictionary). Every miss is a skill outside the dictionary; that is the main limit of this approach.

Skills wrongly found: none.

Wrongly classified: none.

## 4. Finding those skills in a resume

Judged only on skills the extractor found, so dictionary gaps aren't counted twice. This is where the traps live: "go-to-market", "React to customer feedback", "Tailwind CSS" (which is not a separate CSS mention), and skill names split across a line wrap.

| Precision | Recall | TP | FP | FN | TN |
| --- | --- | --- | --- | --- | --- |
| 100.0% | 100.0% | 244 | 0 | 0 | 155 |

False positives:

None.

False negatives:

None.

## 5. Keyword coverage error

How far the reported coverage % is from what the labels say it should be, over 35 pairs. This includes the effect of skills the dictionary can't see.

**Mean absolute error: 3.09 points.**

| Worst pairs | Expected | Reported |
| --- | --- | --- |
| fullstack-average × fullstack-ts | 74% | 82% |
| data-strong × data-ml | 94% | 100% |
| data-strong × data-eng | 81% | 87% |
| fullstack-strong × fullstack-ts | 95% | 100% |
| data-average × data-ml | 76% | 81% |

## 6. Ranking without the AI

ATS readiness (parseability and keywords only) for strong, average and weak resumes of the same candidate type against the same job. It should never put a weaker resume above a stronger one. It is not expected to separate writing quality; that is the AI's job.

| Comparisons | Correct order | Ties | Wrong order |
| --- | --- | --- | --- |
| 18 | 18 | 0 | 0 |



## 7. Determinism and speed

| Pairs re-run from fresh PDF bytes | Identical reports | Read and check p50 | Read and check p95 |
| --- | --- | --- | --- |
| 35 | 35 | 2.1 ms | 8.2 ms |

## Known limitations

- Synthetic PDFs come from a simple generator (one font, absolute positions). Real PDFs from Word, LaTeX or Canva are messier, and extraction on them isn't measured here.
- Expected issues come from how each file was built; edge cases the author didn't think of aren't in the set.
- No held-out set: fixing the engine and measuring it used the same data.
- English-language resumes only.
