import type { Check, Severity } from "~/lib/ats";
import type { ExtractedDoc } from "./document";

function result(id: string, title: string, severity: Severity, message: string, evidence: string[] = [], penalty = 0): Check {
    return { id, title, severity, message, evidence, penalty };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const clip = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function readableText(doc: ExtractedDoc): Check {
    return result("readable-text", "Readable text", "ok", `Text can be extracted: ${doc.text.length} characters over ${plural(doc.pageCount, "page")}.`);
}

function layout(doc: ExtractedDoc): Check[] {
    const checks: Check[] = [];

    if (doc.columnPages.length > 0) {
        checks.push(
            result(
                "columns",
                "Single-column layout",
                "info",
                "A multi-column layout was detected. Some ATS parsers read straight across columns and mix up sections.",
                [`Columns found on ${doc.columnPages.length === 1 ? "page" : "pages"} ${doc.columnPages.join(", ")}`],
                5
            )
        );
    } else {
        checks.push(result("columns", "Single-column layout", "ok", "No multi-column layout detected."));
    }

    const limit = 2 * doc.pageCount;
    checks.push(
        doc.readingOrderBreaks > limit
            ? result(
                  "reading-order",
                  "Reading order",
                  "warning",
                  "The text jumps around the page, so a parser may read sections out of order.",
                  [`${plural(doc.readingOrderBreaks, "jump")} in reading order (a clean layout has about ${limit} or fewer)`],
                  15
              )
            : result("reading-order", "Reading order", "ok", "Text flows in a natural reading order.")
    );

    return checks;
}

function pageStats(doc: ExtractedDoc): Check[] {
    const checks: Check[] = [];

    checks.push(
        doc.pageCount > 2
            ? result("page-count", "Page count", "warning", "Resumes longer than two pages are often truncated or skimmed.", [`${plural(doc.pageCount, "page")}`], 5)
            : result("page-count", "Page count", "ok", `${plural(doc.pageCount, "page")}.`)
    );

    const perPage = Math.round(doc.text.length / doc.pageCount);
    checks.push(
        perPage < 600
            ? result("text-density", "Text density", "warning", "There is very little text on each page, so there may be little for an ATS to match against.", [`About ${perPage} characters per page`], 8)
            : result("text-density", "Text density", "ok", `About ${perPage} characters per page.`)
    );

    const size = Math.round(doc.medianFontSize * 10) / 10;
    checks.push(
        size < 8.5
            ? result("font-size", "Font size", "warning", "The body text is small, which hurts readability for people and some parsers.", [`Typical font size ${size}pt`], 5)
            : result("font-size", "Font size", "ok", `Typical font size ${size}pt.`)
    );

    return checks;
}

const SECTION_ALIASES = {
    experience: ["experience", "work experience", "professional experience", "employment", "employment history", "work history", "relevant experience", "internships", "internship experience"],
    education: ["education", "academic background", "academics", "education and training"],
    skills: ["skills", "technical skills", "core skills", "core competencies", "key skills", "skills and tools", "technologies", "tech stack", "skills and technologies"],
    projects: ["projects", "personal projects", "academic projects", "selected projects", "key projects"],
} as const;

type SectionId = keyof typeof SECTION_ALIASES;

function editDistance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let diagonal = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const above = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            diagonal = above;
        }
    }
    return row[b.length];
}

