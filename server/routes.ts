import type { Express } from "express";
import type { Server } from "http";
import { storage, InsufficientCreditsError, PaymentOwnershipError, AnalysisInProgressError } from "./storage";
import { ownsPayment, parseCreditAmount, validCatalogPrice } from "./billing-policy";
import {
  authMiddleware,
  requireRole,
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
} from "./auth";
import jwt from "jsonwebtoken";
import { ownsDocument, canReadRubric, canChangeRole, tokenHasPurpose } from "./security-policy";
import {
  runPlagiarismEngine,
  runRubricEngine,
  runStatisticsEngine,
  runLiteratureEngine,
  runAnthropomorphismEngine,
  runFormattingEngine,
  generateDefenseQuestions,
  evaluateDefenseAnswer,
  runScoringAggregator,
} from "./engines";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { sql } from "drizzle-orm";
import { db } from "./db";
import type { InsertAnnotation } from "@shared/schema";

const JWT_SECRET = process.env.SESSION_SECRET!;

function getIp(req: any): string | null {
  const ip = req.ip;
  if (!ip) return null;
  return typeof ip === "string" ? ip : ip[0] || null;
}

const ALL_ENGINES = [
  "plagiarism",
  "rubric_alignment",
  "statistics",
  "literature_review",
  "anthropomorphism",
  "formatting",
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Auth Routes ───────────────────────────────────────────────
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { username, email, password, fullName } = req.body;
      if (!username || !email || !password || !fullName) {
        return res.status(400).json({ error: "All fields are required" });
      }

      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) return res.status(409).json({ error: "Email already in use" });

      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) return res.status(409).json({ error: "Username already taken" });

      const slug = username.toLowerCase().replace(/[^a-z0-9]/g, "-");
      const tenant = await storage.createTenant({
        name: `${fullName}'s Organization`,
        slug: slug + "-org",
        plan: "free",
        isActive: true,
      });

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        tenantId: tenant.id,
        username,
        email,
        password: hashedPassword,
        fullName,
        role: "student",
        isActive: true,
      });

      await storage.createAuditLog({
        tenantId: tenant.id,
        userId: user.id,
        action: "user_registered",
        resourceType: "user",
        resourceId: user.id,
        details: { email, role: user.role },
        ipAddress: getIp(req),
      });

      const { password: _, ...safeUser } = user;
      res.status(201).json({
        user: safeUser,
        accessToken: generateAccessToken(user),
        refreshToken: generateRefreshToken(user),
      });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: "Email and password required" });

      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      if (!user.isActive) return res.status(403).json({ error: "Account disabled" });

      const valid = await comparePassword(password, user.password);
      if (!valid) return res.status(401).json({ error: "Invalid credentials" });

      await storage.createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        action: "user_login",
        resourceType: "user",
        resourceId: user.id,
        ipAddress: getIp(req),
      });

      const { password: _, ...safeUser } = user;
      res.json({
        user: safeUser,
        accessToken: generateAccessToken(user),
        refreshToken: generateRefreshToken(user),
      });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return res.status(400).json({ error: "Refresh token required" });

      const payload = jwt.verify(refreshToken, JWT_SECRET, { algorithms: ["HS256"] });
      if (!tokenHasPurpose(payload, "refresh")) return res.status(401).json({ error: "Invalid token type" });

      const user = await storage.getUser(payload.userId);
      if (!user || !user.isActive) return res.status(401).json({ error: "Unauthorized" });

      res.json({
        accessToken: generateAccessToken(user),
        refreshToken: generateRefreshToken(user),
      });
    } catch {
      res.status(401).json({ error: "Invalid refresh token" });
    }
  });

  app.get("/api/auth/me", authMiddleware, async (req, res) => {
    const { password: _, ...safeUser } = req.user!;
    res.json(safeUser);
  });

  // ─── Document Routes ───────────────────────────────────────────
  app.get("/api/documents", authMiddleware, async (req, res) => {
    try {
      const docs = await storage.getDocumentsByUser(req.user!.id);
      res.json(docs);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/documents", authMiddleware, async (req, res) => {
    try {
      const { title, submissionType, fileName, fileSize, fileContent } = req.body;
      if (!title || !submissionType || !fileName) {
        return res.status(400).json({ error: "Title, submissionType, and fileName are required" });
      }

      const doc = await storage.createDocument({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        title,
        submissionType,
        fileName,
        fileSize: fileSize || null,
        fileContent: fileContent || null,
        status: "pending",
        overallScore: null,
        metadata: null,
      });

      await storage.createAuditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: "document_uploaded",
        resourceType: "document",
        resourceId: String(doc.id),
        details: { title, fileName },
        ipAddress: getIp(req),
      });

      res.status(201).json(doc);
    } catch (e: any) {
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
      if (!ownsDocument(req.user!, doc)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await storage.deleteDocument(doc.id);

      await storage.createAuditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: "document_deleted",
        resourceType: "document",
        resourceId: String(doc.id),
        ipAddress: getIp(req),
      });

      res.status(204).send();
    } catch (e: any) {
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
  app.post("/api/analysis/run/:documentId", authMiddleware, async (req, res) => {
    let usageId: number | undefined;
    let currentResultId: number | undefined;
    let finalized = false;
    try {
      const documentId = Number(req.params.documentId);
      const doc = await storage.getDocument(documentId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (!ownsDocument(req.user!, doc)) return res.status(403).json({ error: "Forbidden" });
      if (!doc.fileContent) return res.status(400).json({ error: "Document has no content to analyze" });

      const currentUser = await storage.getUser(req.user!.id);
      if (!currentUser || currentUser.reviewCredits < 1) {
        return res.status(402).json({
          error: "Insufficient review credits",
          credits: currentUser?.reviewCredits ?? 0,
          message: "You need at least 1 review credit to run an analysis. Purchase credits from the Pricing page.",
        });
      }

      const { rubricId, engines } = req.body || {};
      if (engines !== undefined && (!Array.isArray(engines) || !engines.length || engines.length > ALL_ENGINES.length || engines.some((engine: unknown) => typeof engine !== "string" || !ALL_ENGINES.includes(engine)) || new Set(engines).size !== engines.length)) return res.status(400).json({ error: "Invalid analysis engine selection" });
      const engineList: string[] = engines ?? ALL_ENGINES;
      if (rubricId !== undefined && rubricId !== null) {
        if (!Number.isSafeInteger(rubricId) || rubricId < 1) return res.status(400).json({ error: "Invalid rubric" });
        const selectedRubric = await storage.getRubric(rubricId);
        if (!selectedRubric || !canReadRubric(req.user!, selectedRubric)) return res.status(403).json({ error: "Rubric unavailable" });
      }

      try { const debit = await storage.deductCredit(req.user!.id, documentId, `Analysis of "${doc.title}"`); usageId = debit.transaction.id; }
      catch (error) { if (error instanceof InsufficientCreditsError) return res.status(402).json({ error: "Insufficient review credits" }); if (error instanceof AnalysisInProgressError) return res.status(409).json({ error: "Document unavailable or already processing" }); throw error; }

      await storage.createAuditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: "analysis_started",
        resourceType: "document",
        resourceId: String(documentId),
        details: { engines: engineList },
        ipAddress: getIp(req),
      });

      let rubricCriteria: any[] = [];
      if (rubricId) {
        const rubric = await storage.getRubric(rubricId);
        if (rubric) rubricCriteria = rubric.criteria as any[];
      }

      const results: any[] = [];
      const content = doc.fileContent;

      for (const engine of engineList) {
        const record = await storage.createAnalysisResult({
          tenantId: req.user!.tenantId,
          documentId,
          engineType: engine,
          status: "processing",
          score: null,
          results: null,
          details: null,
        });

        currentResultId = record.id;
        let engineResult: any;
        try {
          switch (engine) {
            case "plagiarism":
              engineResult = await runPlagiarismEngine(content);
              break;
            case "rubric_alignment":
              engineResult = await runRubricEngine(content, rubricCriteria);
              break;
            case "statistics":
              engineResult = await runStatisticsEngine(content);
              break;
            case "literature_review":
              engineResult = await runLiteratureEngine(content);
              break;
            case "anthropomorphism":
              engineResult = await runAnthropomorphismEngine(content);
              break;
            case "formatting":
              engineResult = await runFormattingEngine(content);
              break;
            default:
              throw new Error("Unknown engine");
          }
        } catch {
          throw new Error("Analysis engine failed");
        }

        const updated = await storage.updateAnalysisResult(record.id, {
          status: "completed",
          score: engineResult.score,
          results: engineResult,
        });

        const findings = engineResult.findings || engineResult.criteriaScores || [];
        if (findings.length > 0) {
          const annotationBatch: InsertAnnotation[] = findings.slice(0, 50).map((f: any) => ({
            tenantId: req.user!.tenantId,
            documentId,
            analysisResultId: record.id,
            sentenceIndex: null,
            originalText: f.text || f.criterion || f.statistic || f.section || f.location || "",
            suggestion: f.suggestion || f.feedback || f.correction || null,
            severity: (f.severity === "critical" || f.severity === "warning" || f.severity === "info")
              ? f.severity
              : "info",
            engineType: engine,
            category: f.category || null,
          }));
          await storage.createManyAnnotations(annotationBatch);
        }

        if (!updated) throw new Error("Analysis result unavailable");
        results.push(updated);
        currentResultId = undefined;
      }

      const aggregated = runScoringAggregator(
        results.map((r) => ({ engineType: r!.engineType, score: r!.score }))
      );
      await storage.updateDocument(documentId, {
        status: "completed",
        overallScore: aggregated.overallScore,
        metadata: aggregated,
      } as any);

      finalized = true;
      await storage.createAuditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: "analysis_completed",
        resourceType: "document",
        resourceId: String(documentId),
        details: { overallScore: aggregated.overallScore, engines: engineList },
        ipAddress: getIp(req),
      });

      res.json({ results, aggregated });
    } catch (e: any) {
      if (usageId !== undefined && !finalized) {
        try { await storage.refundFailedAnalysis(req.user!.id, usageId, currentResultId); }
        catch { console.error(JSON.stringify({ event: "analysis_refund_failed", usageId })); return res.status(503).json({ error: "Analysis failed; credit reconciliation required" }); }
        return res.status(502).json({ error: "Analysis failed; review credit restored" });
      }
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

      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) return res.status(404).json({ error: "User not found" });
      if (!canChangeRole(req.user!, targetUser, role)) return res.status(403).json({ error: "Forbidden" });

      const updated = await storage.updateUser(req.params.id, { role } as any);

      await storage.createAuditLog({
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: "user_role_changed",
        resourceType: "user",
        resourceId: req.params.id,
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

  app.get("/api/stripe/products", async (_req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.active as product_active,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency
        FROM stripe.products p
        JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY pr.unit_amount ASC
      `);

      const productsMap = new Map<string, any>();
      for (const row of result.rows) {
        const r = row as any;
        if (!productsMap.has(r.product_id)) {
          productsMap.set(r.product_id, {
            id: r.product_id,
            name: r.product_name,
            description: r.product_description,
            metadata: r.product_metadata,
            prices: [],
          });
        }
        if (r.price_id) {
          productsMap.get(r.product_id).prices.push({
            id: r.price_id,
            unitAmount: r.unit_amount,
            currency: r.currency,
          });
        }
      }

      res.json(Array.from(productsMap.values()));
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/stripe/publishable-key", async (_req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/stripe/checkout", authMiddleware, async (req, res) => {
    try {
      const { priceId, productId } = req.body;
      if (typeof priceId !== "string" || typeof productId !== "string" || !priceId || !productId) {
        return res.status(400).json({ error: "priceId and productId are required" });
      }

      const stripe = await getUncachableStripeClient();
      const user = req.user!;
      const price = await stripe.prices.retrieve(priceId);
      const product = await stripe.products.retrieve(productId);
      const productOfPrice = typeof price.product === "string" ? price.product : price.product.id;
      if (!validCatalogPrice({ ...price, product: productOfPrice }, product)) return res.status(400).json({ error: "Invalid credit package" });
      if (price.livemode && process.env.STRIPE_LIVE_CHARGING_ENABLED !== "true") return res.status(503).json({ error: "Live payments disabled" });
      const credits = parseCreditAmount(product.metadata.credits)!;
      const configuredOrigin = process.env.APP_BASE_URL;
      if (!configuredOrigin) return res.status(503).json({ error: "Payment configuration unavailable" });
      const origin = new URL(configuredOrigin);
      if (origin.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) return res.status(503).json({ error: "Invalid payment configuration" });
      const baseUrl = origin.origin;

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.fullName,
          metadata: { userId: user.id, tenantId: String(user.tenantId) },
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
        metadata: {
          userId: user.id,
          tenantId: String(user.tenantId),
          credits: String(credits),
          productId,
          priceId,
        },
      });

      res.json({ url: session.url });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/stripe/verify-session", authMiddleware, async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (typeof sessionId !== "string" || !sessionId || sessionId.length > 256) return res.status(400).json({ error: "sessionId required" });

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const customer = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
      if (!ownsPayment(req.user!, { customer, metadata: session.metadata })) return res.status(403).json({ error: "Forbidden" });
      if (session.mode !== "payment" || session.status !== "complete" || session.payment_status !== "paid" || !session.amount_total || session.currency !== "usd") {
        return res.json({ success: false, message: "Payment not completed" });
      }

      const existingTx = await storage.getCreditTransactions(req.user!.id);
      const alreadyProcessed = existingTx.some(tx => tx.stripeSessionId === sessionId);
      if (alreadyProcessed) {
        const user = await storage.getUser(req.user!.id);
        return res.json({ success: true, credits: user?.reviewCredits ?? 0, alreadyProcessed: true });
      }

      const credits = parseCreditAmount(session.metadata?.credits);
      if (credits === null || !session.metadata?.priceId || !session.metadata?.productId) return res.status(409).json({ error: "Payment requires reconciliation" });
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 2 });
      const item = lineItems.data[0];
      if (lineItems.has_more || lineItems.data.length !== 1 || !item || !item.price || item.quantity !== 1 || item.price.id !== session.metadata.priceId || (typeof item.price.product === "string" ? item.price.product : item.price.product?.id) !== session.metadata.productId || item.amount_total !== session.amount_total) return res.status(409).json({ error: "Payment requires reconciliation" });
      const { user: updatedUser } = await storage.addCredits(
        req.user!.id,
        credits,
        `Purchased ${credits} review credit${credits > 1 ? "s" : ""}`,
        sessionId
      );

      await storage.createAuditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: "credits_purchased",
        resourceType: "credits",
        resourceId: sessionId,
        details: { credits, sessionId },
        ipAddress: getIp(req),
      });

      res.json({ success: true, credits: updatedUser.reviewCredits });
    } catch (e: any) {
      if (e instanceof PaymentOwnershipError) return res.status(403).json({ error: "Forbidden" });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return httpServer;
}
