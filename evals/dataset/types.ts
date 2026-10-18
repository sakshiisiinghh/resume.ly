export type Domain = "backend" | "fullstack" | "data";
export type Tier = "strong" | "average" | "weak";

export interface JobCase {
    id: string;
    domain: Domain;
    title: string;
    description: string;
    /** Skills a reviewer would call required, by canonical name. Includes skills the dictionary doesn't know. */
    required: string[];
    nice: string[];
}

export interface ResumeCase {
    id: string;
    domain: Domain;
    tier: Tier;
    variant: string;
    pdf: () => Buffer;
    /** Skills the visible text mentions, by canonical name. Hidden text doesn't count. */
    mentions: string[];
    /** Check ids a correct engine reports as not ok. */
    issues: string[];
    /** Set when the PDF can't be read at all. */
    unsupported?: "no_text_layer" | "invalid_pdf";
}

export interface Pair {
    id: string;
    resume: ResumeCase;
    job: JobCase;
}
