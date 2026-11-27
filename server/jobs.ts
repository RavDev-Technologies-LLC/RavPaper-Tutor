import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { and, eq, inArray, ne, sql, gt, isNull, or } from "drizzle-orm";
import { db } from "./db";
import {
  analysisJobs, analysisResults, annotations, auditLogs, creditTransactions, documents, rubrics, users,
  type AnalysisJob, type InsertAnnotation,
} from "@shared/schema";
import { AnalysisInProgressError, InsufficientCreditsError, refundUsageInTx } from "./storage";
import { assessSimilarity, MAX_SOURCES } from "./similarity";

/**
 * Durable analysis jobs (AUD-13).
 *
 * The HTTP request only debits one credit and enqueues a job in the same transaction.
 * Workers claim jobs with FOR UPDATE SKIP LOCKED under a time-limited lease that is
 * renewed by a heartbeat. Each engine result is checkpointed, so a retry after a crash
 * resumes at the first unfinished engine. Expired leases are reclaimed automatically.
 * Final failure or cancellation refunds the credit in the same transaction that closes
 * the job.
 */

export const ALL_ENGINES = ["plagiarism", "rubric_alignment", "statistics", "literature_review", "anthropomorphism", "formatting"] as const;
export type EngineName = (typeof ALL_ENGINES)[number];

const LEASE_MS = Number(process.env.ANALYSIS_LEASE_MS ?? 120_000);
const HEARTBEAT_MS = Math.max(1000, Math.floor(LEASE_MS / 4));
const POLL_MS = Number(process.env.ANALYSIS_POLL_MS ?? 2000);
const BACKOFF_BASE_MS = Number(process.env.ANALYSIS_BACKOFF_MS ?? 10_000);

export type EngineContext = { documentId: number; tenantId: number; userId: string; rubricCriteria: any[] };
export type EngineRunner = (engine: EngineName, content: string, ctx: EngineContext) => Promise<any>;

async function similarityEngine(content: string, ctx: EngineContext) {
  const rows = await db.select({ id: documents.id, userId: documents.userId, title: documents.title, content: documents.fileContent })
    .from(documents)
    .where(and(eq(documents.tenantId, ctx.tenantId), ne(documents.id, ctx.documentId), sql`${documents.fileContent} is not null`))
    .orderBy(sql`${documents.createdAt} desc`).limit(MAX_SOURCES + 1);
  const sources = rows.slice(0, MAX_SOURCES).map((r) => r.userId === ctx.userId
    ? { id: r.id, label: `your document "${r.title}"`, content: r.content! }
    // Other users' titles and ids are not disclosed.
    : { id: 0, label: "another submission in your organization", content: r.content! });
  return assessSimilarity(content, sources, { sourcesTruncated: rows.length > MAX_SOURCES });
}

export const defaultEngineRunner: EngineRunner = async (engine, content, ctx) => {
  if (engine === "plagiarism") return similarityEngine(content, ctx);
  const e = await import("./engines");
  switch (engine) {
    case "rubric_alignment": return e.runRubricEngine(content, ctx.rubricCriteria);
    case "statistics": return e.runStatisticsEngine(content);
    case "literature_review": return e.runLiteratureEngine(content);
    case "anthropomorphism": return e.runAnthropomorphismEngine(content);
    case "formatting": return e.runFormattingEngine(content);
  }
};

let engineRunner: EngineRunner = defaultEngineRunner;
/** Test hook. */
export function setEngineRunner(r: EngineRunner | null) { engineRunner = r ?? defaultEngineRunner; }

export async function enqueueAnalysis(input: { userId: string; documentId: number; rubricId: number | null; engines: EngineName[] }): Promise<AnalysisJob> {
  return db.transaction(async (tx) => {
    const [user] = await tx.update(users).set({ reviewCredits: sql`${users.reviewCredits} - 1` })
      .where(and(eq(users.id, input.userId), eq(users.isActive, true), gt(users.reviewCredits, 0))).returning();
    if (!user) throw new InsufficientCreditsError("Insufficient review credits");
    const [doc] = await tx.update(documents).set({ status: "processing", updatedAt: new Date() })
      .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId), eq(documents.tenantId, user.tenantId), ne(documents.status, "processing")))
      .returning({ id: documents.id, title: documents.title });
    if (!doc) throw new AnalysisInProgressError("Document unavailable or already processing");
    const [usage] = await tx.insert(creditTransactions).values({
      userId: user.id, tenantId: user.tenantId, type: "usage", amount: -1, balanceAfter: user.reviewCredits,
      description: `Analysis of "${doc.title}"`, documentId: doc.id,
    }).returning();
    const [job] = await tx.insert(analysisJobs).values({
      tenantId: user.tenantId, userId: user.id, documentId: doc.id, usageTransactionId: usage.id,
      rubricId: input.rubricId, engines: input.engines,
    }).returning();
    await tx.insert(auditLogs).values({
      tenantId: user.tenantId, userId: user.id, action: "analysis_queued", resourceType: "document",
      resourceId: String(doc.id), details: { jobId: job.id, engines: input.engines }, ipAddress: null,
    });
    return job;
  });
}

