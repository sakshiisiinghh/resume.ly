import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AtsReport from "~/components/AtsReport";
import type { AtsReport as Report } from "~/lib/ats";

const check = (overrides: Partial<Report["checks"][number]>): Report["checks"][number] => ({
    id: "x",
    title: "Check",
    severity: "ok",
    message: "Fine.",
    evidence: [],
    penalty: 0,
    ...overrides,
});

const report: Report = {
    version: 1,
    parseability: 87,
    checks: [
        check({ id: "readable-text", title: "Readable text", message: "Text can be extracted." }),
        check({ id: "contact-phone", title: "Phone number", severity: "warning", message: "No phone number was found.", penalty: 8 }),
        check({ id: "date-format", title: "Consistent date format", severity: "warning", message: "Dates use more than one format.", evidence: ['Mon YYYY, e.g. "Feb 2026"'], penalty: 5 }),
        check({ id: "contact-links", title: "Profile links", severity: "info", message: "No profile link found." }),
    ],
    keywords: {
        coverage: 60,
        required: {
            matched: [{ term: "Go", count: 3, evidence: "Built Go services" }],
            missing: ["Kubernetes"],
        },
        nice: { matched: [], missing: ["Kafka"] },
    },
    stats: { pageCount: 1, charCount: 900, columnPages: [], medianFontSize: 10 },
    scoring: {
        components: [
            { id: "parseability", label: "Parseability", score: 87, weight: 0.3, contribution: 26.1 },
            { id: "keywords", label: "Job keyword match", score: 60, weight: 0.3, contribution: 18 },
            { id: "quality", label: "Writing quality (AI)", score: 75, weight: 0.4, contribution: 30 },
        ],
        atsReadiness: 74,
        final: 74,
    },
};

describe("AtsReport", () => {
    it("shows ATS readiness and says it is a heuristic", () => {
        render(<AtsReport report={report} />);

        expect(screen.getByRole("heading", { name: "ATS Readiness - 74/100" })).toBeInTheDocument();
        expect(screen.getByText(/aren't any employer's actual ATS/)).toBeInTheDocument();
    });

    it("lists failing checks with their point penalty and evidence", () => {
        render(<AtsReport report={report} />);

        const fix = screen.getByRole("heading", { name: "What to fix" }).closest("section")!;
        expect(within(fix).getByText("Phone number")).toBeInTheDocument();
        expect(within(fix).getByText("−8 pts")).toBeInTheDocument();
        expect(within(fix).getByText("−5 pts")).toBeInTheDocument();
        expect(within(fix).getByText('Mon YYYY, e.g. "Feb 2026"')).toBeInTheDocument();
        expect(within(fix).getByText("Profile links")).toBeInTheDocument();
        expect(within(fix).queryByText("Readable text")).not.toBeInTheDocument();
    });

    it("puts passing checks in a collapsed section", () => {
        render(<AtsReport report={report} />);

        const details = screen.getByText("1 checks passed").closest("details")!;
        expect(details).not.toHaveAttribute("open");
        expect(within(details).getByText("Readable text")).toBeInTheDocument();
    });

    it("shows matched and missing keywords, with the evidence on hover", () => {
        render(<AtsReport report={report} />);

        expect(screen.getByRole("heading", { name: "Job keywords - 60% matched" })).toBeInTheDocument();
        expect(screen.getByText("Go").closest("li")).toHaveAttribute("title", "Built Go services");
        expect(screen.getByText("×3")).toBeInTheDocument();
        expect(screen.getByText("Kubernetes")).toBeInTheDocument();
        expect(screen.getByText("Kafka")).toBeInTheDocument();
    });

    it("explains how the overall score is calculated", () => {
        render(<AtsReport report={report} />);

        const table = screen.getByRole("table");
        const rows = within(table).getAllByRole("row").map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent));

        expect(rows).toContainEqual(["Parseability", "87", "30%", "26.1"]);
        expect(rows).toContainEqual(["Job keyword match", "60", "30%", "18"]);
        expect(rows).toContainEqual(["Writing quality (AI)", "75", "40%", "30"]);
        expect(rows).toContainEqual(["Overall score", "74"]);
    });

    it("shows renormalised weights and a note when keywords weren't scored", () => {
        const withoutKeywords: Report = {
            ...report,
            keywords: null,
            scoring: {
                components: [
                    { id: "parseability", label: "Parseability", score: 87, weight: 0.3, contribution: 37.3 },
                    { id: "quality", label: "Writing quality (AI)", score: 75, weight: 0.4, contribution: 42.9 },
                ],
                atsReadiness: 87,
                final: 80,
            },
        };
        render(<AtsReport report={withoutKeywords} />);

        expect(screen.queryByRole("heading", { name: /Job keywords/ })).not.toBeInTheDocument();
        expect(screen.getByText("43%")).toBeInTheDocument();
        expect(screen.getByText(/no usable job description/)).toBeInTheDocument();
    });

    it("falls back to parseability when the score breakdown isn't available yet", () => {
        render(<AtsReport report={{ ...report, scoring: null }} />);

        expect(screen.getByRole("heading", { name: "ATS Readiness - 87/100" })).toBeInTheDocument();
        expect(screen.queryByText("How your score is calculated")).not.toBeInTheDocument();
    });
});
