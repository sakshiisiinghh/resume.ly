# 7. Treat LLM quotas as a first-class failure

**Decision:** Provider errors are classified. A rate limit with a retry delay is retried after that delay and counts against the worker's request limiter. A used-up daily quota is a permanent failure with a clear message. The request limit is configurable.

**Why:** Running against a free Gemini key showed that rate limits are the normal case, not an edge case: 5 requests a minute, and daily caps that differ per model. Blind retries burn the remaining quota and show users a useless error. Retrying a daily cap is pointless, and an honest message is better.

**Details:** The default model is `gemini-3.1-flash-lite` because it had room on the free tier. The model is a single constant, kept in sync with the compose file and `.env.example` by a test. Thinking models bill their thinking as output tokens, which the token count includes.

**Cost:** On a free key, throughput is capped by the provider, not by this app. See the load test for how the app behaves without that limit.
