# Deploying Resume.ly

The app needs four things: somewhere to run a container, PostgreSQL, Redis, and a place to keep uploaded files. It has not been deployed from this repository yet, so treat the steps as a checklist to follow, not a record of something that has been done.

## What runs

| Process | What it does | Image target |
|---|---|---|
| Web | Serves the site, handles sign-in, uploads and the progress stream | `app` |
| Worker | Reads the PDF, runs the ATS checks, calls Gemini, saves the result | `worker` |
| Both in one | Runs the migrations, then the web server and the worker side by side | `combined` (the last stage of the Dockerfile, so a host that builds the default stage gets it) |

Use `app` and `worker` as two services when you can scale them separately. Use `combined` for a single small instance. Either way there is one job queue, so the worker can be scaled to several copies.

## Before you start

1. **PostgreSQL 16** and **Redis 7**, reachable from the container. Managed ones work (Neon, Supabase, Upstash and similar). Redis must support the commands BullMQ uses; a plain Redis does.
2. **An S3-compatible bucket** (AWS S3, Cloudflare R2, Backblaze B2, ...). Local disk only works when the web server and worker share a volume, which most hosts don't allow. Create a private bucket and an access key limited to it.
3. **A Gemini API key** from Google AI Studio. Free keys are tightly limited per model (5 requests a minute, and a daily cap). Set `LLM_REQUESTS_PER_MINUTE` to stay under yours.
4. **A `SESSION_SECRET`**: at least 32 random characters, for example `openssl rand -hex 32`. Keep it the same across restarts, or everyone is signed out.

## Settings

Set these as environment variables on every process. Nothing is read from a `.env` file in production.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | | `postgres://user:password@host:5432/db`. Add `?sslmode=require` if the host needs it. |
| `REDIS_URL` | yes | | `redis://...` or `rediss://...` for TLS. |
| `SESSION_SECRET` | yes | | 32 or more characters. |
| `GEMINI_API_KEY` | worker | | The worker refuses to start without it. |
| `GEMINI_MODEL` | no | `gemini-3.1-flash-lite` | The AI model the evaluation was measured on. |
| `LLM_REQUESTS_PER_MINUTE` | no | unlimited | Jobs started per minute. Set it for free-tier keys. |
| `WORKER_CONCURRENCY` | no | `2` | Analyses at once per worker. 1 to 16. |
| `S3_BUCKET` | for S3 | | Setting this switches storage from local disk to S3. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | with `S3_BUCKET` | | Required when `S3_BUCKET` is set; startup fails otherwise. |
| `S3_ENDPOINT` | for non-AWS | | R2 and B2 need it. Leave unset for AWS S3. |
| `S3_REGION` | no | `auto` | Use the real region for AWS. |
| `S3_FORCE_PATH_STYLE` | no | `false` | `true` for servers that don't support bucket subdomains. |
| `STORAGE_DIR` | no | `./storage` | Local disk only; ignored when `S3_BUCKET` is set. |
| `PORT` | no | `3000` | Web server port. |
| `TRUST_PROXY` | behind a proxy | `false` | Number of proxies in front of the app, usually `1`. Without it every visitor looks like the proxy and per-IP limits don't work. Never set it when the app is exposed directly: clients could then forge their address. |
| `RATE_LIMIT_ENABLED` | no | `true` | Turn off only for load tests. |
| `RATE_LIMIT_MULTIPLIER` | no | `1` | Scales every limit. |
| `LOG_LEVEL` | no | `info` | `fatal` to `trace`, or `silent`. |
| `SENTRY_DSN` | no | | Turns on error reporting. Nothing is sent without it. |

## First deploy

1. Build the images, or let the host build from the Dockerfile. Pick the target for each service (`app` and `worker`, or `combined`).
2. Create the database and set `DATABASE_URL`.
3. **Run the migrations once**, before the first request: `npm run db:migrate` (the `combined` image does this on start). Migrations are safe to run again. Run them from one place, not from several copies at once.
4. Start the web service and the worker.
5. Check `GET /healthz` (the process is up) and `GET /readyz` (the database and Redis answer; it also shows queue depth). Point your host's health check at `/healthz`, and any alerting at `/readyz`.
6. Create an account, upload a PDF and watch it finish. If it stays "queued", the worker isn't running or can't reach Redis. If it fails, the analysis page says why; the worker logs have the detail.

## Behind a proxy or load balancer

- Set `TRUST_PROXY=1` (or the real number of hops) so rate limits use the visitor's address.
- The progress stream (`/api/resumes/:id/events`) is a long-lived response. Make sure the proxy doesn't buffer it or close it after a short idle time; it sends a keep-alive comment every 15 seconds. If the stream can't connect, the page falls back to polling.
- Terminate HTTPS at the proxy. The app sends HSTS only when it sees HTTPS through a trusted proxy.

## Scaling

- More analyses at once: raise `WORKER_CONCURRENCY`, or run more workers. See [load-test.md](load-test.md) for how throughput scaled.
- The real limit is usually the AI provider's request limit, not the app. Set `LLM_REQUESTS_PER_MINUTE` to what your key allows, across all workers.
- The web server holds no state, so it can run as several copies.

## Backups and cleanup

- Back up PostgreSQL (accounts, analyses) and the bucket (the PDFs and thumbnails). They are separate: deleting a resume removes its row and its files together, but a restore of one without the other leaves orphans.
- A stuck analysis is found by a reaper in the worker (it checks every minute) once it has had no heartbeat for five minutes, then re-queued or failed.

## Logs and monitoring

- Logs are JSON, one line each, with a `requestId`. The same id appears on the upload request and on the worker's lines for that analysis, so one search follows it end to end.
- The worker logs, for each analysis, how long it waited, and how long reading the PDF, the checks and the AI took.
- Resume text and job descriptions are never logged.
- Set `SENTRY_DSN` to send unexpected server and worker errors to Sentry. Expected failures (a bad PDF, a rate limit, an AI quota) aren't reported as errors. Errors in the browser aren't collected.

## Things to know

- `gemini-3.1-flash-lite` on a free key has a daily request cap. When it is used up, analyses fail with a clear message instead of retrying. A paid key removes the cap.
- Rate limits are stored in Redis. If Redis is down the limiter lets requests through (and logs it), because uploads need Redis anyway and a limiter outage shouldn't lock everyone out.
- Not tested here: any specific hosting provider. The container images, the health checks and the settings above are what a host needs; the provider-specific steps are yours to follow.
