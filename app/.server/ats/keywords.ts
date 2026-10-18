import type { KeywordMatch, Keywords } from "~/lib/ats";
import { SKILLS, type Skill } from "./skills";

export interface JobTerms {
    required: Skill[];
    nice: Skill[];
}

const NICE_WEIGHT = 0.5;
const NICE_HEADING = /^\s*[-*•]?\s*(nice[- ]to[- ]haves?|preferred( qualifications| skills)?|bonus( points)?|good to have|desirable)\b/i;
const REQUIRED_HEADING = /^\s*[-*•]?\s*(requirements?|required( qualifications| skills)?|qualifications|minimum qualifications|must[- ]haves?|what you(?:'|’)ll (need|bring)|responsibilities|about you|you have)\b/i;
const NICE_INLINE = /\b(nice to have|preferred|a plus|is a plus|bonus)\b/i;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const patterns = new Map<Skill, RegExp[]>();

function patternsFor(skill: Skill): RegExp[] {
    let compiled = patterns.get(skill);
    if (!compiled) {
        const lookbehind = "(?<![\\w+#.])";
        const lookahead = skill.strict ? "(?![\\w+#&-]|\\.[A-Za-z])" : "(?![\\w+#]|\\.[A-Za-z])";
        const build = (alias: string, flags: string) => new RegExp(`${lookbehind}${escape(alias)}${lookahead}`, flags);

        compiled = [
            ...skill.aliases.map((alias) => build(alias, "gi")),
            ...(skill.exact ?? []).map((alias) => build(alias, "g")),
        ];
        patterns.set(skill, compiled);
    }
    return compiled.map((re) => new RegExp(re.source, re.flags));
}

function findAll(skill: Skill, text: string): number[] {
    const indexes: number[] = [];
    for (const re of patternsFor(skill)) {
        for (const match of text.matchAll(re)) indexes.push(match.index);
    }
    return indexes.sort((a, b) => a - b);
}

export function extractJobTerms(jobDescription: string): JobTerms {
    const required: Skill[] = [];
    const nice: Skill[] = [];
    let inNiceSection = false;

    for (const line of jobDescription.split("\n")) {
        if (NICE_HEADING.test(line)) inNiceSection = true;
        else if (REQUIRED_HEADING.test(line)) inNiceSection = false;

        const isNice = inNiceSection || NICE_INLINE.test(line);
        const inLine = SKILLS.map((skill) => ({ skill, at: findAll(skill, line)[0] }))
            .filter((hit) => hit.at !== undefined)
            .sort((a, b) => a.at - b.at);

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

function matchGroup(skills: Skill[], text: string) {
    const matched: KeywordMatch[] = [];
    const missing: string[] = [];
    for (const skill of skills) {
        const hits = findAll(skill, text);
        if (hits.length > 0) matched.push({ term: skill.name, count: hits.length, evidence: evidenceAround(text, hits[0]) });
        else missing.push(skill.name);
    }
    return { matched, missing };
}

export function matchKeywords(resumeText: string, terms: JobTerms): Keywords | null {
    const total = terms.required.length + terms.nice.length;
    if (total === 0) return null;

    const required = matchGroup(terms.required, resumeText);
    const nice = matchGroup(terms.nice, resumeText);

    const possible = terms.required.length + terms.nice.length * NICE_WEIGHT;
    const earned = required.matched.length + nice.matched.length * NICE_WEIGHT;

    return { coverage: Math.round((earned / possible) * 100), required, nice };
}
