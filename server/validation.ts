import { z } from "zod";

// bcrypt only uses the first 72 bytes; reject longer passwords instead of silently truncating.
const password = z.string().min(12, "Password must be at least 12 characters")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Password must be at most 72 bytes");

export const registerSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/, "Username may contain letters, numbers, dot, dash and underscore"),
  email: z.string().trim().toLowerCase().email().max(254),
  password,
  fullName: z.string().trim().min(1).max(120),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(1024),
});

export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid request";
}
