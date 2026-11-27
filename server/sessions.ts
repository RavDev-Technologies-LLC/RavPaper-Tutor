import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { authSessions, refreshTokens, type AuthSession } from "@shared/schema";

// Server-side sessions with rotating, revocable refresh tokens.
//  - Refresh tokens are opaque random values; only their SHA-256 hash is stored.
//  - Every refresh rotates the token. Presenting an already-rotated token outside a
//    short concurrency grace window is treated as theft and revokes the whole session.
//  - Access tokens carry the session id, so revoking a session cuts off access immediately.

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Two tabs refreshing at once both present the same token; tolerate that briefly. */
export const ROTATION_GRACE_MS = 10_000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

export type IssuedRefresh = { sessionId: string; refreshToken: string; expiresAt: Date };

export async function createSession(userId: string, meta: { userAgent?: string | null; ip?: string | null }): Promise<IssuedRefresh> {
  const now = Date.now();
  return db.transaction(async (tx) => {
    const [session] = await tx.insert(authSessions).values({
      userId,
      expiresAt: new Date(now + SESSION_MAX_AGE_MS),
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ipAddress: meta.ip ?? null,
    }).returning();
    const refreshToken = newToken();
    const expiresAt = new Date(Math.min(now + REFRESH_TOKEN_TTL_MS, session.expiresAt.getTime()));
    await tx.insert(refreshTokens).values({ sessionId: session.id, tokenHash: hashToken(refreshToken), expiresAt });
    return { sessionId: session.id, refreshToken, expiresAt };
  });
}

export type RotateResult =
  | { status: "ok"; userId: string; issued: IssuedRefresh }
  | { status: "invalid" }
  | { status: "concurrent" }
  | { status: "reuse"; userId: string; sessionId: string };

export async function rotateRefreshToken(presented: string): Promise<RotateResult> {
  if (typeof presented !== "string" || presented.length < 20 || presented.length > 200) return { status: "invalid" };
  const tokenHash = hashToken(presented);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ token: refreshTokens, session: authSessions })
      .from(refreshTokens)
      .innerJoin(authSessions, eq(authSessions.id, refreshTokens.sessionId))
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .for("update");
    if (!row) return { status: "invalid" } as const;
    const { token, session } = row;
    const now = Date.now();
    if (session.revokedAt) return { status: "invalid" } as const;

    if (token.rotatedAt) {
      if (now - token.rotatedAt.getTime() < ROTATION_GRACE_MS) return { status: "concurrent" } as const;
      await tx.update(authSessions).set({ revokedAt: new Date(), revokeReason: "refresh_token_reuse" }).where(eq(authSessions.id, session.id));
      return { status: "reuse", userId: session.userId, sessionId: session.id } as const;
    }
    if (token.expiresAt.getTime() <= now || session.expiresAt.getTime() <= now) {
      await tx.update(authSessions).set({ revokedAt: new Date(), revokeReason: "expired" }).where(and(eq(authSessions.id, session.id), isNull(authSessions.revokedAt)));
      return { status: "invalid" } as const;
    }

    await tx.update(refreshTokens).set({ rotatedAt: new Date() }).where(eq(refreshTokens.id, token.id));
    const refreshToken = newToken();
    const expiresAt = new Date(Math.min(now + REFRESH_TOKEN_TTL_MS, session.expiresAt.getTime()));
    await tx.insert(refreshTokens).values({ sessionId: session.id, tokenHash: hashToken(refreshToken), expiresAt });
    await tx.update(authSessions).set({ lastUsedAt: new Date() }).where(eq(authSessions.id, session.id));
    return { status: "ok", userId: session.userId, issued: { sessionId: session.id, refreshToken, expiresAt } } as const;
  });
}

export async function getActiveSession(sessionId: string): Promise<AuthSession | undefined> {
  const [session] = await db.select().from(authSessions)
    .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt), sql`${authSessions.expiresAt} > now()`));
  return session;
}

/** Find the session a refresh token belongs to (rotated or not). Used by logout. */
export async function sessionIdForToken(presented: string): Promise<string | undefined> {
  if (typeof presented !== "string" || presented.length > 200) return undefined;
  const [row] = await db.select({ sessionId: refreshTokens.sessionId }).from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(presented)));
  return row?.sessionId;
}

/** Revoke one session. Returns the owning user id if it was active, otherwise null. */
export async function revokeSession(sessionId: string, reason: string): Promise<string | null> {
  const rows = await db.update(authSessions).set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt))).returning({ userId: authSessions.userId });
  return rows[0]?.userId ?? null;
}

export async function revokeAllSessionsForUser(userId: string, reason: string): Promise<number> {
  const rows = await db.update(authSessions).set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt))).returning({ id: authSessions.id });
  return rows.length;
}
