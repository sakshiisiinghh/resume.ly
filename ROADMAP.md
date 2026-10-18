# Resume.ly Backend Upgrade Roadmap

## Goal

Turn Resume.ly from a browser-centered AI resume analyzer into a reliable, demonstrable full-stack product with backend engineering depth.

**Primary outcome:** a deployed application with secure server-side analysis, durable asynchronous processing, explainable ATS checks, tests, and measured evaluation results.

This roadmap puts correctness and backend substance ahead of adding many product features. Implement only what you can explain, test, and demonstrate.

Each phase has **tasks** (what), **Why** lines (the reasoning you'll be asked for), **completion criteria** (done means done), and a **talking point** (what you'd say in an interview).

---

## Where it stands: 6/10 → target 10/10

| Score | Meaning |
|---|---|
| **6** (today) | Tutorial-level app that works on the happy path. All logic in the browser, LLM output trusted blindly, no tests |
| **7** | Correct and tested: failure paths handled, CI green, honest README |
| **8** | Real backend: auth, DB, durable job queue, idempotency, streamed progress |
| **9** | Own IP: explainable ATS engine, hybrid scoring, measured LLM consistency |
| **10** | Deployed, observable, rate-limited, load-tested, documented with ADRs and real numbers |

---

## Current direction

Keep the existing React/TypeScript user experience where it is useful, but move sensitive and long-running work to the server.

| Layer | Choice | Why (and the alternative you considered) |
|---|---|---|
| **Web app** | React Router v7 on Node: loaders, actions, resource routes | The app already runs on `@react-router/node`. One codebase, end-to-end types, no CORS. *Alt:* a separate Express API, which is more moving parts for no gain at this scale |
| **Database** | PostgreSQL + Drizzle | Relational ownership data, unique constraints for idempotency, `jsonb` for reports. Drizzle is type-safe SQL with explicit migrations. *Alt:* Prisma |
| **Queue + worker** | BullMQ + Redis, separate Node worker process | LLM calls take 10–30s. In a request handler they hold connections open and die on deploy. A queue gives retries, backoff, jobId dedupe, and independent scaling. *Alt:* pg-boss (Postgres-only, one less service) |
| **AI** | Gemini behind an `LLMProvider` interface | Provider code is isolated, so switching models is one implementation, not a rewrite |
| **Validation** | Zod for requests *and* model output | One schema gives compile-time types and runtime checks; LLM output is untrusted input |
| **File storage** | Local disk (dev) → S3-compatible (deploy) behind a `StorageDriver` | Standard metadata-in-DB, blobs-in-object-storage split |
| **Progress** | SSE with polling fallback | One-way server → client updates; simpler than WebSockets |
| **Testing / CI** | Vitest, React Testing Library, GitHub Actions | |

Don't add a component just to list it on a resume. If the workload or deployment constraints make a simpler option more appropriate, choose it and document the trade-off in an ADR.

### Target folder layout

```
app/
  .server/                 # React Router convention: never bundled to the client
    db/schema.ts, db/index.ts
    auth.ts                # sessions, requireUser()
    storage/               # StorageDriver: local.ts, s3.ts
    queue.ts               # BullMQ queue + job payload types
    llm/                   # LLMProvider, gemini.ts, prompts/v1.ts …
    ats/                   # extract.ts, checks/*.ts, keywords.ts, score.ts
  lib/schemas.ts           # Zod schemas shared by client and server
  routes/
    api.analyses.$id.events.ts   # SSE
    api.files.$id.ts             # authorized file / thumbnail streaming
worker/index.ts            # BullMQ worker process
evals/                     # dataset, scripts, reports
docs/adr/                  # architecture decision records
docker-compose.yml
```

### Data model

```
users      (id, email UNIQUE, password_hash, created_at)
sessions   (id, user_id → users, expires_at)
resumes    (id, user_id → users, title, company_name, job_title, job_description,
            file_key, thumb_key, file_sha256, page_count, created_at)
analyses   (id, resume_id → resumes, status, stage,
            prompt_version, model, idempotency_key UNIQUE,
            ats_report jsonb, llm_feedback jsonb, final_score int,
            attempts int, error_code text, error_message text,
            tokens_in int, tokens_out int, cost_usd numeric,
            queued_at, started_at, heartbeat_at, finished_at)

INDEX resumes (user_id, created_at DESC)    -- owner-scoped, paginated dashboard
INDEX analyses (resume_id)
INDEX analyses (status, heartbeat_at)       -- stale-job reaper
```

