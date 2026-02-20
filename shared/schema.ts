import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, varchar, boolean, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
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
  tenantId: integer("tenant_id").references(() => tenants.id),
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
});

export const transactionTypeEnum = pgEnum("transaction_type", [
  "purchase",
  "usage",
  "refund",
  "bonus",
]);

export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  type: transactionTypeEnum("type").notNull(),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  description: text("description"),
  stripeSessionId: text("stripe_session_id"),
  documentId: integer("document_id").references(() => documents.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  userId: varchar("user_id").references(() => users.id),
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
});

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
});

export const analysisResults = pgTable("analysis_results", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  documentId: integer("document_id").references(() => documents.id),
  engineType: text("engine_type").notNull(),
  status: analysisStatusEnum("status").default("pending").notNull(),
  score: integer("score"),
  results: jsonb("results"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const annotations = pgTable("annotations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  documentId: integer("document_id").references(() => documents.id),
  analysisResultId: integer("analysis_result_id").references(() => analysisResults.id),
  sentenceIndex: integer("sentence_index"),
  originalText: text("original_text").notNull(),
  suggestion: text("suggestion"),
  severity: severityEnum("severity").default("info").notNull(),
  engineType: text("engine_type"),
  category: text("category"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  tenantId: integer("tenant_id").references(() => tenants.id),
  documentId: integer("document_id").references(() => documents.id),
  userId: varchar("user_id").references(() => users.id),
  questions: jsonb("questions"),
  answers: jsonb("answers"),
  overallScore: integer("overall_score"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
