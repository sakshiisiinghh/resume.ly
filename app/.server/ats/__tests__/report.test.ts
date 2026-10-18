import { describe, expect, it } from "vitest";
import { atsReportSchema } from "~/lib/ats";
import { buildAtsReport } from "../index";
import { readPdf } from "~/.server/pdf";
import { buildPdf, cleanResumeLines, columnItems } from "../../../../test/pdf";
import { PAGE, docFromLines, pageOfLines, run } from "../../../../test/doc";
import { buildDocument } from "../document";

const JOB = ["Backend Engineer", "Requirements:", "- Go, PostgreSQL and Redis", "- Docker and Kubernetes on AWS", "- REST APIs and gRPC", "Nice to have:", "- Kafka", "- Terraform"].join("\n");

describe("buildAtsReport", () => {
    it("matches the golden report for a clean resume", () => {
        expect(buildAtsReport(docFromLines(cleanResumeLines), JOB)).toMatchSnapshot();
    });

    it("gives the same report for the same input", () => {
        const doc = docFromLines(cleanResumeLines);

        expect(buildAtsReport(doc, JOB)).toEqual(buildAtsReport(doc, JOB));
    });

    it("gives the same report when the PDF is parsed again", async () => {
        const bytes = buildPdf([{ items: columnItems(cleanResumeLines) }]);

        const [a, b] = await Promise.all([readPdf(bytes), readPdf(bytes)]);

        expect(buildAtsReport(a.doc, JOB)).toEqual(buildAtsReport(b.doc, JOB));
    });

    it("produces output that passes the shared schema", () => {
        expect(atsReportSchema.safeParse(buildAtsReport(docFromLines(cleanResumeLines), JOB)).success).toBe(true);
    });

    it("scores parseability as 100 minus the penalties", () => {
        const lines = cleanResumeLines.filter((l) => !l.includes("@") && l !== "Skills");
        const report = buildAtsReport(docFromLines(lines), "");

        const penalty = report.checks.reduce((sum, c) => sum + c.penalty, 0);
        expect(report.parseability).toBe(100 - penalty);
        // no email (25), which also drops the phone on the same line (8), and no Skills heading (8)
        expect(penalty).toBe(25 + 8 + 8);
    });

    it("never goes below zero", () => {
        const report = buildAtsReport(docFromLines(["x"], { size: 6 }), "");

        expect(report.parseability).toBeGreaterThanOrEqual(0);
    });

    it("skips keyword matching, and says so, when there is no job description", () => {
        const report = buildAtsReport(docFromLines(cleanResumeLines), "   ");

        expect(report.keywords).toBeNull();
        expect(report.checks.find((c) => c.id === "keyword-coverage")).toMatchObject({ severity: "info", penalty: 0 });
    });

    it("skips keyword matching when the description names no known skills", () => {
        const report = buildAtsReport(docFromLines(cleanResumeLines), "We want a motivated team player.");

        expect(report.keywords).toBeNull();
        expect(report.checks.find((c) => c.id === "keyword-coverage")!.message).toMatch(/No recognizable skills/);
    });

    it("does not credit keywords hidden in tiny text", () => {
        const page = pageOfLines(cleanResumeLines.filter((l) => !/kafka|terraform/i.test(l)));
        page.runs.push(run("Kafka Terraform", 50, PAGE.height - 20, { size: 1 }));

        const report = buildAtsReport(buildDocument([page]), JOB);

        expect(report.keywords!.nice.missing).toEqual(["Kafka", "Terraform"]);
        expect(report.checks.find((c) => c.id === "hidden-text")!.severity).toBe("warning");
    });

    it("leaves scoring empty until the AI score is known", () => {
        expect(buildAtsReport(docFromLines(cleanResumeLines), JOB).scoring).toBeNull();
    });
});
