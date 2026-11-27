import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction, CookieOptions } from "express";
import { storage } from "./storage";
import type { User } from "@shared/schema";
import { tokenHasPurpose } from "./security-policy";
import { jwtSecret, isProduction } from "./config";
import { getActiveSession } from "./sessions";

const ACCESS_TOKEN_EXPIRY = "15m";
export const JWT_ISSUER = "ravpaper-tutor";
export const JWT_AUDIENCE = "ravpaper-api";
export const REFRESH_COOKIE = "rp_rt";
const REFRESH_COOKIE_PATH = "/api/auth";
/** Cookie-authenticated endpoints require this header; cross-site forms cannot set it. */
export const CSRF_HEADER = "x-ravpaper-client";

const BCRYPT_COST = 12;
// Used to equalise login timing when the account does not exist.
const DUMMY_HASH = bcrypt.hashSync("ravpaper-timing-equaliser", BCRYPT_COST);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Constant-work comparison whether or not the user exists. */
export async function verifyCredentials(password: string, user: User | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  return !!user && ok;
}

export function generateAccessToken(user: User, sessionId: string): string {
  return jwt.sign(
    { userId: user.id, type: "access", sid: sessionId, tenantId: user.tenantId, role: user.role },
    jwtSecret(),
    { expiresIn: ACCESS_TOKEN_EXPIRY, algorithm: "HS256", issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
  );
}

export function refreshCookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction() || process.env.COOKIE_SECURE === "true",
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    ...(expires ? { expires } : {}),
  };
}

export function setRefreshCookie(res: Response, token: string, expires: Date) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(expires));
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  if (req.get(CSRF_HEADER) !== "web") return res.status(403).json({ error: "Missing client header" });
  next();
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      tenantId?: number;
      sessionId?: string;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(header.slice(7), jwtSecret(), { algorithms: ["HS256"], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    if (!tokenHasPurpose(payload, "access")) return res.status(401).json({ error: "Invalid access token" });
    const session = await getActiveSession(payload.sid);
    if (!session || session.userId !== payload.userId) return res.status(401).json({ error: "Session ended" });
    const user = await storage.getUser(payload.userId);
    if (!user || !user.isActive) return res.status(401).json({ error: "Unauthorized" });
    if (!(await storage.getTenant(user.tenantId))?.isActive) return res.status(403).json({ error: "Tenant unavailable" });
    req.user = user;
    req.tenantId = user.tenantId;
    req.sessionId = session.id;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
