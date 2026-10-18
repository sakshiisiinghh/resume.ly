import { UnrecoverableError } from "bullmq";

// Failing again won't help, so BullMQ skips its remaining retries.
// `detail` is for logs and evals only; `message` is safe to show to a user.
export class PermanentError extends UnrecoverableError {
    constructor(message: string, readonly code: string, readonly detail?: string) {
        super(message);
    }
}

export class TransientError extends Error {
    constructor(message: string, readonly code = "transient", readonly detail?: string, readonly retryAfterMs?: number) {
        super(message);
    }
}

export const retryAfterOf = (err: unknown) => (err instanceof TransientError ? err.retryAfterMs : undefined);

export const detailOf = (err: unknown) => (err instanceof PermanentError || err instanceof TransientError ? err.detail : undefined);

export function failureInfo(err: unknown): { code: string; message: string } {
    if (err instanceof PermanentError || err instanceof TransientError) {
        return { code: err.code, message: err.message };
    }
    return { code: "unexpected", message: "Something went wrong while analyzing this resume." };
}

export function isFinalFailure(err: Error, attemptsMade: number, maxAttempts: number) {
    return err instanceof PermanentError || attemptsMade >= maxAttempts;
}
