import type { KeywordMatch, Keywords } from "~/lib/ats";
import { SKILLS, type Skill } from "./skills";

export interface JobTerms {
    required: Skill[];
    nice: Skill[];
}

const NICE_WEIGHT = 0.5;
const NICE_CUE = /\b(nice[- ]to[- ]haves?|preferred|bonus|good to have|desirable|a plus|plus points?|would be (great|nice)|optional|extra credit)\b/i;
const REQUIRED_CUE = /\b(requirements?|required|qualifications|must[- ]haves?|what you(?:'|’)ll (need|bring)|you(?:'|’)ll need|you have|responsibilities|about you|minimum)\b/i;
const NICE_INLINE = /\b(nice to have|preferred|a plus|is a plus|bonus)\b/i;
const HEADING_MAX = 70;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Pattern {
    re: RegExp;
    ambiguous: boolean;
}

const patterns = new Map<Skill, Pattern[]>();

function patternsFor(skill: Skill): Pattern[] {
    let compiled = patterns.get(skill);
    if (!compiled) {
        const lookbehind = "(?<![\\w+#.])";
        const lookahead = skill.strict ? "(?![\\w+#&-]|\\.[A-Za-z])" : "(?![\\w+#]|\\.[A-Za-z])";
        // Spaces match any whitespace, so a name split by a line wrap ("Tailwind\nCSS") still counts.
        const build = (alias: string, flags: string, ambiguous: boolean) => ({ re: new RegExp(`${lookbehind}${escape(alias).replace(/ /g, "\\s+")}${lookahead}`, flags), ambiguous });

        compiled = [
            ...skill.aliases.map((alias) => build(alias, "gi", false)),
            ...(skill.exact ?? []).map((alias) => build(alias, "g", true)),
        ];
        patterns.set(skill, compiled);
    }
    return compiled;
}

interface Hit {
    skill: Skill;
    index: number;
    end: number;
    ambiguous: boolean;
}

function rawHits(text: string): Hit[] {
    return SKILLS.flatMap((skill) =>
        patternsFor(skill).flatMap(({ re, ambiguous }) =>
            [...text.matchAll(new RegExp(re.source, re.flags))].map((m) => ({ skill, index: m.index, end: m.index + m[0].length, ambiguous }))
        )
    );
}

const sameLine = (text: string, a: number, b: number) => !text.slice(Math.min(a, b), Math.max(a, b)).includes("\n");

// Whether the word closes off a list item ("React, Node.js", "Experience with Rust") instead of starting a phrase ("React to feedback").
function endsListItem(text: string, end: number): boolean {
    const next = text.slice(end).match(/^[ \t]*(.?)/)?.[1] ?? "";
    return next === "" || ",;:)/|.".includes(next);
}

// Finds where each skill appears. A skill named inside a longer one ("CSS" in "Tailwind CSS") isn't counted,
// and names that are also ordinary words ("React", "Express") only count when the line gives them tech context.
function skillHits(text: string): Map<Skill, number[]> {
    const raw = rawHits(text);
    const longest = raw.filter((h) => !raw.some((o) => o !== h && o.end - o.index > h.end - h.index && o.index <= h.index && o.end >= h.end));
    const accepted = longest.filter(
        (h) => !h.ambiguous || endsListItem(text, h.end) || longest.some((o) => o.skill !== h.skill && !o.ambiguous && sameLine(text, o.index, h.index))
    );

    const byIndex = new Map<Skill, Set<number>>();
    for (const { skill, index } of accepted) byIndex.set(skill, (byIndex.get(skill) ?? new Set()).add(index));
    return new Map([...byIndex].map(([skill, indexes]) => [skill, [...indexes].sort((x, y) => x - y)]));
}

const isHeading = (line: string) => line.trim().length <= HEADING_MAX && line.trim().endsWith(":");

export function extractJobTerms(jobDescription: string): JobTerms {
    const required: Skill[] = [];
    const nice: Skill[] = [];
    let inNiceSection = false;

    for (const line of jobDescription.split("\n")) {
        if (isHeading(line)) {
            if (NICE_CUE.test(line)) inNiceSection = true;
            else if (REQUIRED_CUE.test(line)) inNiceSection = false;
        }

        const isNice = inNiceSection || NICE_INLINE.test(line);
        const inLine = [...skillHits(line)].map(([skill, indexes]) => ({ skill, at: indexes[0] })).sort((a, b) => a.at - b.at);

        for (const { skill } of inLine) {
            const target = isNice ? nice : required;
            if (!required.includes(skill) && !nice.includes(skill)) target.push(skill);
            else if (!isNice && nice.includes(skill)) {
                nice.splice(nice.indexOf(skill), 1);
                required.push(skill);
            }
        }
    }
    return { required, nice };
}

const EVIDENCE_RADIUS = 60;

function evidenceAround(text: string, index: number): string {
    const lineStart = text.lastIndexOf("\n", index) + 1;
    const found = text.indexOf("\n", index);
    const lineEnd = found === -1 ? text.length : found;

    const start = Math.max(lineStart, index - EVIDENCE_RADIUS);
    const end = Math.min(lineEnd, index + EVIDENCE_RADIUS);
    return `${start > lineStart ? "…" : ""}${text.slice(start, end).trim()}${end < lineEnd ? "…" : ""}`;
}

function matchGroup(skills: Skill[], text: string, found: Map<Skill, number[]>) {
    const matched: KeywordMatch[] = [];
    const missing: string[] = [];
    for (const skill of skills) {
        const hits = found.get(skill) ?? [];
        if (hits.length > 0) matched.push({ term: skill.name, count: hits.length, evidence: evidenceAround(text, hits[0]) });
        else missing.push(skill.name);
    }
    return { matched, missing };
}

export function matchKeywords(resumeText: string, terms: JobTerms): Keywords | null {
    const total = terms.required.length + terms.nice.length;
    if (total === 0) return null;

    const found = skillHits(resumeText);
    const required = matchGroup(terms.required, resumeText, found);
    const nice = matchGroup(terms.nice, resumeText, found);

    const possible = terms.required.length + terms.nice.length * NICE_WEIGHT;
    const earned = required.matched.length + nice.matched.length * NICE_WEIGHT;

    return { coverage: Math.round((earned / possible) * 100), required, nice };
}