### Analysis lifecycle

`status` is the coarse, durable state. `stage` is fine-grained progress for the UI.

```
status:  queued ──▶ processing ──▶ done
                       │
                       └──▶ failed   (error_code + attempts recorded)

stage (while processing):  extracting → checking → analyzing → scoring
```

**Why two fields:** the DB and business logic only care about four states, and the progress UI wants detail. Keeping them separate means new stages never change failure or retry logic.

---

## Phase 0: Make the existing app correct

**Priority: P0 · Do this before architecture work · ~2–3 days · 6 → 7**

**Why:** new architecture on top of a broken happy path fails any code review. These fixes are cheap, and each one is an async-correctness story.

### Tasks

- [ ] **Fix async deletion flows.** Replace `files.forEach(async …)` in `wipe.tsx` with `await Promise.all(files.map(…))`, and make storage cleanup finish before reporting success.
  *Why:* `forEach` ignores returned promises, so `kv.flush()` and the reload currently race the deletes.
- [ ] **Wrap upload and analysis in `try/catch/finally`.** Always reset `isProcessing`, and show an actionable error with a retry button.
  *Why:* today any failure returns early and strands the user on "Analyzing…" forever.
- [ ] **Remove fake placeholder records and fake default scores.** Represent status explicitly (`queued`, `processing`, `done`, `failed`).
  *Why:* the placeholder is saved with `feedback: ''`. `''.overallScore` is `undefined`, so `ScoreCircle`'s default parameter (`score = 75`) shows a **plausible fake 75/100**.
