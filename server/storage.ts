import { eq, and, desc } from "drizzle-orm";
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
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
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
  deleteDocument(id: number): Promise<void>;

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
}

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
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
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

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
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
}

export const storage = new DatabaseStorage();