export async function getJob(id: number): Promise<AnalysisJob | undefined> {
  const [job] = await db.select().from(analysisJobs).where(eq(analysisJobs.id, id));
  return job;
}

type CloseOutcome = "failed" | "cancelled";

/** Close a job and refund its credit atomically. Returns false if the job was already closed. */
async function closeWithRefund(jobId: number, outcome: CloseOutcome, reason: string, leaseOwner?: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).for("update");
    if (!job || !["queued", "running"].includes(job.status)) return false;
    if (leaseOwner && job.status === "running" && job.leaseOwner !== leaseOwner) return false;
    await refundUsageInTx(tx, job.userId, job.usageTransactionId);
    await tx.delete(analysisResults).where(eq(analysisResults.jobId, job.id)); // drop partial output
    await tx.update(analysisJobs).set({ status: outcome, lastError: reason.slice(0, 500), leaseOwner: null, leaseExpiresAt: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(analysisJobs.id, job.id));
    await tx.update(documents).set({ status: outcome === "cancelled" ? "pending" : "failed", updatedAt: new Date() }).where(eq(documents.id, job.documentId));
    await tx.insert(auditLogs).values({
      tenantId: job.tenantId, userId: job.userId, action: outcome === "cancelled" ? "analysis_cancelled" : "analysis_failed",
      resourceType: "document", resourceId: String(job.documentId), details: { jobId: job.id, attempts: job.attempts, reason: reason.slice(0, 200), refunded: true }, ipAddress: null,
    });
    return true;
  });
}

/** Cancel immediately if queued; otherwise flag a running job for cooperative cancellation. */
export async function requestCancel(jobId: number): Promise<"cancelled" | "cancelling" | "finished"> {
  const [job] = await db.update(analysisJobs).set({ cancelRequested: true, updatedAt: new Date() })
    .where(and(eq(analysisJobs.id, jobId), inArray(analysisJobs.status, ["queued", "running"]))).returning();
  if (!job) return "finished";
  if (job.status === "queued" && await closeWithRefund(jobId, "cancelled", "Cancelled by user")) return "cancelled";
  return "cancelling";
}

