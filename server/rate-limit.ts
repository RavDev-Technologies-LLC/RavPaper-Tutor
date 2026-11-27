import { rateLimit, ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";

// Brute-force and abuse protection for authentication endpoints.
// The default store is in-process memory, which is correct for a single instance.
// If the app is scaled to multiple instances, plug a shared store (e.g. Redis or
// PostgreSQL) into `store` so limits are enforced globally.

export type AuthRateLimits = {
  windowMs: number;
  loginPerIp: number;
  loginFailuresPerAccount: number;
  registerPerIp: number;
  refreshPerIp: number;
};

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  windowMs: 15 * 60 * 1000,
  loginPerIp: 20,              // all login attempts from one IP per window
  loginFailuresPerAccount: 5,  // failed attempts against one account per window, from any IP
  registerPerIp: 5,
  refreshPerIp: 60,
};

const base: Partial<Options> = {
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json({ error: "Too many requests. Please wait and try again." });
  },
};

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

function accountKey(req: Request): string {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "";
  return email ? `acct:${email}` : `ip:${ipKey(req)}`;
}

export function createAuthRateLimiters(limits: AuthRateLimits = DEFAULT_AUTH_RATE_LIMITS) {
  return {
    loginIp: rateLimit({ ...base, windowMs: limits.windowMs, limit: limits.loginPerIp, keyGenerator: ipKey, identifier: "login-ip" }),
    // Only failures count, so a legitimate user who logs in successfully is never locked out by it.
    loginAccount: rateLimit({ ...base, windowMs: limits.windowMs, limit: limits.loginFailuresPerAccount, keyGenerator: accountKey, skipSuccessfulRequests: true, identifier: "login-account" }),
    register: rateLimit({ ...base, windowMs: 60 * 60 * 1000, limit: limits.registerPerIp, keyGenerator: ipKey, identifier: "register-ip" }),
    refresh: rateLimit({ ...base, windowMs: limits.windowMs, limit: limits.refreshPerIp, keyGenerator: ipKey, identifier: "refresh-ip" }),
  };
}
