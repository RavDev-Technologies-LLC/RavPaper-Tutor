import express, { type Express, type Request, type Response } from "express";
import { storage } from "./storage";
import {
  authMiddleware, clearRefreshCookie, generateAccessToken, hashPassword, readCookie,
  REFRESH_COOKIE, requireCsrfHeader, setRefreshCookie, verifyCredentials,
} from "./auth";
import { createSession, revokeAllSessionsForUser, revokeSession, rotateRefreshToken, sessionIdForToken } from "./sessions";
import { createAuthRateLimiters, type AuthRateLimits } from "./rate-limit";
import { firstIssue, loginSchema, registerSchema } from "./validation";
import type { User } from "@shared/schema";

export function getIp(req: Request): string | null {
  return req.ip ?? null;
}

const safeUser = ({ password: _, ...u }: User) => u;

async function startSession(req: Request, res: Response, user: User) {
  const issued = await createSession(user.id, { userAgent: req.get("user-agent"), ip: getIp(req) });
  setRefreshCookie(res, issued.refreshToken, issued.expiresAt);
  return { user: safeUser(user), accessToken: generateAccessToken(user, issued.sessionId) };
}

export function registerAuthRoutes(app: Express, limits?: AuthRateLimits) {
  const limiter = createAuthRateLimiters(limits);
  // Auth payloads are tiny; parse them with a strict limit before the global 50 MB parser.
  app.use("/api/auth", express.json({ limit: "16kb" }));

  app.post("/api/auth/register", limiter.register, async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
      const { username, email, password, fullName } = parsed.data;

      if (await storage.getUserByEmail(email)) return res.status(409).json({ error: "Email already in use" });
      if (await storage.getUserByUsername(username)) return res.status(409).json({ error: "Username already taken" });

      let user: User;
      try {
        user = await storage.registerUser({ username, email, passwordHash: await hashPassword(password), fullName });
      } catch (e: any) {
        if (e?.code === "23505") return res.status(409).json({ error: "Account already exists" });
        throw e;
      }

      await storage.createAuditLog({
        tenantId: user.tenantId, userId: user.id, action: "user_registered", resourceType: "user",
        resourceId: user.id, details: { role: user.role }, ipAddress: getIp(req),
      });
      res.status(201).json(await startSession(req, res, user));
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/auth/login", limiter.loginIp, limiter.loginAccount, async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Email and password required" });
      const { email, password } = parsed.data;

      const user = await storage.getUserByEmail(email);
      const valid = await verifyCredentials(password, user);
      if (!valid || !user) {
        if (user) {
          await storage.createAuditLog({
            tenantId: user.tenantId, userId: user.id, action: "user_login_failed", resourceType: "user",
            resourceId: user.id, details: { reason: "invalid_password" }, ipAddress: getIp(req),
          });
        }
        return res.status(401).json({ error: "Invalid credentials" });
      }
      // Status is only revealed after the password has been proven.
      if (!user.isActive) return res.status(403).json({ error: "Account disabled" });
      if (!(await storage.getTenant(user.tenantId))?.isActive) return res.status(403).json({ error: "Organization unavailable" });

      await storage.createAuditLog({
        tenantId: user.tenantId, userId: user.id, action: "user_login", resourceType: "user",
        resourceId: user.id, ipAddress: getIp(req),
      });
      res.json(await startSession(req, res, user));
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/auth/refresh", limiter.refresh, requireCsrfHeader, async (req, res) => {
    try {
      const presented = readCookie(req, REFRESH_COOKIE);
      if (!presented) return res.status(401).json({ error: "No session" });

      const result = await rotateRefreshToken(presented);
      if (result.status === "concurrent") return res.status(409).json({ error: "Refresh in progress", retryable: true });
      if (result.status === "reuse") {
        clearRefreshCookie(res);
        const user = await storage.getUser(result.userId);
        if (user) {
          await storage.createAuditLog({
            tenantId: user.tenantId, userId: user.id, action: "refresh_token_reuse_detected", resourceType: "session",
            resourceId: result.sessionId, details: { action: "session_revoked" }, ipAddress: getIp(req),
          });
        }
        return res.status(401).json({ error: "Session revoked" });
      }
      if (result.status !== "ok") {
        clearRefreshCookie(res);
        return res.status(401).json({ error: "Invalid session" });
      }

      const user = await storage.getUser(result.userId);
      const tenant = user ? await storage.getTenant(user.tenantId) : undefined;
      if (!user || !user.isActive || !tenant?.isActive) {
        await revokeSession(result.issued.sessionId, "account_unavailable");
        clearRefreshCookie(res);
        return res.status(401).json({ error: "Unauthorized" });
      }
      setRefreshCookie(res, result.issued.refreshToken, result.issued.expiresAt);
      res.json({ accessToken: generateAccessToken(user, result.issued.sessionId), user: safeUser(user) });
    } catch {
      res.status(401).json({ error: "Invalid session" });
    }
  });

  // Ends the current session server-side: its refresh tokens and access tokens stop working.
  app.post("/api/auth/logout", requireCsrfHeader, async (req, res) => {
    try {
      const presented = readCookie(req, REFRESH_COOKIE);
      const sessionId = presented ? await sessionIdForToken(presented) : undefined;
      const userId = sessionId ? await revokeSession(sessionId, "logout") : null;
      const user = userId ? await storage.getUser(userId) : undefined;
      if (user) {
        await storage.createAuditLog({
          tenantId: user.tenantId, userId: user.id, action: "user_logout", resourceType: "session",
          resourceId: sessionId!, ipAddress: getIp(req),
        });
      }
      clearRefreshCookie(res);
      res.status(204).send();
    } catch {
      clearRefreshCookie(res);
      res.status(204).send();
    }
  });

  // Ends every session for the signed-in user (e.g. "sign out everywhere").
  app.post("/api/auth/logout-all", authMiddleware, async (req, res) => {
    try {
      const count = await revokeAllSessionsForUser(req.user!.id, "logout_all");
      await storage.createAuditLog({
        tenantId: req.user!.tenantId, userId: req.user!.id, action: "sessions_revoked_all", resourceType: "session",
        resourceId: req.user!.id, details: { count }, ipAddress: getIp(req),
      });
      clearRefreshCookie(res);
      res.status(204).send();
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/auth/me", authMiddleware, async (req, res) => {
    res.json(safeUser(req.user!));
  });
}
