import express, { type Express } from "express";
import type { Server } from "http";
import multer from "multer";
import { storage, InsufficientCreditsError, AnalysisInProgressError } from "./storage";
import { creditsForCatalogPrice, loadBillingConfig } from "./billing-policy";
import { authMiddleware, requireRole } from "./auth";
import { registerAuthRoutes, getIp } from "./auth-routes";
import type { AuthRateLimits } from "./rate-limit";
import { ownsDocument, canReadRubric, canChangeRole } from "./security-policy";
import { generateDefenseQuestions, evaluateDefenseAnswer } from "./engines";
import { getStripePublishableKey, getVerifiedStripe, BillingUnavailableError } from "./stripeClient";
import { fulfillCheckoutSession } from "./fulfillment";
import { extractText, ExtractionError, MAX_UPLOAD_BYTES } from "./extraction";
import { ALL_ENGINES, enqueueAnalysis, getJob, requestCancel, type EngineName } from "./jobs";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { submissionTypeEnum } from "@shared/schema";

export type RouteOptions = { authRateLimits?: AuthRateLimits };

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } });
const SUBMISSION_TYPES = submissionTypeEnum.enumValues as readonly string[];

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  options: RouteOptions = {},
): Promise<Server> {
  registerAuthRoutes(app, options.authRateLimits);

  // ─── Document Routes ───────────────────────────────────────────
  app.get("/api/documents", authMiddleware, async (req, res) => {
    try {
      const docs = await storage.getDocumentsByUser(req.user!.id);
      res.json(docs);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Multipart upload: the server extracts text from PDF, DOCX, TXT and Markdown.
  app.post("/api/documents/upload", authMiddleware, (req, res, next) => {
    upload.single("file")(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File exceeds the 20 MB limit" : "Invalid upload" });
      }
      if (err) return next(err);
      next();
    });
  }, async (req, res) => {
    try {
      const file = req.file;
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      const submissionType = req.body?.submissionType;
      if (!file) return res.status(400).json({ error: "A file is required" });
      if (!title || title.length > 300) return res.status(400).json({ error: "Title is required (max 300 characters)" });
      if (!SUBMISSION_TYPES.includes(submissionType)) return res.status(400).json({ error: "Invalid submission type" });
      const fileName = file.originalname.slice(0, 255);

      let extracted;
      try { extracted = await extractText(fileName, file.buffer); }
      catch (e) { if (e instanceof ExtractionError) return res.status(422).json({ error: e.message, code: e.code }); throw e; }

      const doc = await storage.createDocument({
        tenantId: req.user!.tenantId, userId: req.user!.id, title, submissionType, fileName,
        fileSize: file.size, fileContent: extracted.text, status: "pending", overallScore: null,
        metadata: { extraction: { format: extracted.format, pages: extracted.pages, words: extracted.words, chars: extracted.chars } },
      });
      await storage.createAuditLog({
        tenantId: req.user!.tenantId, userId: req.user!.id, action: "document_uploaded", resourceType: "document",
        resourceId: String(doc.id), details: { title, fileName, format: extracted.format, words: extracted.words }, ipAddress: getIp(req),
      });
      res.status(201).json(doc);
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/documents/:id", authMiddleware, async (req, res) => {
    try {
      const doc = await storage.getDocument(Number(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (!ownsDocument(req.user!, doc)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(doc);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/documents/:id", authMiddleware, async (req, res) => {
    try {
      const doc = await storage.getDocument(Number(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (!ownsDocument(req.user!, doc)) return res.status(403).json({ error: "Forbidden" });
      const outcome = await storage.deleteDocument(doc.id, { userId: req.user!.id, tenantId: req.user!.tenantId, ipAddress: getIp(req) });
      if (outcome === "not_found") return res.status(404).json({ error: "Document not found" });
      if (outcome === "busy") return res.status(409).json({ error: "Cancel the running analysis before deleting this document" });
      res.status(204).send();
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/documents/:id/annotations", authMiddleware, async (req, res) => {
    try {
      const docId = Number(req.params.id);
      const doc = await storage.getDocument(docId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (!ownsDocument(req.user!, doc)) return res.status(403).json({ error: "Forbidden" });
      const anns = await storage.getAnnotationsByDocument(docId);
      res.json(anns);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Rubric Routes ─────────────────────────────────────────────
  app.get("/api/rubrics", authMiddleware, async (req, res) => {
    try {
      const tenantRubrics = req.tenantId ? await storage.getRubricsByTenant(req.tenantId) : [];
      const templates = (await storage.getRubricTemplates()).filter(r => canReadRubric(req.user!, r));
      const combined = [...tenantRubrics];
      for (const t of templates) {
        if (!combined.find((r) => r.id === t.id)) combined.push(t);
      }
      res.json(combined);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/rubrics", authMiddleware, async (req, res) => {
    try {
      const { name, submissionType, criteria, isTemplate } = req.body;
      if (typeof name !== "string" || !name.trim() || !Array.isArray(criteria) || !criteria.length) return res.status(400).json({ error: "Name and criteria required" });
      if (isTemplate && req.user!.role !== "super_admin") return res.status(403).json({ error: "Forbidden" });

      const rubric = await storage.createRubric({
        tenantId: isTemplate ? null : req.user!.tenantId,
        name,
        submissionType: submissionType || null,
        criteria,
        isTemplate: isTemplate || false,
        createdBy: req.user!.id,
      });

      res.status(201).json(rubric);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/rubrics/:id", authMiddleware, async (req, res) => {
    try {
      const rubric = await storage.getRubric(Number(req.params.id));
      if (!rubric) return res.status(404).json({ error: "Rubric not found" });
      if (!canReadRubric(req.user!, rubric)) return res.status(403).json({ error: "Forbidden" });
      res.json(rubric);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Analysis Routes ───────────────────────────────────────────
  // Enqueue a durable analysis job; the worker does the work outside the request.
  app.post("/api/analysis/run/:documentId", authMiddleware, async (req, res) => {
    try {
      const documentId = Number(req.params.documentId);
      const doc = await storage.getDocument(documentId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (!ownsDocument(req.user!, doc)) return res.status(403).json({ error: "Forbidden" });
      if (!doc.fileContent) return res.status(400).json({ error: "Document has no content to analyze" });

      const { rubricId, engines } = req.body || {};
      const all = ALL_ENGINES as readonly string[];
      if (engines !== undefined && (!Array.isArray(engines) || !engines.length || engines.length > all.length || engines.some((e: unknown) => typeof e !== "string" || !all.includes(e)) || new Set(engines).size !== engines.length)) {
        return res.status(400).json({ error: "Invalid analysis engine selection" });
      }
      if (rubricId !== undefined && rubricId !== null) {
        if (!Number.isSafeInteger(rubricId) || rubricId < 1) return res.status(400).json({ error: "Invalid rubric" });
        const selectedRubric = await storage.getRubric(rubricId);
        if (!selectedRubric || !canReadRubric(req.user!, selectedRubric)) return res.status(403).json({ error: "Rubric unavailable" });
      }

      try {
        const job = await enqueueAnalysis({ userId: req.user!.id, documentId, rubricId: rubricId ?? null, engines: (engines ?? [...ALL_ENGINES]) as EngineName[] });
        res.status(202).json({ jobId: job.id, status: job.status });
      } catch (error) {
        if (error instanceof InsufficientCreditsError) return res.status(402).json({ error: "Insufficient review credits", message: "You need at least 1 review credit to run an analysis. Purchase credits from the Pricing page." });
        if (error instanceof AnalysisInProgressError || (error as any)?.code === "23505") return res.status(409).json({ error: "Document unavailable or already processing" });
        throw error;
      }
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  const jobView = (j: NonNullable<Awaited<ReturnType<typeof getJob>>>) => ({
    id: j.id, documentId: j.documentId, status: j.status, engines: j.engines, attempts: j.attempts, maxAttempts: j.maxAttempts,
    cancelRequested: j.cancelRequested, error: j.status === "failed" ? "Analysis failed; your review credit was restored" : null,
    createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
  });

  app.get("/api/analysis/jobs/:id", authMiddleware, async (req, res) => {
    try {
      const job = await getJob(Number(req.params.id));
      if (!job || job.userId !== req.user!.id || job.tenantId !== req.user!.tenantId) return res.status(404).json({ error: "Job not found" });
      const completed = await db.execute(sql`select engine_type from analysis_results where job_id = ${job.id} and status = 'completed'`);
      res.json({ ...jobView(job), completedEngines: completed.rows.map((r: any) => r.engine_type) });
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/documents/:id/jobs/latest", authMiddleware, async (req, res) => {
    try {
      const doc = await storage.getDocument(Number(req.params.id));
      if (!doc || !ownsDocument(req.user!, doc)) return res.status(404).json({ error: "Document not found" });
      const r = await db.execute(sql`select id from analysis_jobs where document_id = ${doc.id} order by id desc limit 1`);
      const id = (r.rows[0] as any)?.id;
      const job = id ? await getJob(Number(id)) : undefined;
      res.json(job ? jobView(job) : null);
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/analysis/jobs/:id/cancel", authMiddleware, async (req, res) => {
    try {
      const job = await getJob(Number(req.params.id));
      if (!job || job.userId !== req.user!.id || job.tenantId !== req.user!.tenantId) return res.status(404).json({ error: "Job not found" });
      const outcome = await requestCancel(job.id);
      await storage.createAuditLog({ tenantId: job.tenantId, userId: req.user!.id, action: "analysis_cancel_requested", resourceType: "document", resourceId: String(job.documentId), details: { jobId: job.id, outcome }, ipAddress: getIp(req) });
      res.status(outcome === "finished" ? 409 : 202).json({ status: outcome });
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/analysis/results/:documentId", authMiddleware, async (req, res) => {
    try {
      const documentId = Number(req.params.documentId);
      const doc = await storage.getDocument(documentId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (!ownsDocument(req.user!, doc)) return res.status(403).json({ error: "Forbidden" });
      const results = await storage.getResultsByDocument(documentId);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/analysis/defense/:documentId", authMiddleware, async (req, res) => {
    try {
      const documentId = Number(req.params.documentId);
      const doc = await storage.getDocument(documentId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (!ownsDocument(req.user!, doc)) return res.status(403).json({ error: "Forbidden" });
      if (!doc.fileContent) return res.status(400).json({ error: "Document has no content" });

      const questionsResult = await generateDefenseQuestions(doc.fileContent);

      const session = await storage.createDefenseSession({
        tenantId: req.user!.tenantId,
        documentId,
        userId: req.user!.id,
        questions: questionsResult.questions || [],
        answers: [],
        overallScore: null,
        status: "active",
      });

      await storage.createAuditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: "defense_session_started",
        resourceType: "defense_session",
        resourceId: String(session.id),
        details: { documentId, questionCount: (questionsResult.questions || []).length },
        ipAddress: getIp(req),
      });

      res.status(201).json(session);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/analysis/defense/:sessionId/answer", authMiddleware, async (req, res) => {
    try {
      const sessionId = Number(req.params.sessionId);
      const { questionIndex, answer } = req.body;
      if (!Number.isSafeInteger(questionIndex) || typeof answer !== "string" || !answer.trim() || answer.length > 20000) {
        return res.status(400).json({ error: "questionIndex and answer are required" });
      }

      const session = await storage.getDefenseSession(sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (!ownsDocument(req.user!, session)) return res.status(403).json({ error: "Forbidden" });

      const questions = (session.questions as any[]) || [];
      if (questionIndex < 0 || questionIndex >= questions.length) {
        return res.status(400).json({ error: "Invalid question index" });
      }

      const doc = await storage.getDocument(session.documentId!);
      if (!doc || !ownsDocument(req.user!, doc)) return res.status(403).json({ error: "Forbidden" });
      const docContent = doc.fileContent || "";
      const question = questions[questionIndex].question;

      const evaluation = await evaluateDefenseAnswer(question, answer, docContent);

      const answers = (session.answers as any[]) || [];
      answers[questionIndex] = { answer, evaluation };

      const answeredCount = answers.filter(Boolean).length;
      const totalScore = answers.reduce((sum: number, a: any) => sum + (a?.evaluation?.score || 0), 0);
      const avgScore = answeredCount > 0 ? Math.round(totalScore / answeredCount) : null;
      const allAnswered = answeredCount >= questions.length;

      await storage.updateDefenseSession(sessionId, {
        answers,
        overallScore: avgScore,
        status: allAnswered ? "completed" : "active",
      } as any);

      res.json({ evaluation, progress: { answered: answeredCount, total: questions.length, overallScore: avgScore } });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Admin Routes ──────────────────────────────────────────────
  const adminMiddleware = [authMiddleware, requireRole("program_admin", "security_admin", "super_admin")];

  app.get("/api/admin/users", ...adminMiddleware, async (req, res) => {
    try {
      if (!req.tenantId) return res.status(400).json({ error: "No tenant" });
      const usersList = await storage.getUsersByTenant(req.tenantId);
      const safe = usersList.map(({ password: _, ...u }) => u);
      res.json(safe);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/admin/users/:id/role", ...adminMiddleware, async (req, res) => {
    try {
      const { role } = req.body;
      if (!role) return res.status(400).json({ error: "Role is required" });
      const validRoles = ["student", "doctoral_candidate", "chair", "committee_member", "program_admin", "security_admin", "super_admin"];
      if (!validRoles.includes(role)) return res.status(400).json({ error: "Invalid role" });

      const targetId = String(req.params.id);
      const targetUser = await storage.getUser(targetId);
      if (!targetUser) return res.status(404).json({ error: "User not found" });
      if (!canChangeRole(req.user!, targetUser, role)) return res.status(403).json({ error: "Forbidden" });

      const updated = await storage.updateUser(targetId, { role } as any);

      await storage.createAuditLog({
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: "user_role_changed",
        resourceType: "user",
        resourceId: targetId,
        details: { oldRole: targetUser.role, newRole: role },
        ipAddress: getIp(req),
      });

      if (updated) {
        const { password: _, ...safe } = updated;
        res.json(safe);
      } else {
        res.status(404).json({ error: "User not found" });
      }
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/admin/audit-logs", ...adminMiddleware, async (req, res) => {
    try {
      if (!req.tenantId) return res.status(400).json({ error: "No tenant" });
      const logs = await storage.getAuditLogsByTenant(req.tenantId);
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/admin/stats", ...adminMiddleware, async (req, res) => {
    try {
      if (!req.tenantId) return res.status(400).json({ error: "No tenant" });
      const usersList = await storage.getUsersByTenant(req.tenantId);
      const docs = await storage.getDocumentsByTenant(req.tenantId);
      let analysisCount = 0;
      for (const doc of docs) {
        const results = await storage.getResultsByDocument(doc.id);
        analysisCount += results.length;
      }
      res.json({
        userCount: usersList.length,
        documentCount: docs.length,
        analysisCount,
      });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Credit & Stripe Routes ─────────────────────────────────────
  app.get("/api/credits/balance", authMiddleware, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      res.json({ credits: user?.reviewCredits ?? 0 });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/credits/transactions", authMiddleware, async (req, res) => {
    try {
      const transactions = await storage.getCreditTransactions(req.user!.id);
      res.json(transactions);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Only allow-listed, catalog-matching prices are offered.
  app.get("/api/stripe/products", async (_req, res) => {
    try {
      const config = loadBillingConfig();
      if (!config) return res.json([]);
      const priceIds = config.prices.map((p) => p.priceId);
      const result = await db.execute(sql`
        SELECT p.id as product_id, p.name as product_name, p.description as product_description, p.active as product_active,
               p.metadata as product_metadata, pr.id as price_id, pr.unit_amount, pr.currency, pr.type, pr.active as price_active, pr.livemode
        FROM stripe.products p
        JOIN stripe.prices pr ON pr.product = p.id
        WHERE pr.id IN (${sql.join(priceIds.map((id) => sql`${id}`), sql`, `)})
        ORDER BY pr.unit_amount ASC`);
      const products: any[] = [];
      for (const r of result.rows as any[]) {
        const credits = creditsForCatalogPrice(
          { id: r.price_id, active: r.price_active, type: r.type, unit_amount: r.unit_amount, currency: r.currency, product: r.product_id, livemode: r.livemode },
          { id: r.product_id, active: r.product_active, metadata: r.product_metadata ?? {} }, config);
        if (credits === null) continue;
        products.push({ id: r.product_id, name: r.product_name, description: r.product_description, metadata: r.product_metadata,
          prices: [{ id: r.price_id, unitAmount: r.unit_amount, currency: r.currency }] });
      }
      res.json(products);
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/stripe/publishable-key", async (_req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/stripe/checkout", authMiddleware, async (req, res) => {
    try {
      const { priceId, productId } = req.body;
      if (typeof priceId !== "string" || typeof productId !== "string" || !priceId || !productId) {
        return res.status(400).json({ error: "priceId and productId are required" });
      }
      const allowed = loadBillingConfig()?.prices.find((p) => p.priceId === priceId && p.productId === productId);
      if (!allowed) return res.status(400).json({ error: "Invalid credit package" });

      const { stripe, config } = await getVerifiedStripe();
      const user = req.user!;
      const price = await stripe.prices.retrieve(priceId);
      const product = await stripe.products.retrieve(productId);
      const productOfPrice = typeof price.product === "string" ? price.product : price.product.id;
      const credits = creditsForCatalogPrice({ ...price, product: productOfPrice }, product, config);
      if (credits === null) return res.status(400).json({ error: "Invalid credit package" });

      const configuredOrigin = process.env.APP_BASE_URL;
      if (!configuredOrigin) return res.status(503).json({ error: "Payment configuration unavailable" });
      const origin = new URL(configuredOrigin);
      if (origin.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) return res.status(503).json({ error: "Invalid payment configuration" });
      const baseUrl = origin.origin;

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email, name: user.fullName, metadata: { userId: user.id, tenantId: String(user.tenantId) },
        }, { idempotencyKey: `ravpaper-customer-${user.id}` });
        customerId = customer.id;
        await storage.updateUser(user.id, { stripeCustomerId: customerId } as any);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "payment",
        success_url: `${baseUrl}/pricing?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/pricing?canceled=true`,
        metadata: { userId: user.id, tenantId: String(user.tenantId), credits: String(credits), productId, priceId },
      });
      res.json({ url: session.url });
    } catch (e) {
      if (e instanceof BillingUnavailableError) return res.status(503).json({ error: "Payments are temporarily unavailable" });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Post-redirect fallback; the signed webhook is the authoritative fulfillment path.
  app.post("/api/stripe/verify-session", authMiddleware, async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (typeof sessionId !== "string" || !/^cs_(test|live)_[A-Za-z0-9]{1,250}$/.test(sessionId)) return res.status(400).json({ error: "sessionId required" });
      const { stripe, config } = await getVerifiedStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.metadata?.userId !== req.user!.id) return res.status(403).json({ error: "Forbidden" });
      const result = await fulfillCheckoutSession(stripe, session, config, "client");
      if (result.status === "not_paid") return res.json({ success: false, message: "Payment not completed" });
      if (result.status === "rejected") return res.status(result.reason === "ownership" ? 403 : 409).json({ error: "Payment requires reconciliation" });
      res.json({ success: true, credits: result.balance, alreadyProcessed: result.status === "already_fulfilled" });
    } catch (e) {
      if (e instanceof BillingUnavailableError) return res.status(503).json({ error: "Payments are temporarily unavailable" });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return httpServer;
}
