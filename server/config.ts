// Centralised, validated runtime configuration. Fails fast on unsafe settings.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export function jwtSecret(): string {
  const secret = required("SESSION_SECRET");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return secret;
}

export const isProduction = () => process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1";

/** Number of reverse-proxy hops to trust for req.ip (Replit deployments sit behind one proxy). */
export function trustProxySetting(): number | string | boolean {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === "") return isProduction() ? 1 : "loopback";
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : raw;
}

/** Validate configuration that must be correct before serving traffic. */
export function assertStartupConfig(): void {
  jwtSecret();
  required("DATABASE_URL");
}
