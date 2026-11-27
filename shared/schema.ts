import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, varchar, boolean, timestamp, jsonb, pgEnum, unique, uniqueIndex, index, foreignKey, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("role", [
  "student",
  "doctoral_candidate",
  "chair",
  "committee_member",
  "program_admin",
  "security_admin",
  "super_admin",
]);

export const submissionTypeEnum = pgEnum("submission_type", [
  "dissertation",
  "proposal",
  "prospectus",
  "quantitative_study",
  "qualitative_study",
  "mixed_methods",
  "grant_proposal",
  "irb_submission",
  "journal_manuscript",
  "ai_research_paper",
]);

export const analysisStatusEnum = pgEnum("analysis_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const severityEnum = pgEnum("severity", [
  "info",
  "warning",
  "critical",
]);

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").default("free").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  fullName: text("full_name").notNull(),
  role: roleEnum("role").default("student").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  reviewCredits: integer("review_credits").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("users_id_tenant_unique").on(t.id, t.tenantId),
  uniqueIndex("users_email_lower_unique").on(sql`lower(${t.email})`),
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "purchase",
  "usage",
  "refund",
  "bonus",
]);

export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  type: transactionTypeEnum("type").notNull(),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  description: text("description"),
  stripeSessionId: text("stripe_session_id"),
  // Ledger rows outlive the documents they reference (financial retention).
  documentId: integer("document_id").references(() => documents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("credit_tx_stripe_session_unique").on(t.stripeSessionId),
  uniqueIndex("credit_tx_refund_reference_unique").on(t.description).where(sql`${t.type} = 'refund'`),
  index("credit_tx_user_idx").on(t.userId),
]);

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  submissionType: submissionTypeEnum("submission_type").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  fileContent: text("file_content"),
  status: analysisStatusEnum("status").default("pending").notNull(),
  overallScore: integer("overall_score"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("documents_id_tenant_unique").on(t.id, t.tenantId),
  // Owner must belong to the same tenant as the document.
  foreignKey({ name: "documents_owner_tenant_fk", columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }),
  index("documents_tenant_idx").on(t.tenantId),
  index("documents_user_idx").on(t.userId),
]);

export const rubrics = pgTable("rubrics", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  name: text("name").notNull(),
  submissionType: submissionTypeEnum("submission_type"),
  criteria: jsonb("criteria").notNull(),
  isTemplate: boolean("is_template").default(false).notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  check("rubrics_tenant_or_template", sql`${t.tenantId} IS NOT NULL OR ${t.isTemplate}`),
]);

export const analysisResults = pgTable("analysis_results", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  documentId: integer("document_id").notNull(),
  engineType: text("engine_type").notNull(),
  status: analysisStatusEnum("status").default("pending").notNull(),
  score: integer("score"),
  results: jsonb("results"),
  details: jsonb("details"),
  jobId: integer("job_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  foreignKey({ name: "analysis_results_document_tenant_fk", columns: [t.documentId, t.tenantId], foreignColumns: [documents.id, documents.tenantId] }).onDelete("cascade"),
  index("analysis_results_document_idx").on(t.documentId),
]);

export const annotations = pgTable("annotations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  documentId: integer("document_id").notNull(),
  analysisResultId: integer("analysis_result_id").references(() => analysisResults.id, { onDelete: "cascade" }),
  sentenceIndex: integer("sentence_index"),
  originalText: text("original_text").notNull(),
  suggestion: text("suggestion"),
  severity: severityEnum("severity").default("info").notNull(),
  engineType: text("engine_type"),
  category: text("category"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  foreignKey({ name: "annotations_document_tenant_fk", columns: [t.documentId, t.tenantId], foreignColumns: [documents.id, documents.tenantId] }).onDelete("cascade"),
  index("annotations_document_idx").on(t.documentId),
]);

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  userId: varchar("user_id").references(() => users.id),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const defenseSessions = pgTable("defense_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  documentId: integer("document_id").notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  questions: jsonb("questions"),
  answers: jsonb("answers"),
  overallScore: integer("overall_score"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  foreignKey({ name: "defense_sessions_document_tenant_fk", columns: [t.documentId, t.tenantId], foreignColumns: [documents.id, documents.tenantId] }).onDelete("cascade"),
]);

// ─── Authentication sessions ─────────────────────────────────────
// One row per login. Refresh tokens rotate within a session; reuse of a rotated
// token revokes the whole session (token-theft detection).
export const authSessions = pgTable("auth_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  revokeReason: text("revoke_reason"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
}, (t) => [index("auth_sessions_user_idx").on(t.userId)]);

export const refreshTokens = pgTable("refresh_tokens", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id").references(() => authSessions.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  rotatedAt: timestamp("rotated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("refresh_tokens_session_idx").on(t.sessionId)]);

// ─── Stripe webhook events (idempotent fulfillment) ─────────────
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  livemode: boolean("livemode").notNull(),
  status: text("status").default("received").notNull(),
  error: text("error"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

// ─── Durable analysis jobs ───────────────────────────────────────
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "cancelled"]);

export const analysisJobs = pgTable("analysis_jobs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  documentId: integer("document_id").notNull(),
  usageTransactionId: integer("usage_transaction_id").references(() => creditTransactions.id).notNull(),
  rubricId: integer("rubric_id"),
  engines: jsonb("engines").$type<string[]>().notNull(),
  status: jobStatusEnum("status").default("queued").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(3).notNull(),
  runAfter: timestamp("run_after").defaultNow().notNull(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at"),
  cancelRequested: boolean("cancel_requested").default(false).notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  foreignKey({ name: "analysis_jobs_document_tenant_fk", columns: [t.documentId, t.tenantId], foreignColumns: [documents.id, documents.tenantId] }).onDelete("cascade"),
  uniqueIndex("analysis_jobs_usage_unique").on(t.usageTransactionId),
  // At most one active job per document.
  uniqueIndex("analysis_jobs_active_document_unique").on(t.documentId).where(sql`${t.status} IN ('queued', 'running')`),
  index("analysis_jobs_claim_idx").on(t.status, t.runAfter),
]);

export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRubricSchema = createInsertSchema(rubrics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAnalysisResultSchema = createInsertSchema(analysisResults).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAnnotationSchema = createInsertSchema(annotations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export const insertDefenseSessionSchema = createInsertSchema(defenseSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({
  id: true,
  createdAt: true,
});

export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

export type InsertRubric = z.infer<typeof insertRubricSchema>;
export type Rubric = typeof rubrics.$inferSelect;

export type InsertAnalysisResult = z.infer<typeof insertAnalysisResultSchema>;
export type AnalysisResult = typeof analysisResults.$inferSelect;

export type InsertAnnotation = z.infer<typeof insertAnnotationSchema>;
export type Annotation = typeof annotations.$inferSelect;

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

export type InsertDefenseSession = z.infer<typeof insertDefenseSessionSchema>;
export type DefenseSession = typeof defenseSessions.$inferSelect;

export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;

export type AuthSession = typeof authSessions.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type StripeEvent = typeof stripeEvents.$inferSelect;
export type AnalysisJob = typeof analysisJobs.$inferSelect;
