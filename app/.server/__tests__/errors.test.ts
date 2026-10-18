import { UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";
import { PermanentError, TransientError, failureInfo, isFinalFailure } from "~/.server/jobs/errors";

describe("isFinalFailure", () => {
    it("is final immediately for permanent errors, however many attempts remain", () => {
        expect(isFinalFailure(new PermanentError("bad pdf", "invalid_pdf"), 1, 3)).toBe(true);
    });

    it("recognises permanent errors even though BullMQ renames the subclass", () => {
        const err = new PermanentError("bad pdf", "invalid_pdf");
        expect(err).toBeInstanceOf(UnrecoverableError);
        expect(err.name).not.toBe("UnrecoverableError");
        expect(isFinalFailure(err, 1, 3)).toBe(true);
    });

    it("retries transient errors until attempts run out", () => {
        const err = new TransientError("overloaded", "llm_unavailable");
        expect(isFinalFailure(err, 1, 3)).toBe(false);
        expect(isFinalFailure(err, 2, 3)).toBe(false);
        expect(isFinalFailure(err, 3, 3)).toBe(true);
    });
});

describe("failureInfo", () => {
    it("keeps the code and message of known errors", () => {
        expect(failureInfo(new PermanentError("no text", "no_text_layer"))).toEqual({ code: "no_text_layer", message: "no text" });
    });

    it("hides the details of unknown errors", () => {
        expect(failureInfo(new Error("ECONNREFUSED 10.0.0.5"))).toEqual({
            code: "unexpected",
            message: "Something went wrong while analyzing this resume.",
        });
    });
});
