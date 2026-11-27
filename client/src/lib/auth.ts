import type { QueryFunctionContext } from "@tanstack/react-query";

// The access token lives only in memory. The refresh token is an httpOnly, SameSite=Strict
// cookie scoped to /api/auth, so page scripts can never read it.
let accessToken: string | null = null;

// Tokens persisted by earlier releases are removed on load.
try {
  localStorage.removeItem("pt_access_token");
  localStorage.removeItem("pt_refresh_token");
} catch { /* storage unavailable */ }

const CSRF_HEADER = { "x-ravpaper-client": "web" };

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearTokens(): void {
  accessToken = null;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshOnce(): Promise<Response> {
  return fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", headers: CSRF_HEADER });
}

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function tryRefreshToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      let res = await refreshOnce();
      // 409: another tab rotated the token a moment ago; its new cookie is now in place.
      if (res.status === 409) {
        await new Promise((r) => setTimeout(r, 500));
        res = await refreshOnce();
      }
      if (!res.ok) { accessToken = null; return false; }
      const data = await res.json();
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  if (!accessToken) await tryRefreshToken();
  const headers = new Headers(options?.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let res = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (res.status === 401 && (await tryRefreshToken())) {
    headers.set("Authorization", `Bearer ${accessToken}`);
    res = await fetch(url, { ...options, headers, credentials: "same-origin" });
  }
  return res;
}

export async function logoutRequest(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: CSRF_HEADER });
  } finally {
    accessToken = null;
  }
}

export async function authQueryFn<T>({ queryKey }: QueryFunctionContext): Promise<T> {
  const url = queryKey[0] as string;
  const fullUrl = queryKey.length > 1 ? `${url}/${queryKey.slice(1).join("/")}` : url;
  const res = await authFetch(fullUrl);
  if (res.status === 401) return null as T;
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}
