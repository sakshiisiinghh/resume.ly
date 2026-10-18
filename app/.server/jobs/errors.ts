import { UnrecoverableError } from "bullmq";

// Failing again won't help, so BullMQ skips its remaining retries.
export class PermanentError extends UnrecoverableError {
    constructor(message: string, readonly code: string) {
        super(message);
    }
}

export class TransientError extends Error {
    constructor(message: string, readonly code = "transient") {
        super(message);
    }
}

export function failureInfo(err: unknown): { code: string; message: string } {
    if (err instanceof PermanentError || err instanceof TransientError) {
        return { code: err.code, message: err.message };
    }
    return { code: "unexpected", message: "Something went wrong while analyzing this resume." };
}

export function isFinalFailure(err: Error, attemptsMade: number, maxAttempts: number) {
    return err instanceof PermanentError || attemptsMade >= maxAttempts;
}
