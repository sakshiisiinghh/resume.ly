import { z } from "zod";

export const severitySchema = z.enum(["ok", "info", "warning", "critical"]);
export type Severity = z.infer<typeof severitySchema>;

export const checkSchema = z.object({
    id: z.string(),
    title: z.string(),
    severity: severitySchema,
    message: z.string(),
    evidence: z.array(z.string()),
    penalty: z.number().min(0),
});
export type Check = z.infer<typeof checkSchema>;

const keywordMatchSchema = z.object({
    term: z.string(),
    count: z.number().int().min(1),
    evidence: z.string(),
});
export type KeywordMatch = z.infer<typeof keywordMatchSchema>;

const keywordGroupSchema = z.object({
    matched: z.array(keywordMatchSchema),
    missing: z.array(z.string()),
});

export const keywordsSchema = z.object({
    coverage: z.number().min(0).max(100),
    required: keywordGroupSchema,
    nice: keywordGroupSchema,
});
export type Keywords = z.infer<typeof keywordsSchema>;

export const componentIdSchema = z.enum(["parseability", "keywords", "quality"]);

export const scoringSchema = z.object({
    components: z.array(
        z.object({
            id: componentIdSchema,
            label: z.string(),
            score: z.number(),
            weight: z.number(),
            contribution: z.number(),
        })
    ),
    atsReadiness: z.number(),
    final: z.number(),
});
export type Scoring = z.infer<typeof scoringSchema>;

export const atsReportSchema = z.object({
    version: z.literal(1),
    parseability: z.number().min(0).max(100),
    checks: z.array(checkSchema),
    keywords: keywordsSchema.nullable(),
    stats: z.object({
        pageCount: z.number().int(),
        charCount: z.number().int(),
        columnPages: z.array(z.number().int()),
        medianFontSize: z.number(),
    }),
    scoring: scoringSchema.nullable(),
});
export type AtsReport = z.infer<typeof atsReportSchema>;
