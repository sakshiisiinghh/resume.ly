import { describe, expect, it } from "vitest";
import { readPdf } from "~/.server/pdf";
import { CASE_SENSITIVE, FORMS, TRAPS } from "../dataset/forms";
import { JOBS, LLM_PAIRS, PAIRS, RESUMES, datasetVersion } from "../dataset";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ALL_FORMS = Object.entries(FORMS).flatMap(([skill, forms]) => forms.map((form) => ({ skill, form })));

// Deliberately simpler than the engine's matcher, so the labels are checked independently of it.
// A skill named inside a longer skill ("CSS" in "Tailwind CSS") isn't a separate mention.
function mentions(skill: string, rawText: string): boolean {
    let text = rawText.replace(/\s+/g, " ");
    for (const trap of TRAPS) text = text.split(trap).join(" ");
    for (const own of FORMS[skill]) {
        for (const { skill: other, form } of ALL_FORMS) {
            if (other !== skill && form.length > own.length && form.includes(own)) text = text.split(form).join(" ");
        }
    }

    return FORMS[skill].some((form) => {
        const pattern = new RegExp(`(?<![A-Za-z0-9+#.-])${escape(form)}(?![A-Za-z0-9+#-])`, CASE_SENSITIVE.has(skill) ? "" : "i");
        return pattern.test(text);
    });
}

const KNOWN_CHECKS = new Set([
    "columns", "reading-order", "sections", "contact-email", "contact-phone", "contact-links", "dates", "date-format",
    "date-ranges", "page-count", "text-density", "font-size", "hidden-text", "prompt-injection",
]);

describe("dataset composition", () => {
    it("has 25 to 40 resume and job pairs with unique ids", () => {
        expect(PAIRS.length).toBeGreaterThanOrEqual(25);
        expect(PAIRS.length).toBeLessThanOrEqual(40);
        expect(new Set(PAIRS.map((p) => p.id)).size).toBe(PAIRS.length);
    });

    it("covers strong, average and weak resumes in every domain", () => {
        for (const domain of ["backend", "fullstack", "data"]) {
            for (const tier of ["strong", "average", "weak"]) {
                expect(RESUMES.some((r) => r.domain === domain && r.tier === tier && r.variant === "base")).toBe(true);
            }
        }
    });

    it("includes multi-column, scanned and malformed examples", () => {
        const variants = RESUMES.map((r) => r.variant);

        expect(variants).toEqual(expect.arrayContaining(["two-column", "interleaved-columns", "scanned", "malformed"]));
    });

    it("only expects checks that exist", () => {
        for (const r of RESUMES) for (const issue of r.issues) expect(KNOWN_CHECKS.has(issue)).toBe(true);
    });

    it("uses a fixed LLM subset with all three tiers per job", () => {
        expect(LLM_PAIRS.map((p) => p.resume.tier)).toEqual(["strong", "average", "weak", "strong", "average", "weak"]);
    });

    it("has a stable version", () => {
        expect(datasetVersion()).toBe(datasetVersion());
        expect(datasetVersion()).toMatch(/^[0-9a-f]{12}$/);
    });
});

describe("resume labels match the visible text", () => {
    const readable = RESUMES.filter((r) => !r.unsupported);

    it.each(readable.map((r) => [r.id, r] as const))("%s", async (_id, resume) => {
        const { doc } = await readPdf(resume.pdf(), { thumbnail: false });

        const found = Object.keys(FORMS).filter((skill) => mentions(skill, doc.text));
        const expected = resume.mentions;

        expect(found.filter((s) => !expected.includes(s)), "mentioned in the text but not labeled").toEqual([]);
        expect(expected.filter((s) => !found.includes(s)), "labeled but not in the text").toEqual([]);
    });

    it("labels only skills the form table knows", () => {
        for (const r of RESUMES) for (const skill of r.mentions) expect(FORMS[skill], skill).toBeDefined();
        for (const j of JOBS) for (const skill of [...j.required, ...j.nice]) expect(FORMS[skill], skill).toBeDefined();
    });

    it("gives every base resume enough text that density isn't an issue", async () => {
        for (const r of RESUMES.filter((x) => x.variant === "base")) {
            const { doc } = await readPdf(r.pdf(), { thumbnail: false });
            expect(doc.text.length, r.id).toBeGreaterThanOrEqual(650);
        }
    });
});

describe("job labels match the description", () => {
    it.each(JOBS.map((j) => [j.id, j] as const))("%s", (_id, jobCase) => {
        const found = Object.keys(FORMS).filter((skill) => mentions(skill, jobCase.description));
        const expected = [...jobCase.required, ...jobCase.nice];

        expect(found.filter((s) => !expected.includes(s)), "in the description but not labeled").toEqual([]);
        expect(expected.filter((s) => !found.includes(s)), "labeled but not in the description").toEqual([]);
    });

    it("never labels a skill both required and nice", () => {
        for (const j of JOBS) expect(j.required.filter((s) => j.nice.includes(s))).toEqual([]);
    });
});
