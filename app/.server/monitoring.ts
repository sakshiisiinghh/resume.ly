import * as Sentry from "@sentry/node";
import { logger } from "~/.server/logger";

export interface ErrorReporter {
    capture(err: unknown, context?: Record<string, unknown>): void;
}

const nothing: ErrorReporter = { capture() {} };

let reporter: ErrorReporter = nothing;

/** Swaps the reporter. For tests. */
export const setErrorReporter = (next: ErrorReporter) => void (reporter = next);

export function initMonitoring({ dsn, environment, service }: { dsn?: string; environment: string; service: string }) {
    if (!dsn) return;

    Sentry.init({ dsn, environment, serverName: service, tracesSampleRate: 0 });
    reporter = { capture: (err, context) => void Sentry.captureException(err, { extra: context }) };
    logger.info({ service }, "error monitoring enabled");
}

/** For unexpected failures only. Expected ones (a bad PDF, a rate limit) aren't bugs and shouldn't page anyone. */
export function reportError(err: unknown, context?: Record<string, unknown>) {
    try {
        reporter.capture(err, context);
    } catch (reportingError) {
        logger.warn({ err: reportingError }, "could not report an error");
    }
}

export const flushMonitoring = (timeoutMs = 2000) => Sentry.flush(timeoutMs).catch(() => false);
