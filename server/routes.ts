import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import {
  authMiddleware,
  requireRole,
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
} from "./auth";
import jwt from "jsonwebtoken";
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

      const allTenants = await storage.getAllTenants();
      const isFirstUser = allTenants.length === 0;

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
        role: isFirstUser ? "super_admin" : "student",
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) return res.status(400).json({ error: "Refresh token required" });

      const payload = jwt.verify(refreshToken, JWT_SECRET) as any;
      if (payload.type !== "refresh") return res.status(401).json({ error: "Invalid token type" });

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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/documents/:id", authMiddleware, async (req, res) => {
    try {
      const doc = await storage.getDocument(Number(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (doc.userId !== req.user!.id && req.user!.role === "student") {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(doc);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/documents/:id", authMiddleware, async (req, res) => {
    try {
      const doc = await storage.getDocument(Number(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (doc.userId !== req.user!.id && req.user!.role === "student") {
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
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/documents/:id/annotations", authMiddleware, async (req, res) => {
    try {
      const docId = Number(req.params.id);
      const doc = await storage.getDocument(docId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const anns = await storage.getAnnotationsByDocument(docId);
      res.json(anns);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Rubric Routes ─────────────────────────────────────────────
  app.get("/api/rubrics", authMiddleware, async (req, res) => {
    try {
      const tenantRubrics = req.tenantId ? await storage.getRubricsByTenant(req.tenantId) : [];
      const templates = await storage.getRubricTemplates();
      const combined = [...tenantRubrics];
      for (const t of templates) {
        if (!combined.find((r) => r.id === t.id)) combined.push(t);
      }
      res.json(combined);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/rubrics", authMiddleware, async (req, res) => {
    try {
      const { name, submissionType, criteria, isTemplate } = req.body;
      if (!name || !criteria) return res.status(400).json({ error: "Name and criteria required" });

      const rubric = await storage.createRubric({
        tenantId: req.user!.tenantId,
        name,
        submissionType: submissionType || null,
        criteria,
        isTemplate: isTemplate || false,
        createdBy: req.user!.id,
      });

      res.status(201).json(rubric);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/rubrics/:id", authMiddleware, async (req, res) => {
    try {
      const rubric = await storage.getRubric(Number(req.params.id));
      if (!rubric) return res.status(404).json({ error: "Rubric not found" });
      res.json(rubric);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Analysis Routes ───────────────────────────────────────────
  app.post("/api/analysis/run/:documentId", authMiddleware, async (req, res) => {
    try {
      const documentId = Number(req.params.documentId);
      const doc = await storage.getDocument(documentId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (!doc.fileContent) return res.status(400).json({ error: "Document has no content to analyze" });

      const { rubricId, engines } = req.body || {};
      const engineList: string[] = engines && engines.length > 0 ? engines : ALL_ENGINES;

      await storage.updateDocument(documentId, { status: "processing" } as any);

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
              engineResult = { score: 0, findings: [], summary: "Unknown engine" };
          }
        } catch (err: any) {
          engineResult = { score: 0, findings: [], summary: `Error: ${err.message}` };
        }

        const updated = await storage.updateAnalysisResult(record.id, {
          status: "completed",
          score: engineResult.score || 0,
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

        results.push(updated);
      }

      const aggregated = runScoringAggregator(
        results.map((r) => ({ engineType: r!.engineType, score: r!.score }))
      );
      await storage.updateDocument(documentId, {
        status: "completed",
        overallScore: aggregated.overallScore,
        metadata: aggregated,
      } as any);

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
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/analysis/results/:documentId", authMiddleware, async (req, res) => {
    try {
      const documentId = Number(req.params.documentId);
      const results = await storage.getResultsByDocument(documentId);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/analysis/defense/:documentId", authMiddleware, async (req, res) => {
    try {
      const documentId = Number(req.params.documentId);
      const doc = await storage.getDocument(documentId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
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
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/analysis/defense/:sessionId/answer", authMiddleware, async (req, res) => {
    try {
      const sessionId = Number(req.params.sessionId);
      const { questionIndex, answer } = req.body;
      if (questionIndex === undefined || !answer) {
        return res.status(400).json({ error: "questionIndex and answer are required" });
      }

      const session = await storage.getDefenseSession(sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (session.userId !== req.user!.id) return res.status(403).json({ error: "Forbidden" });

      const questions = (session.questions as any[]) || [];
      if (questionIndex < 0 || questionIndex >= questions.length) {
        return res.status(400).json({ error: "Invalid question index" });
      }

      const doc = await storage.getDocument(session.documentId!);
      const docContent = doc?.fileContent || "";
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      if (targetUser.tenantId !== req.tenantId) return res.status(403).json({ error: "Forbidden" });

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
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/audit-logs", ...adminMiddleware, async (req, res) => {
    try {
      if (!req.tenantId) return res.status(400).json({ error: "No tenant" });
      const logs = await storage.getAuditLogsByTenant(req.tenantId);
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  return httpServer;
}