export function workerId() {
  return `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
}

/** Claim one runnable job (queued and due, or running with an expired lease). */
export async function claimJob(owner: string): Promise<AnalysisJob | undefined> {
  const result = await db.execute(sql`
    update analysis_jobs set status = 'running', attempts = attempts + 1, lease_owner = ${owner},
      lease_expires_at = now() + (${LEASE_MS} * interval '1 millisecond'),
      started_at = coalesce(started_at, now()), updated_at = now()
    where id = (
      select id from analysis_jobs
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and lease_expires_at < now())
      order by run_after, id
      for update skip locked
      limit 1
    )
    returning id`);
  const id = (result.rows[0] as any)?.id;
  return id ? getJob(Number(id)) : undefined;
}

class LeaseLost extends Error {}
class CancelRequested extends Error {}

export async function processJob(job: AnalysisJob, owner: string): Promise<void> {
  if (job.attempts > job.maxAttempts) {
    await closeWithRefund(job.id, "failed", "Exceeded retry limit after worker interruption", owner);
    return;
  }

  let leaseLost = false;
  let cancel = job.cancelRequested;
  const beat = setInterval(async () => {
    try {
      const [row] = await db.update(analysisJobs).set({ leaseExpiresAt: sql`now() + (${LEASE_MS} * interval '1 millisecond')`, updatedAt: sql`now()` })
        .where(and(eq(analysisJobs.id, job.id), eq(analysisJobs.leaseOwner, owner), eq(analysisJobs.status, "running")))
        .returning({ cancelRequested: analysisJobs.cancelRequested });
      if (!row) leaseLost = true; else cancel = row.cancelRequested;
    } catch { /* transient; next beat retries */ }
  }, HEARTBEAT_MS);
  const checkpoint = () => { if (leaseLost) throw new LeaseLost(); if (cancel) throw new CancelRequested(); };

  try {
    checkpoint();
    const [doc] = await db.select().from(documents).where(eq(documents.id, job.documentId));
    if (!doc?.fileContent) throw new Error("Document content unavailable");
    let rubricCriteria: any[] = [];
    if (job.rubricId) {
      const [r] = await db.select().from(rubrics).where(eq(rubrics.id, job.rubricId));
      if (r) rubricCriteria = r.criteria as any[];
    }
    const ctx: EngineContext = { documentId: doc.id, tenantId: doc.tenantId, userId: doc.userId, rubricCriteria };
    const existing = await db.select().from(analysisResults).where(eq(analysisResults.jobId, job.id));

    for (const engine of job.engines as EngineName[]) {
      checkpoint();
      const prior = existing.find((r) => r.engineType === engine);
      if (prior?.status === "completed") continue; // checkpoint from an earlier attempt
      const record = prior ?? (await db.insert(analysisResults).values({
        tenantId: doc.tenantId, documentId: doc.id, engineType: engine, status: "processing", jobId: job.id,
      }).returning())[0];

      const output = await engineRunner(engine, doc.fileContent, ctx);
      checkpoint();
      if (!output || typeof output.score !== "number") throw new Error(`Engine ${engine} returned no score`);

      await db.transaction(async (tx) => {
        await tx.update(analysisResults).set({ status: "completed", score: Math.round(output.score), results: output, updatedAt: new Date() }).where(eq(analysisResults.id, record.id));
        await tx.delete(annotations).where(eq(annotations.analysisResultId, record.id));
        const findings: any[] = output.findings || output.criteriaScores || [];
        if (findings.length) {
          const batch: InsertAnnotation[] = findings.slice(0, 50).map((f: any) => ({
            tenantId: doc.tenantId, documentId: doc.id, analysisResultId: record.id, sentenceIndex: null,
            originalText: String(f.text || f.criterion || f.statistic || f.section || f.location || ""),
            suggestion: f.suggestion || f.feedback || f.correction || null,
            severity: ["critical", "warning", "info"].includes(f.severity) ? f.severity : "info",
            engineType: engine, category: f.category || null,
          }));
          await tx.insert(annotations).values(batch);
        }
      });
    }

    checkpoint();
    const { runScoringAggregator } = await import("./engines");
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(analysisJobs).where(eq(analysisJobs.id, job.id)).for("update");
      if (!locked || locked.status !== "running" || locked.leaseOwner !== owner) throw new LeaseLost();
      if (locked.cancelRequested) throw new CancelRequested();
      const results = await tx.select().from(analysisResults).where(eq(analysisResults.jobId, job.id));
      const aggregated = runScoringAggregator(results.map((r) => ({ engineType: r.engineType, score: r.score })));
      // The new run supersedes earlier runs for this document.
      await tx.delete(analysisResults).where(and(eq(analysisResults.documentId, job.documentId), or(isNull(analysisResults.jobId), ne(analysisResults.jobId, job.id))));
      await tx.update(documents).set({ status: "completed", overallScore: aggregated.overallScore, metadata: aggregated, updatedAt: new Date() }).where(eq(documents.id, job.documentId));
      await tx.update(analysisJobs).set({ status: "succeeded", leaseOwner: null, leaseExpiresAt: null, lastError: null, finishedAt: new Date(), updatedAt: new Date() }).where(eq(analysisJobs.id, job.id));
      await tx.insert(auditLogs).values({
        tenantId: job.tenantId, userId: job.userId, action: "analysis_completed", resourceType: "document",
        resourceId: String(job.documentId), details: { jobId: job.id, overallScore: aggregated.overallScore, engines: job.engines, attempts: job.attempts }, ipAddress: null,
      });
    });
  } catch (e) {
    if (e instanceof LeaseLost) return; // another worker owns it now
    if (e instanceof CancelRequested) { await closeWithRefund(job.id, "cancelled", "Cancelled by user", owner); return; }
    const message = e instanceof Error ? e.message : "Analysis failed";
    console.error(JSON.stringify({ event: "analysis_job_error", jobId: job.id, attempt: job.attempts, error: message.slice(0, 200) }));
    if (job.attempts < job.maxAttempts) {
      const delay = BACKOFF_BASE_MS * 2 ** (job.attempts - 1);
      await db.update(analysisJobs).set({ status: "queued", runAfter: sql`now() + (${delay} * interval '1 millisecond')`, leaseOwner: null, leaseExpiresAt: null, lastError: message.slice(0, 500), updatedAt: new Date() })
        .where(and(eq(analysisJobs.id, job.id), eq(analysisJobs.leaseOwner, owner), eq(analysisJobs.status, "running")));
    } else {
      await closeWithRefund(job.id, "failed", message, owner);
    }
  } finally {
    clearInterval(beat);
  }
}

/** Claim and process at most one job. Returns true if a job was processed. */
export async function runWorkerOnce(owner = workerId()): Promise<boolean> {
  const job = await claimJob(owner);
  if (!job) return false;
  await processJob(job, owner);
  return true;
}

export function startWorker(opts: { concurrency?: number } = {}): () => Promise<void> {
  const owner = workerId();
  const concurrency = Math.max(1, opts.concurrency ?? Number(process.env.ANALYSIS_CONCURRENCY ?? 2));
  let stopped = false;
  const loops = Array.from({ length: concurrency }, async () => {
    while (!stopped) {
      let worked = false;
      try { worked = await runWorkerOnce(owner); }
      catch (e) { console.error(JSON.stringify({ event: "analysis_worker_error", error: e instanceof Error ? e.message.slice(0, 200) : "error" })); }
      if (!worked && !stopped) await new Promise((r) => setTimeout(r, POLL_MS));
    }
  });
  console.log(JSON.stringify({ event: "analysis_worker_started", owner, concurrency }));
  return async () => { stopped = true; await Promise.all(loops); };
}
