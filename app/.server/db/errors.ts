const UNIQUE_VIOLATION = "23505";

// Drizzle wraps driver errors, so the Postgres code can be on `cause`.
export function isUniqueViolation(err: unknown): boolean {
    const code = (e: unknown) => (e as { code?: string } | undefined)?.code;
    return code(err) === UNIQUE_VIOLATION || code((err as { cause?: unknown } | undefined)?.cause) === UNIQUE_VIOLATION;
}