function sectionOf(lineText: string): SectionId | null {
    const normalized = lineText
        .toLowerCase()
        .replace(/[&/]/g, " and ")
        .replace(/[^a-z ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized || normalized.length > 40 || normalized.split(" ").length > 4) return null;

    for (const [id, aliases] of Object.entries(SECTION_ALIASES) as [SectionId, readonly string[]][]) {
        if (aliases.some((alias) => alias === normalized || (alias.length >= 6 && editDistance(alias, normalized) <= 1))) return id;
    }
    return null;
}

function sections(doc: ExtractedDoc): Check {
    const found = new Map<SectionId, string>();
    for (const line of doc.lines) {
        const id = sectionOf(line.text);
        if (id && !found.has(id)) found.set(id, line.text);
    }

    const missing: string[] = [];
    if (!found.has("experience") && !found.has("projects")) missing.push("Experience (or Projects)");
    if (!found.has("education")) missing.push("Education");
    if (!found.has("skills")) missing.push("Skills");

    const evidence = [`Found: ${[...found.values()].join(", ") || "none"}`];
    if (missing.length === 0) return result("sections", "Standard sections", "ok", "The expected section headings are present.", evidence);

    return result(
        "sections",
        "Standard sections",
        "warning",
        "Some standard section headings are missing. ATS parsers use them to sort your information into fields.",
        [...evidence, `Missing: ${missing.join(", ")}`],
        Math.min(24, missing.length * 8)
    );
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;
const PROFILE_URL = /\S*\b(?:linkedin|github|gitlab|behance|dribbble)(?:\.com)?\s*[/:]\s*\S+|https?:\/\/\S+|www\.\S+/i;
// Hyperlinked labels like "LinkedIn | GitHub" extract as bare words, so only trust them near the top.
const PROFILE_LABEL = /\b(?:linkedin|github|gitlab|portfolio|behance|dribbble)\b/i;
const HEADER_LINES = 5;

function inMargin(top: number, height: number) {
    return top / height < 0.03 || top / height > 0.94;
}

function contact(doc: ExtractedDoc): Check[] {
    const checks: Check[] = [];

    const emailLines = doc.lines.filter((line) => new RegExp(EMAIL.source).test(line.text));
    const email = doc.text.match(EMAIL)?.[0];
    if (!email) {
        checks.push(result("contact-email", "Email address", "critical", "No email address was found. A recruiter or ATS has no way to reach you.", [], 25));
    } else if (emailLines.length > 0 && emailLines.every((line) => inMargin(line.top, doc.pageHeights[line.page - 1]))) {
        checks.push(result("contact-email", "Email address", "warning", "Your email only appears in the page margin, where many ATS parsers skip headers and footers.", [email], 10));
    } else {
        checks.push(result("contact-email", "Email address", "ok", "An email address is present.", [email]));
    }

    const phone = (doc.text.match(PHONE) ?? []).find((candidate) => {
        const digits = candidate.replace(/\D/g, "").length;
        return digits >= 10 && digits <= 15;
    });
    checks.push(
        phone
            ? result("contact-phone", "Phone number", "ok", "A phone number is present.", [phone.trim()])
            : result("contact-phone", "Phone number", "warning", "No phone number was found.", [], 8)
    );

    const header = doc.lines.slice(0, HEADER_LINES).map((line) => line.text).join("\n");
    const link = doc.text.match(PROFILE_URL)?.[0] ?? header.match(PROFILE_LABEL)?.[0];
    checks.push(
        link
            ? result("contact-links", "Profile links", "ok", "A profile or portfolio link is present.", [link])
            : result("contact-links", "Profile links", "info", "No LinkedIn, GitHub or portfolio link was found.")
    );

    return checks;
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE = `(?:(?:${MONTHS})\\.?,?\\s+(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])[/.-](?:19|20)\\d{2}|(?:19|20)\\d{2})`;
const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to)\\s*(${DATE}|present|current|now|ongoing)`, "gi");
const MONTH_YEAR = new RegExp(`\\b(${MONTHS})\\.?,?\\s+(?:19|20)\\d{2}\\b`, "gi");
const NUMERIC_DATE = /\b(?:0?[1-9]|1[0-2])[/.-](?:19|20)\d{2}\b/g;
const ANY_YEAR = /\b(?:19|20)\d{2}\b/;
const MONTH_INDEX = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parseDate(token: string, fallbackMonth: number): number | null {
    const year = Number(token.match(/(?:19|20)\d{2}/)?.[0]);
    if (!year) return null;

    const named = token.toLowerCase().match(/[a-z]{3}/)?.[0];
    const numeric = token.match(/^(\d{1,2})[/.-]/)?.[1];
    const month = named ? MONTH_INDEX.indexOf(named) + 1 || fallbackMonth : numeric ? Number(numeric) : fallbackMonth;
    return year * 12 + month;
}

function dateStyles(text: string): Map<string, string> {
    const styles = new Map<string, string>();
    for (const match of text.matchAll(MONTH_YEAR)) {
        const month = match[1].toLowerCase();
        if (month === "may") continue;
        const isAbbreviated = month.length === 3 || month === "sept";
        const style = isAbbreviated ? "Mon YYYY (abbreviated month)" : "Month YYYY (full month)";
        if (!styles.has(style)) styles.set(style, match[0]);
    }
    const numeric = text.match(NUMERIC_DATE)?.[0];
    if (numeric) styles.set("MM/YYYY (numeric)", numeric);
    return styles;
}

function dates(doc: ExtractedDoc): Check[] {
    if (!ANY_YEAR.test(doc.text)) {
        return [result("dates", "Dates", "warning", "No dates were found, so an ATS can't work out how long you held each role.", [], 10)];
    }

    const checks: Check[] = [];

    const styles = dateStyles(doc.text);
    checks.push(
        styles.size > 1
            ? result("date-format", "Consistent date format", "warning", "Dates are written in more than one format. Pick one so parsers read them all the same way.", [...styles].map(([style, example]) => `${style}, e.g. "${example}"`), 5)
            : result("date-format", "Consistent date format", "ok", "Dates use a consistent format.")
    );

    const reversed: string[] = [];
    for (const match of doc.text.matchAll(RANGE)) {
        const start = parseDate(match[1], 1);
        const end = /^(present|current|now|ongoing)$/i.test(match[2]) ? Infinity : parseDate(match[2], 12);
        if (start !== null && end !== null && end < start) reversed.push(match[0].trim());
    }
    checks.push(
        reversed.length > 0
            ? result("date-ranges", "Valid date ranges", "warning", "Some date ranges end before they start.", reversed.slice(0, 3), 8)
            : result("date-ranges", "Valid date ranges", "ok", "Date ranges run forwards in time.")
    );

    return checks;
}

const INJECTION_PATTERNS: { label: string; pattern: RegExp }[] = [
    { label: "ignore previous instructions", pattern: /\b(ignore|disregard|forget)\s+(all|any|the|your)?\s*(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)\b/i },
    { label: "address to an AI", pattern: /\b(you are (now )?(an?|the) (ai|llm|language model|assistant)|as an? (ai language model|language model|ai assistant))\b/i },
    { label: "instruction to rate the candidate", pattern: /\b(rate|score|rank|recommend)\s+this\s+(resume|candidate|applicant)\b/i },
    { label: "instruction to give a top score", pattern: /\b(give|assign)\s+(this|me)?\s*(resume|candidate|applicant)?\s*(a|the)?\s*(perfect|maximum|highest|top)\s+score\b/i },
    { label: "instruction to hide this text", pattern: /\bdo not (mention|reveal|disclose) (this|these)\b/i },
];

function security(doc: ExtractedDoc): Check[] {
    const checks: Check[] = [];

    if (doc.hidden.length > 0) {
        const evidence = doc.hidden.slice(0, 3).map((run) => `"${clip(run.text.trim(), 50)}" (${Math.round(run.fontSize * 10) / 10}pt text)`);
        checks.push(
            result(
                "hidden-text",
                "Hidden text",
                "warning",
                `${plural(doc.hidden.length, "piece")} of text are too small to read. It is ignored when scoring. Some ATS flag hidden text as keyword stuffing.`,
                evidence,
                10
            )
        );
    } else {
        checks.push(result("hidden-text", "Hidden text", "ok", "No unreadably small text found."));
    }

    const everything = [doc.text, ...doc.hidden.map((run) => run.text)].join("\n");
    const hits = INJECTION_PATTERNS.flatMap(({ label, pattern }) => {
        const match = everything.match(pattern);
        return match ? [`${label}: "${clip(match[0].trim())}"`] : [];
    });
    checks.push(
        hits.length > 0
            ? result("prompt-injection", "Instruction-like phrases", "warning", "Some text reads like an instruction aimed at an AI reviewer. This is a heuristic and doesn't affect your score, but a human or automated reviewer may react to it.", hits)
            : result("prompt-injection", "Instruction-like phrases", "ok", "No instruction-like phrases found.")
    );

    return checks;
}

export function runChecks(doc: ExtractedDoc): Check[] {
    return [readableText(doc), ...layout(doc), sections(doc), ...contact(doc), ...dates(doc), ...pageStats(doc), ...security(doc)];
}
