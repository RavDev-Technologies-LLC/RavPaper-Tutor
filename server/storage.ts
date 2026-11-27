import { eq, and, desc, sql, gt, ne, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import {
  tenants,
  users,
  documents,
  rubrics,
  analysisResults,
  annotations,
  auditLogs,
  defenseSessions,
  creditTransactions,
  analysisJobs,
  type Tenant,
  type InsertTenant,
  type User,
  type InsertUser,
  type Document,
  type InsertDocument,
  type Rubric,
  type InsertRubric,
  type AnalysisResult,
  type InsertAnalysisResult,
  type Annotation,
  type InsertAnnotation,
  type AuditLog,
  type InsertAuditLog,
  type DefenseSession,
  type InsertDefenseSession,
  type CreditTransaction,
  type InsertCreditTransaction,
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  registerUser(input: { username: string; email: string; passwordHash: string; fullName: string }): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  getUsersByTenant(tenantId: number): Promise<User[]>;

  getTenant(id: number): Promise<Tenant | undefined>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenant(id: number, data: Partial<InsertTenant>): Promise<Tenant | undefined>;
  getAllTenants(): Promise<Tenant[]>;

  getDocument(id: number): Promise<Document | undefined>;
  createDocument(doc: InsertDocument): Promise<Document>;
  updateDocument(id: number, data: Partial<InsertDocument>): Promise<Document | undefined>;
  getDocumentsByUser(userId: string): Promise<Document[]>;
  getDocumentsByTenant(tenantId: number): Promise<Document[]>;
  deleteDocument(id: number, actor: { userId: string; tenantId: number; ipAddress: string | null }): Promise<"deleted" | "not_found" | "busy">;

  getRubric(id: number): Promise<Rubric | undefined>;
  createRubric(rubric: InsertRubric): Promise<Rubric>;
  updateRubric(id: number, data: Partial<InsertRubric>): Promise<Rubric | undefined>;
  getRubricsByTenant(tenantId: number): Promise<Rubric[]>;
  getRubricTemplates(): Promise<Rubric[]>;

  getAnalysisResult(id: number): Promise<AnalysisResult | undefined>;
  createAnalysisResult(result: InsertAnalysisResult): Promise<AnalysisResult>;
  updateAnalysisResult(id: number, data: Partial<InsertAnalysisResult>): Promise<AnalysisResult | undefined>;
  getResultsByDocument(documentId: number): Promise<AnalysisResult[]>;

  getAnnotation(id: number): Promise<Annotation | undefined>;
  createAnnotation(annotation: InsertAnnotation): Promise<Annotation>;
  getAnnotationsByDocument(documentId: number): Promise<Annotation[]>;
  createManyAnnotations(annotations: InsertAnnotation[]): Promise<Annotation[]>;

  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogsByTenant(tenantId: number): Promise<AuditLog[]>;

  getDefenseSession(id: number): Promise<DefenseSession | undefined>;
  createDefenseSession(session: InsertDefenseSession): Promise<DefenseSession>;
  updateDefenseSession(id: number, data: Partial<InsertDefenseSession>): Promise<DefenseSession | undefined>;
  getDefenseSessionsByDocument(documentId: number): Promise<DefenseSession[]>;

  addCredits(userId: string, amount: number, description: string, stripeSessionId?: string): Promise<{ user: User; transaction: CreditTransaction }>;
  deductCredit(userId: string, documentId: number, description: string): Promise<{ user: User; transaction: CreditTransaction }>;
  getCreditTransactions(userId: string): Promise<CreditTransaction[]>;
  refundFailedAnalysis(userId: string, usageId: number, resultId?: number): Promise<void>;
}

export class InsufficientCreditsError extends Error {}
export class PaymentOwnershipError extends Error {}
export class AnalysisInProgressError extends Error {}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`);
    return user;
  }

  /** Create the user's organisation and account atomically (no orphan tenants). */
  async registerUser(input: { username: string; email: string; passwordHash: string; fullName: string }): Promise<User> {
    return db.transaction(async (tx) => {
      const slugBase = input.username.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 40) || "org";
      const slug = `${slugBase}-${randomBytes(4).toString("hex")}`;
      const [tenant] = await tx.insert(tenants).values({ name: `${input.fullName}'s Organization`, slug, plan: "free", isActive: true }).returning();
      const [user] = await tx.insert(users).values({
        tenantId: tenant.id, username: input.username, email: input.email, password: input.passwordHash,
        fullName: input.fullName, role: "student", isActive: true,
      }).returning();
      return user;
    });
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async getUsersByTenant(tenantId: number): Promise<User[]> {
    return db.select().from(users).where(eq(users.tenantId, tenantId));
  }

  async getTenant(id: number): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant;
  }

  async createTenant(tenant: InsertTenant): Promise<Tenant> {
    const [created] = await db.insert(tenants).values(tenant).returning();
    return created;
  }

  async updateTenant(id: number, data: Partial<InsertTenant>): Promise<Tenant | undefined> {
    const [updated] = await db.update(tenants).set(data).where(eq(tenants.id, id)).returning();
    return updated;
  }

  async getAllTenants(): Promise<Tenant[]> {
    return db.select().from(tenants);
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    return doc;
  }

  async createDocument(doc: InsertDocument): Promise<Document> {
    const [created] = await db.insert(documents).values(doc).returning();
    return created;
  }

  async updateDocument(id: number, data: Partial<InsertDocument>): Promise<Document | undefined> {
    const [updated] = await db.update(documents).set(data).where(eq(documents.id, id)).returning();
    return updated;
  }

  async getDocumentsByUser(userId: string): Promise<Document[]> {
    return db.select().from(documents).where(eq(documents.userId, userId)).orderBy(desc(documents.createdAt));
  }

  async getDocumentsByTenant(tenantId: number): Promise<Document[]> {
    return db.select().from(documents).where(eq(documents.tenantId, tenantId)).orderBy(desc(documents.createdAt));
  }

  /**
   * Transactional document deletion (see docs/DATA_LIFECYCLE.md):
   * locks the row, refuses while an analysis job is active, removes derived records via
   * ON DELETE CASCADE (results, annotations, defense sessions, finished jobs), keeps the
   * credit ledger (document_id becomes NULL) and writes the audit entry atomically.
   */
  async deleteDocument(id: number, actor: { userId: string; tenantId: number; ipAddress: string | null }): Promise<"deleted" | "not_found" | "busy"> {
    return db.transaction(async tx => {
      const [doc] = await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.tenantId, actor.tenantId))).for("update");
      if (!doc) return "not_found";
      const [active] = await tx.select({ id: analysisJobs.id }).from(analysisJobs)
        .where(and(eq(analysisJobs.documentId, id), inArray(analysisJobs.status, ["queued", "running"]))).limit(1);
      if (active || doc.status === "processing") return "busy";
      const [counts] = (await tx.execute(sql`select
        (select count(*) from analysis_results where document_id = ${id})::int as results,
        (select count(*) from annotations where document_id = ${id})::int as annotations,
        (select count(*) from defense_sessions where document_id = ${id})::int as defense_sessions,
        (select count(*) from credit_transactions where document_id = ${id})::int as ledger_entries_retained`)).rows as any[];
      await tx.delete(documents).where(eq(documents.id, id));
      await tx.insert(auditLogs).values({
        tenantId: actor.tenantId, userId: actor.userId, action: "document_deleted", resourceType: "document",
        resourceId: String(id), details: { title: doc.title, ...counts }, ipAddress: actor.ipAddress,
      });
      return "deleted";
    });
  }

  async getRubric(id: number): Promise<Rubric | undefined> {
    const [rubric] = await db.select().from(rubrics).where(eq(rubrics.id, id));
    return rubric;
  }

  async createRubric(rubric: InsertRubric): Promise<Rubric> {
    const [created] = await db.insert(rubrics).values(rubric).returning();
    return created;
  }

  async updateRubric(id: number, data: Partial<InsertRubric>): Promise<Rubric | undefined> {
    const [updated] = await db.update(rubrics).set(data).where(eq(rubrics.id, id)).returning();
    return updated;
  }

  async getRubricsByTenant(tenantId: number): Promise<Rubric[]> {
    return db.select().from(rubrics).where(eq(rubrics.tenantId, tenantId));
  }

  async getRubricTemplates(): Promise<Rubric[]> {
    return db.select().from(rubrics).where(eq(rubrics.isTemplate, true));
  }

  async getAnalysisResult(id: number): Promise<AnalysisResult | undefined> {
    const [result] = await db.select().from(analysisResults).where(eq(analysisResults.id, id));
    return result;
  }

  async createAnalysisResult(result: InsertAnalysisResult): Promise<AnalysisResult> {
    const [created] = await db.insert(analysisResults).values(result).returning();
    return created;
  }

  async updateAnalysisResult(id: number, data: Partial<InsertAnalysisResult>): Promise<AnalysisResult | undefined> {
    const [updated] = await db.update(analysisResults).set(data).where(eq(analysisResults.id, id)).returning();
    return updated;
  }

  async getResultsByDocument(documentId: number): Promise<AnalysisResult[]> {
    return db.select().from(analysisResults).where(eq(analysisResults.documentId, documentId));
  }

  async getAnnotation(id: number): Promise<Annotation | undefined> {
    const [annotation] = await db.select().from(annotations).where(eq(annotations.id, id));
    return annotation;
  }

  async createAnnotation(annotation: InsertAnnotation): Promise<Annotation> {
    const [created] = await db.insert(annotations).values(annotation).returning();
    return created;
  }

  async getAnnotationsByDocument(documentId: number): Promise<Annotation[]> {
    return db.select().from(annotations).where(eq(annotations.documentId, documentId));
  }

  async createManyAnnotations(annotationList: InsertAnnotation[]): Promise<Annotation[]> {
    if (annotationList.length === 0) return [];
    return db.insert(annotations).values(annotationList).returning();
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs).values(log).returning();
    return created;
  }

  async getAuditLogsByTenant(tenantId: number): Promise<AuditLog[]> {
    return db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)).orderBy(desc(auditLogs.createdAt));
  }

  async getDefenseSession(id: number): Promise<DefenseSession | undefined> {
    const [session] = await db.select().from(defenseSessions).where(eq(defenseSessions.id, id));
    return session;
  }

  async createDefenseSession(session: InsertDefenseSession): Promise<DefenseSession> {
    const [created] = await db.insert(defenseSessions).values(session).returning();
    return created;
  }

  async updateDefenseSession(id: number, data: Partial<InsertDefenseSession>): Promise<DefenseSession | undefined> {
    const [updated] = await db.update(defenseSessions).set(data).where(eq(defenseSessions.id, id)).returning();
    return updated;
  }

  async getDefenseSessionsByDocument(documentId: number): Promise<DefenseSession[]> {
    return db.select().from(defenseSessions).where(eq(defenseSessions.documentId, documentId));
  }

  async addCredits(userId: string, amount: number, description: string, stripeSessionId?: string): Promise<{ user: User; transaction: CreditTransaction }> {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 999999) throw new Error("Invalid credit amount");
    return db.transaction(async tx => {
      if (stripeSessionId) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"stripe:" + stripeSessionId}, 0))`);
        const [existing] = await tx.select().from(creditTransactions).where(eq(creditTransactions.stripeSessionId, stripeSessionId)).limit(1);
        if (existing) {
          if (existing.userId !== userId || existing.type !== "purchase" || existing.amount !== amount) throw new PaymentOwnershipError("Payment already processed");
          const [user] = await tx.select().from(users).where(eq(users.id, userId));
          if (!user) throw new Error("User not found");
          return { user, transaction: existing };
        }
      }
      const [user] = await tx.update(users).set({ reviewCredits: sql`${users.reviewCredits} + ${amount}` })
        .where(and(eq(users.id, userId), eq(users.isActive, true))).returning();
      if (!user) throw new Error("User not available");
      const [transaction] = await tx.insert(creditTransactions).values({
        userId, tenantId: user.tenantId, type: "purchase", amount, balanceAfter: user.reviewCredits,
        description, stripeSessionId: stripeSessionId || null,
      }).returning();
      return { user, transaction };
    });
  }

  async deductCredit(userId: string, documentId: number, description: string): Promise<{ user: User; transaction: CreditTransaction }> {
    return db.transaction(async tx => {
      const [user] = await tx.update(users).set({ reviewCredits: sql`${users.reviewCredits} - 1` })
        .where(and(eq(users.id, userId), eq(users.isActive, true), gt(users.reviewCredits, 0))).returning();
      if (!user) throw new InsufficientCreditsError("Insufficient review credits");
      if (user.tenantId === null) throw new AnalysisInProgressError("Document unavailable");
      const [claimed] = await tx.update(documents).set({ status: "processing", overallScore: null, metadata: null, updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.userId, userId), eq(documents.tenantId, user.tenantId), ne(documents.status, "processing"))).returning({ id: documents.id });
      if (!claimed) throw new AnalysisInProgressError("Document unavailable or already processing");
      const [transaction] = await tx.insert(creditTransactions).values({
        userId, tenantId: user.tenantId, type: "usage", amount: -1, balanceAfter: user.reviewCredits, description, documentId,
      }).returning();
      return { user, transaction };
    });
  }

  async refundFailedAnalysis(userId: string, usageId: number, resultId?: number): Promise<void> {
    await db.transaction(async tx => {
      const usage = await refundUsageInTx(tx, userId, usageId);
      if (resultId !== undefined) await tx.update(analysisResults).set({ status: "failed", score: null, results: { summary: "Analysis operation failed." }, updatedAt: new Date() }).where(and(eq(analysisResults.id, resultId), eq(analysisResults.documentId, usage.documentId!)));
      await tx.update(documents).set({ status: "failed", overallScore: null, metadata: null, updatedAt: new Date() }).where(and(eq(documents.id, usage.documentId!), eq(documents.userId, userId)));
    });
  }

  async getCreditTransactions(userId: string): Promise<CreditTransaction[]> {
    return db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt));
  }
}

export const storage = new DatabaseStorage();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Idempotently refund one analysis usage debit inside an existing transaction. */
export async function refundUsageInTx(tx: Tx, userId: string, usageId: number): Promise<CreditTransaction> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"analysis-refund:" + usageId}, 0))`);
  const [usage] = await tx.select().from(creditTransactions).where(and(eq(creditTransactions.id, usageId), eq(creditTransactions.userId, userId), eq(creditTransactions.type, "usage")));
  if (!usage || usage.amount !== -1 || usage.documentId === null) throw new Error("Invalid analysis credit reference");
  const reference = "Refund for analysis usage #" + usageId;
  const [existing] = await tx.select().from(creditTransactions).where(and(eq(creditTransactions.userId, userId), eq(creditTransactions.type, "refund"), eq(creditTransactions.description, reference))).limit(1);
  if (existing) return usage;
  const [user] = await tx.update(users).set({ reviewCredits: sql`${users.reviewCredits} + 1` }).where(eq(users.id, userId)).returning();
  if (!user) throw new Error("User unavailable");
  await tx.insert(creditTransactions).values({ userId, tenantId: usage.tenantId, type: "refund", amount: 1, balanceAfter: user.reviewCredits, description: reference, documentId: usage.documentId });
  return usage;
}
