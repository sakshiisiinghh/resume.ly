# 1. Queue the heavy work

**Decision:** Uploads enqueue a BullMQ job on Redis and a separate worker process does the analysis.

**Why:** An analysis takes seconds to minutes (PDF parsing, an AI call that may be rate limited). Doing it in the request would tie up the web server, time out on slow calls, and lose work on a restart. A queue gives retries with backoff, a limiter for the AI provider, concurrency control and crash recovery, and the web server stays fast.

**Details:** The job id is the analysis's idempotency key, so a double submit doesn't run twice. A repeatable reaper job fixes analyses whose worker died.

**Alternatives:** Running in the request (simple, fragile); a Postgres-based queue (one less service, but no built-in limiter or backoff and more to write); a hosted queue (extra vendor).

**Cost:** Two processes and Redis to run. Redis being down means uploads fail fast with a clear error rather than hang.