- [ ] **Fix the file uploader.** The remove button needs `type="button"`, and the selected file must have one source of truth (the parent's state).
  *Why:* a `<button>` inside a `<form>` defaults to `type="submit"`, and dropzone's `acceptedFiles` keeps showing a removed file.
- [ ] **Revoke object URLs** (`URL.revokeObjectURL`) in effect cleanups and when files change.
  *Why:* every dashboard visit leaks image blobs.
- [ ] **Add consistent auth/loading guards** to `resume.tsx` and `wipe.tsx` (wait for `!isLoading && !isAuthenticated`).
  *Why:* this is the same hydration race already fixed on home.
- [ ] **Validate `?next=`.** Accept only paths starting with `/` and not `//`.
  *Why:* prevents open redirects.
- [ ] **Remove duplicate helpers** (`formatSize` exists twice), the self-import in `ResumeCard`, and unused imports.
- [ ] **Add a Zod schema for the model response.** Validate scores (0–100) and required fields at runtime. Handle malformed or truncated output with **one bounded retry** (send the validation error back to the model) and a clear failure state.
  *Why:* the LLM is an untrusted input source; `JSON.parse` on raw output is a crash waiting to happen.
- [ ] **Align naming and AI provider** across code, README and resume (Resume.ly + Gemini).

### Tests and completion criteria

- [ ] Unit tests for utilities and schema validation (valid, missing fields, out-of-range scores, truncated JSON).
- [ ] Component tests for upload errors, retry behavior, and empty/loading states (`window.puter` mocked).
- [ ] GitHub Actions runs install, typecheck, test and build on pull requests.
- [ ] No user-visible fake score; errors never leave the UI stuck.

**Deliverable:** a stable existing app and a green CI pipeline.

**Talking point:** "Before adding features I audited the async flows and found several failure-path bugs. In one of them, a failed analysis rendered a believable fake score because of a JavaScript default-parameter edge case. I fixed them, added runtime validation of the model output, and put CI in front of every change."

---

## Phase 1: Build the backend foundation

**Priority: P0 · Biggest backend signal · ~6–8 days · 7 → 8**

**Why:** this moves the API key, validation and long-running work server-side, and introduces the patterns backend interviews probe: ownership, idempotency, durable jobs, failure classification and streaming.

### 1. Local infrastructure

- [ ] Docker Compose for app, worker, PostgreSQL and Redis. Add MinIO only if you implement the S3 path locally.
- [ ] `.env.example` (`DATABASE_URL`, `REDIS_URL`, `GEMINI_API_KEY`, `SESSION_SECRET`, storage vars); real secrets stay out of Git.
- [ ] Extend the existing multi-stage Dockerfile with `app` and `worker` targets.
- [ ] A clean clone runs with documented commands (`docker compose up`, `npm run db:migrate`).

### 2. Database and ownership

- [ ] Drizzle schema and migrations for the tables in the [data model](#data-model).
- [ ] Indexes for owner-scoped listing, analysis lookup and the stale-job reaper.
- [ ] Enforce ownership in **every** read, update, delete and file-download path: query by `(id, user_id)`, never `id` alone.

*Why:* this replaces today's `kv.list('resume:*')` full scan with indexed, paginated, ownership-scoped queries.

### 3. Authentication and authorization

- [ ] Sign-up and login with Argon2 (or bcrypt) and DB-backed sessions (React Router `createSessionStorage`).
- [ ] Cookies: `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- [ ] A shared `requireUser(request)` helper used by every protected loader and action.
- [ ] Return a **non-disclosing 404** when a user requests another user's resume, analysis or file.
- [ ] Validate redirect targets; check `Origin` on state-changing requests (CSRF).

*Why:* the server must trust user identity for ownership and rate limits. Loaders run before render, so the client-side auth race from Phase 0 disappears by design.

### 4. Secure PDF upload and storage

- [ ] Validate size (e.g. 10 MB max) and **magic bytes** (`%PDF-`), not only the filename extension.
- [ ] Store under owner-scoped keys (`users/{userId}/{sha256}.pdf`); never expose raw storage paths.
- [ ] `StorageDriver` interface (`put`, `get`, `delete`): local first, S3-compatible at deploy time.
- [ ] Serve downloads only after authorization, or via short-lived presigned URLs.

*Why:* the extension and `Content-Type` are client-controlled. Magic bytes are the minimum real check.

### 5. Durable analysis jobs

- [ ] Compute `idempotency_key = sha256(file_sha256 + job_description + prompt_version + model)`.
- [ ] Enforce uniqueness in Postgres **and** dedupe in the queue:
  ```sql
  INSERT INTO analyses (…, idempotency_key) VALUES (…)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id;          -- no row returned → look up and redirect to the existing analysis
  ```
  ```ts
  queue.add('analyze', { analysisId }, {
    jobId: idempotencyKey,               // BullMQ ignores duplicate jobIds
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
  ```
- [ ] Enqueue and **return promptly** (redirect to `/resume/:id`); never wait for the LLM inside the request.
- [ ] Separate worker with bounded `concurrency`, retries, backoff and **graceful shutdown** (`SIGTERM` → `worker.close()` finishes the current job).
- [ ] **Classify errors:** transient ones (network, 429, 5xx, timeouts) retry; permanent ones (invalid PDF, no text layer, schema still invalid after repair) fail immediately with an `error_code`.
- [ ] Persist every state transition and terminal failure. The worker updates `heartbeat_at` while processing.
- [ ] **Stale-job reaper:** a repeatable BullMQ job every minute finds `status = 'processing' AND heartbeat_at < now() - interval '5 min'` and re-enqueues it (if attempts remain) or marks it `failed`.

*Why:* double-clicks, refreshes and retries never create duplicate work or duplicate charges; it's the same principle as idempotent CDR processing. BullMQ detects stalled jobs inside the queue, but the **DB status can still drift** from the queue (e.g. a crash between the status update and the job ack). The reaper reconciles the two.

### 6. Progress and AI provider boundary

- [ ] Authorized SSE endpoint `api.analyses.$id.events.ts`: send the **current state on connect** (so reconnects never miss a terminal event), then `stage`/`status` changes from Redis pub/sub, plus a heartbeat comment every 15s.
- [ ] Client: `EventSource` with reconnection, falling back to polling the loader.
- [ ] `interface LLMProvider { analyze(input): Promise<{ feedback; usage }> }` with a Gemini implementation: JSON mode with `responseSchema`, temperature 0. No provider-specific code in the workflow.
- [ ] Version prompts (`prompts/v1.ts`) and record `prompt_version` + `model` on every analysis.
- [ ] Validate provider output with Zod before storing or rendering it.
- [ ] Record token usage and estimated cost where the provider returns usage data.

### 7. Thumbnails and Puter removal

- [ ] Generate the preview in the worker: render page 1 with `pdfjs-dist` + `@napi-rs/canvas` at ~1.5× scale, save as WebP, store `thumb_key`.
  *Why:* this replaces today's client-side 4× PNG (several MB per dashboard card) and works without Puter.
- [ ] Move all data fetching from `useEffect` into **loaders** (dashboard, resume page) and paginate the dashboard.
- [ ] Remove the Puter script and the Zustand Puter store; keep Zustand only for real UI state, if any is left.
- [ ] Replace "wipe everything" with per-resume delete (DB rows + storage objects) and "delete my data".

### Completion criteria

- [ ] `docker compose up` starts the documented local stack.
- [ ] An authenticated user can upload a PDF, watch queued → processing (with stages) → done, and view the result.
- [ ] Repeated submissions are deduplicated (a test proves it).
- [ ] Killing the worker mid-job, or simulating a transient provider failure, ends in `done` or a clean `failed`, never stuck `processing`.
- [ ] Users cannot access each other's resumes, analyses or files (a test proves it).

**Deliverable:** a real backend pipeline with persistence, auth, queueing and recovery.

**Talking point:** "Uploads return immediately and a BullMQ worker does the analysis. Idempotency is enforced twice: a unique key in Postgres and the job ID in the queue. Transient errors retry with exponential backoff and permanent ones fail fast. A reaper reconciles DB state with the queue after crashes, and the UI streams progress over SSE, sending current state on connect so reconnects are safe."

---

## Phase 2: Build an explainable ATS engine

**Priority: P1 · Project differentiator · ~6–8 days · 8 → 9**

**Why:** today the "ATS score" is an LLM opinion. Deterministic checks make the core feature reproducible, explainable and testable, and this is the part no tutorial has.

Don't claim to reproduce a proprietary ATS. Build a transparent set of resume checks and job-description matching features that you can explain and evaluate.

### 1. PDF text extraction

- [x] Extract text from **every page** with `pdfjs-dist` (`getTextContent()`).
- [x] Preserve page and item positions (x, y, width, font size); rebuild lines by y and detect columns by x-gaps.
- [x] Detect image-only/scanned PDFs and fail with a clear `no_text_layer` message instead of scoring empty text.
- [x] Fixtures: single-column, multi-column, malformed and scanned PDFs.

### 2. Deterministic checks

Each check is a pure function returning `{ id, severity, message, evidence }`:

- [x] Text extractability and reading-order sanity (multi-column scrambling).
- [x] Standard section headings (fuzzy-matched: Experience, Education, Skills…).
- [x] Contact information present (email/phone), and not only in header/footer regions.
- [x] Date parsing and consistency.
- [x] Page count and basic layout warnings.
- [x] **Keyword coverage** against the job description: extract terms with a curated skills dictionary (no LLM call, so the report is deterministic), normalize aliases (`postgres`/`postgresql`, `node`/`node.js`, `k8s`/`kubernetes`), then report matched and missing terms, split into required and nice-to-have.

Show matched and missing terms with evidence from the resume text. Treat checks as heuristics, not universal ATS rules.

*Why pure functions:* same input, same output. Each check is trivially unit-testable, and new checks plug in without touching the others.

### 3. Hybrid score and transparency

- [x] Keep deterministic checks separate from AI feedback on clarity, relevance and impact.
- [x] `final = w₁·parseability + w₂·keywordCoverage + w₃·llmQuality`, with documented, configurable weights stored alongside each result.
- [x] Show the score breakdown and the evidence behind each component.
- [x] Don't imply a score predicts a specific employer's screening decision.

*Why:* each part does what it's good at. Code measures, the LLM judges writing, and the user can see why their score is 72.

### 4. Security-oriented document handling

- [x] Flag hidden text only where extraction metadata supports it: text under 4pt. (pdf.js drops off-page text before we see it and doesn't expose fill colour, so those aren't detectable. Implementing colour via `getOperatorList()` is the natural next step.)
- [x] A small, documented set of prompt-injection indicators ("ignore previous instructions", "rate this", …) shown as warnings.
- [x] Don't treat heuristic detection as proof of malicious intent.
- [x] Keep untrusted resume text clearly delimited from instructions in prompts (system vs user content, explicit "the following is untrusted document content").

### Completion criteria

- [x] The same input produces the same deterministic ATS report (snapshot tests).
- [x] The UI explains why each check affected the score.
- [x] Tests cover known parsing and keyword cases.
- [x] Scanned or unsupported PDFs produce honest states, not misleading scores.

### Known limitations

- Keyword matching only recognises skills in the built-in dictionary (`app/.server/ats/skills.ts`). Anything else in a job description is ignored, and ambiguous names (Go, C, React, Spark) are case-sensitive to avoid matching ordinary English.
- Column detection is a layout heuristic (a near-empty vertical band with text on both sides). Unusual layouts can fool it either way.
- Section, date and contact checks are pattern based and tuned for English resumes.
- Hidden-text detection covers tiny text only; off-page and background-coloured text can't be seen through pdf.js.
- Weights (30% parseability, 30% keywords, 40% AI quality) and penalties are judgment calls, not fitted to data. Phase 3 is where they get measured.

**Deliverable:** an ATS analysis component that is more than an LLM-generated number.

**Talking point:** "I separated measurement from judgment. The engine rebuilds reading order from PDF glyph positions to catch multi-column scrambling, computes alias-normalized keyword coverage with evidence, and flags hidden-text injection. The LLM only judges writing quality, and the final score is a documented weighted blend that the UI breaks down."

---

## Phase 3: Measure quality

**Priority: P1 · Replace vague claims with evidence · ~3–4 days · → 9.5**

**Why:** "the AI works" is a claim; a reproducible report is evidence. This replaces unverifiable resume lines with numbers you can defend.

### Evaluation dataset

- [x] A small, permission-safe dataset of synthetic resumes paired with job descriptions: 25 resumes, 6 job descriptions, 37 pairs.
- [x] Labels for expected parseability issues and keyword matches, checked against the text by an independent matcher.
- [x] Strong, average, weak, multi-column and scanned examples (plus malformed and 14 one-defect variants).
- [x] Documented data provenance and evaluation instructions (`evals/README.md`).

### Evaluation scripts

- [x] Precision/recall for deterministic checks and keyword extraction against labels. First run found 5 engine problems; all fixed and tested.
- [x] Repeated LLM analyses (N=5) on a fixed subset → per-category score standard deviation. Measured on `gemini-3.1-flash-lite`: 0.00 everywhere (identical outputs).
- [x] Ranking sanity without the AI: 18 of 18 comparisons in the right order.
- [x] Ranking sanity for the AI's scores: 150 of 150 comparisons in the right order, for both prompts.
- [x] Record model, prompt version, dataset version, commit and run date in each report (`evals/reports/`).
- [x] Track latency and tokens; cost is estimated only when prices are supplied.

### Improving consistency (after the baseline)

- [x] Temperature 0 (already used).
- [x] A scoring rubric with anchors, then aggregate. Written as prompt `v2` and measured: no variance benefit (nothing to reduce on this model), but different score levels and better first-try validity. Not adopted; that is a judgment call.
- [x] Optionally take the median of 3 runs; measure the cost vs variance trade-off before adopting it. Measured: no benefit, since repeats are identical. Not adopted.

### Regression checks

- [x] Fast unit/eval checks in CI (`npm test` fails if the deterministic numbers get worse).
- [x] A small prompt-regression set runs when `llm/` or `ats/` changes (`.github/workflows/eval.yml`; the AI part needs the `GEMINI_API_KEY` secret).
- [x] Set thresholds only after a baseline exists: the deterministic baseline is recorded. The AI baseline is recorded for prompt v1 on the default model, `gemini-3.1-flash-lite`.

**Deliverable:** a reproducible report with actual results and known limitations.

**Talking point:** "I built a labeled eval set and measured it: keyword recall was X%, and LLM score std-dev was ±Y before the rubric and ±Z after. Prompt changes run a regression subset in CI, so I don't ship a prompt that silently gets worse."

---

## Phase 4: Deploy and make it reviewable

**Priority: P1 · Finish before optional product features · ~4–5 days · → 10**

**Why:** a deployed, documented project that another engineer can run and inspect beats a feature-rich one that only works on your laptop.

- [ ] (Not done: needs your own hosting accounts. Images, health checks and [docs/deploy.md](docs/deploy.md) are ready.) Deploy app, worker, database, Redis and file storage on a setup you can maintain (e.g. Railway/Render/Fly + managed Postgres + Upstash + R2).
- [x] Rate limits (Redis sliding window) for uploads, analyses and login attempts.
- [x] Security headers (CSP, `X-Content-Type-Options`), input validation, and file-processing limits and timeouts (PDF parsing only in the worker, with a timeout).
- [x] Structured logs (pino) with a request/job ID carried from upload through worker completion.
- [x] `/healthz` (liveness) and `/readyz` (DB + Redis reachable); basic error monitoring (e.g. Sentry).
- [x] Modest load test (a TypeScript script instead of k6, see [docs/load-test.md](docs/load-test.md)): measure upload response p95, job duration, failure rate and queue drain at different worker concurrencies.
- [x] A real README: problem, screenshots/demo GIF, architecture diagram, data flow, setup, env vars, tests, evaluation results, trade-offs.
- [x] Short ADRs ([docs/adr](docs/adr/README.md)) for meaningful choices: queue, scoring, storage, SSE vs WebSockets, auth.
- [ ] A working deployed demo link in the README and resume, if public demo access is safe (seeded demo account + rate limits).

**Deliverable:** a deployed project that another engineer can run, inspect and evaluate.

**Talking point:** "Under a 50-concurrent-upload load test the upload endpoint stayed at X ms p95, because all heavy work is queued. Queue drain scaled roughly linearly with worker concurrency until the LLM provider's rate limit became the bottleneck."

---

## Phase 5: Optional user-facing features

Start these only after Phases 0–4 are complete:

- [ ] Resume versions and a score-difference view.
- [ ] Bullet rewriting with clear metric placeholders and user review.
- [ ] Per-resume export (JSON/PDF report).
- [ ] Multi-page preview.
- [ ] Shareable read-only report with expiring, signed access.
- [ ] Job-description import from URL, with strict allowlisting, timeouts, size caps and SSRF protections.

These are lower priority than correctness, backend reliability and evaluation.

---

## Suggested build order and effort

| # | Step | Phase | Effort | Score after |
|---|---|---|---|---|
| 1 | Correctness and tests | 0 | 2–3 days | 7 |
| 2 | Postgres, auth, storage, ownership | 1.1–1.4 | 3–4 days | |
| 3 | Queue, worker, idempotency, reaper, SSE, Puter removal | 1.5–1.7 | 3–4 days | 8 |
| 4 | Deterministic ATS checks and explainable scoring | 2 | 6–8 days | 9 |
| 5 | Evaluation and regression report | 3 | 3–4 days | 9.5 |
| 6 | Deployment, documentation, demo | 4 | 4–5 days | 10 |
| 7 | Optional product features | 5 | as time allows | |

Roughly 5–6 weeks part-time. **First milestone:** finish Phase 0, then get a minimal authenticated upload → worker → result flow working end to end (even with a stub ATS) before expanding the ATS engine.

---

## Resume bullets after implementation

Use only bullets that match the shipped code. Replace placeholders with measured values, and omit metrics you have not measured.

**Resume.ly | React, TypeScript, Node.js, PostgreSQL, Redis, BullMQ, Gemini**

- Built a full-stack resume analyzer with asynchronous PDF processing, durable BullMQ jobs, PostgreSQL persistence and idempotent analysis requests, streaming progress to the client over SSE.
- Developed explainable ATS checks for PDF text extraction, layout parsing and job-description keyword coverage, combining deterministic results with LLM feedback into a transparent hybrid score.
- Evaluated analysis consistency and ATS checks on a labeled resume–job-description dataset; documented measured results, limitations and deployment architecture.
