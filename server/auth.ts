import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import type { User } from "@shared/schema";
import { tokenHasPurpose } from "./security-policy";

const JWT_SECRET = process.env.SESSION_SECRET!;
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateAccessToken(user: User): string {
  return jwt.sign(
    { userId: user.id, type: "access", tenantId: user.tenantId, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

export function generateRefreshToken(user: User): string {
  return jwt.sign(
    { userId: user.id, type: "refresh" },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      tenantId?: number;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ["HS256"] });
    if (!tokenHasPurpose(payload, "access")) return res.status(401).json({ error: "Invalid access token" });
    const user = await storage.getUser(payload.userId);
    if (!user || !user.isActive) return res.status(401).json({ error: "Unauthorized" });
    if (user.tenantId === null || !(await storage.getTenant(user.tenantId))?.isActive) return res.status(403).json({ error: "Tenant unavailable" });
    req.user = user;
    req.tenantId = user.tenantId ?? undefined;
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
