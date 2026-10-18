import type { AtsReport, Check } from "~/lib/ats";
import { runChecks } from "./checks";
import type { ExtractedDoc } from "./document";
import { extractJobTerms, matchKeywords } from "./keywords";

function keywordCheck(report: AtsReport["keywords"], hasJobDescription: boolean): Check {
    if (!hasJobDescription) {
        return { id: "keyword-coverage", title: "Job keyword match", severity: "info", message: "No job description was provided, so keyword matching was skipped and isn't part of your score.", evidence: [], penalty: 0 };
    }
    if (!report) {
        return { id: "keyword-coverage", title: "Job keyword match", severity: "info", message: "No recognizable skills were found in the job description, so keyword matching was skipped.", evidence: [], penalty: 0 };
    }

    const matched = report.required.matched.length + report.nice.matched.length;
    const total = matched + report.required.missing.length + report.nice.missing.length;
    const severity = report.coverage >= 70 ? "ok" : report.coverage >= 40 ? "info" : "warning";
    return { id: "keyword-coverage", title: "Job keyword match", severity, message: `${matched} of ${total} skills from the job description appear in your resume.`, evidence: [], penalty: 0 };
}

export function buildAtsReport(doc: ExtractedDoc, jobDescription: string): AtsReport {
    const hasJobDescription = jobDescription.trim() !== "";
    const keywords = hasJobDescription ? matchKeywords(doc.text, extractJobTerms(jobDescription)) : null;

    const checks = [...runChecks(doc), keywordCheck(keywords, hasJobDescription)];
    const penalty = checks.reduce((sum, check) => sum + check.penalty, 0);

    return {
        version: 1,
        parseability: Math.max(0, 100 - penalty),
        checks,
        keywords,
        stats: {
            pageCount: doc.pageCount,
            charCount: doc.text.length,
            columnPages: doc.columnPages,
            medianFontSize: Math.round(doc.medianFontSize * 10) / 10,
        },
        scoring: null,
    };
}
