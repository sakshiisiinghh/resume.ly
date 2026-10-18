# 3. Storage behind an interface

**Decision:** Files go through a `StorageDriver` (`put`, `get`, `delete`) with `LocalStorage` and `S3Storage`. S3 is used when `S3_BUCKET` is set.

**Why:** Local disk is easiest for development but doesn't work when the web server and worker run on different machines, which is how most hosts run them. S3-compatible storage works with AWS, R2, Backblaze and local S3 servers.

**Details:** Keys are checked against path traversal. A missing object returns `null`, not an error. S3 is tested with a mocked client and, in CI, against a real S3-compatible server (adobe/s3mock).

**Cost:** A bucket and credentials to manage. Deleting a resume removes the database row and the files separately, so the two stores can drift if one call fails.
