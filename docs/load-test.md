# Load test

What this measures: how the web server and the job queue behave when many people upload at once, and how throughput changes with the number of analyses a worker runs in parallel.

What it does not measure: the real AI provider. Gemini was replaced by a local stub (`scripts/stub-gemini.ts`) that answers after 3 to 4 seconds (3 s plus up to 1 s of random jitter), so the numbers show this app's overhead and queueing, not Google's latency or limits. A free Gemini key allows about 5 requests a minute, so real throughput on one is far lower than below.

## Setup

| | |
|---|---|
| Machine | Apple M2, 8 cores, 8 GB, Node v22.18.0, everything on one laptop |
| App | production build, `npm run start`, one web process, one worker |
| Data stores | PostgreSQL 16 and Redis 7 in Docker, local disk storage |
| AI | stub, 3 s + 0 to 1 s jitter, valid responses |
| Rate limits | off (`RATE_LIMIT_ENABLED=false`); they are tested separately |
| Load | 10 users x 4 uploads each = 40 analyses, up to 20 uploads at once |
| Command | `npm run load-test -- --users 10 --uploads 4 --concurrency 20` |

The script signs up the users, uploads a real PDF for each analysis, polls the database until every analysis finishes, then deletes the accounts. Each row below is one run.

## Results

| Worker concurrency | 2 | 4 | 8 |
|---|---|---|---|
| Uploads accepted | 40 / 40 | 40 / 40 | 40 / 40 |
| Upload response p50 / p95 | 79 / 90 ms | 105 / 192 ms | 188 / 331 ms |
| Analyses failed | 0 | 0 | 0 |
| Processing p50 / p95 | 3.58 / 4.06 s | 3.82 / 4.38 s | 3.68 / 4.75 s |
| Queue wait p50 / p95 | 33.9 / 66.6 s | 16.7 / 34.7 s | 8.1 / 15.4 s |
| End to end p50 / p95 | 37.1 / 70.2 s | 20.5 / 38.1 s | 11.7 / 19.0 s |
| Time to drain 40 analyses | 73.8 s | 40.4 s | 19.9 s |
| Throughput | 32.5 / min | 59.5 / min | 120.4 / min |

## What it shows

- **Uploads stay fast and never fail.** The upload request only validates, stores the file and enqueues the job, so it returns in under 350 ms even with all 40 queued. The slow work is off the request path.
- **Throughput scales with workers.** Doubling concurrency roughly doubled throughput each time (about 1.8x, then 2.0x). With a fixed 3 to 4 second AI call, work per analysis stays constant, so the queue wait is the part that shrinks.
- **Processing time barely moves** (3.6 to 3.8 s median). Most of it is the stub's wait; reading the PDF and running the checks is small next to it. At 8 the p95 rises a little (4.75 s) and uploads slow down, which is the laptop's CPU being shared by the web server, the worker, Postgres and Redis.
- **Where it would stop scaling:** this run does not reach a ceiling at 8. Past some point the limit is the machine's CPU (PDF reading and thumbnails are CPU work) and, with the real provider, its request limit. `LLM_REQUESTS_PER_MINUTE` exists so the worker stays under it instead of failing.

## Caveats

- One machine runs the load generator, the app, the worker and the databases, so they compete for the same CPU. A separate load generator would be fairer.
- 40 analyses per run and one run per setting: enough to see the trend, not enough for tight confidence intervals.
- The stub always succeeds, so this does not exercise retries or quota failures. Those are covered by the unit and integration tests.
- All uploads use the same generated one-page PDF, so reading time doesn't vary by document size.

## Reproduce

```bash
docker compose up -d postgres redis
npm run db:migrate
STUB_LATENCY_MS=3000 STUB_JITTER_MS=1000 npm run stub:gemini &
npm run build
GEMINI_BASE_URL=http://localhost:4010 GEMINI_API_KEY=stub RATE_LIMIT_ENABLED=false WORKER_CONCURRENCY=4 npm run worker &
RATE_LIMIT_ENABLED=false npm run start &
npm run load-test -- --users 10 --uploads 4 --concurrency 20
```

`--json <file>` saves the summary. Add `--keep` to leave the test accounts in place.
