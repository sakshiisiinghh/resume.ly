# 6. Rate limits fail open

**Decision:** Limits use a Redis sliding window (login per IP and per email, signup, analyses). If Redis is slow or down, the request is allowed and a warning is logged.

**Why:** The limits are protection, not part of the product. Locking everyone out because a counter store hiccuped is worse than briefly not limiting. Uploads need Redis for the queue anyway, so a Redis outage is already visible there.

**Details:** Failed logins count against the email separately from the IP, so one address can't guess passwords across many IPs, and a successful login doesn't use up the allowance. Denied requests don't extend their own window. The store has a contract test run against both an in-memory and a real Redis implementation.

**Cost:** During a Redis outage, brute-force protection is off. Behind a proxy, `TRUST_PROXY` must be set or every visitor shares one limit.
