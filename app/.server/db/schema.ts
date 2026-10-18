import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const analysisStatus = pgEnum("analysis_status", ["queued", "processing", "done", "failed"]);

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const resumes = pgTable(
    "resumes",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        fileName: text("file_name").notNull(),
        companyName: text("company_name").notNull().default(""),
        jobTitle: text("job_title").notNull().default(""),
        jobDescription: text("job_description").notNull().default(""),
        fileKey: text("file_key").notNull(),
        thumbKey: text("thumb_key"),
        fileSha256: text("file_sha256").notNull(),
        pageCount: integer("page_count"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("resumes_user_created_idx").on(t.userId, t.createdAt.desc())]
);

export const analyses = pgTable(
    "analyses",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        resumeId: uuid("resume_id").notNull().references(() => resumes.id, { onDelete: "cascade" }),
        status: analysisStatus("status").notNull().default("queued"),
        stage: text("stage"),
        promptVersion: text("prompt_version").notNull(),
        model: text("model").notNull(),
        idempotencyKey: text("idempotency_key").notNull().unique(),
        atsReport: jsonb("ats_report"),
        llmFeedback: jsonb("llm_feedback"),
        finalScore: integer("final_score"),
        attempts: integer("attempts").notNull().default(0),
        errorCode: text("error_code"),
        errorMessage: text("error_message"),
        tokensIn: integer("tokens_in"),
        tokensOut: integer("tokens_out"),
        queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
        startedAt: timestamp("started_at", { withTimezone: true }),
        heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
        finishedAt: timestamp("finished_at", { withTimezone: true }),
    },
    (t) => [
        index("analyses_resume_idx").on(t.resumeId),
        index("analyses_status_heartbeat_idx").on(t.status, t.heartbeatAt),
    ]
);

export const usersRelations = relations(users, ({ many }) => ({ resumes: many(resumes) }));

export const resumesRelations = relations(resumes, ({ one, many }) => ({
    user: one(users, { fields: [resumes.userId], references: [users.id] }),
    analyses: many(analyses),
}));

export const analysesRelations = relations(analyses, ({ one }) => ({
    resume: one(resumes, { fields: [analyses.resumeId], references: [resumes.id] }),
}));

export type User = typeof users.$inferSelect;
export type Resume = typeof resumes.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type AnalysisStatus = Analysis["status"];
