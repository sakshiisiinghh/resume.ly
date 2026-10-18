import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), flush: vi.fn().mockResolvedValue(true) }));
vi.mock("@sentry/node", () => sentry);

import { flushMonitoring, initMonitoring, reportError, setErrorReporter } from "../monitoring";

describe("monitoring", () => {
    beforeEach(() => {
        sentry.init.mockClear();
        sentry.captureException.mockClear();
    });

    it("sends nothing anywhere without a DSN", () => {
        initMonitoring({ environment: "production", service: "web" });
        reportError(new Error("boom"));

        expect(sentry.init).not.toHaveBeenCalled();
        expect(sentry.captureException).not.toHaveBeenCalled();
    });

    it("starts Sentry with the DSN, and reports without sending personal data or traces", () => {
        initMonitoring({ dsn: "https://key@example.ingest.sentry.io/1", environment: "production", service: "worker" });

        expect(sentry.init).toHaveBeenCalledWith({ dsn: "https://key@example.ingest.sentry.io/1", environment: "production", serverName: "worker", tracesSampleRate: 0 });

        const error = new Error("boom");
        reportError(error, { requestId: "req-1" });
        expect(sentry.captureException).toHaveBeenCalledWith(error, { extra: { requestId: "req-1" } });
    });

    it("passes errors and context to whatever reporter is set", () => {
        const capture = vi.fn();
        setErrorReporter({ capture });

        reportError(new Error("x"), { analysisId: "a" });

        expect(capture).toHaveBeenCalledWith(expect.any(Error), { analysisId: "a" });
    });

    it("never lets a broken reporter break the code that reported", () => {
        setErrorReporter({ capture: () => { throw new Error("sentry is down"); } });

        expect(() => reportError(new Error("x"))).not.toThrow();
    });

    it("can flush before the process exits", async () => {
        await expect(flushMonitoring()).resolves.toBe(true);
    });
});
