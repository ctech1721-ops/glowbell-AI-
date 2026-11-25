// Browser-side client for the Global AI API (replaces the old Supabase client).
// The login token is kept in localStorage; every request sends it as a Bearer token.

const TOKEN_KEY = "global-ai-auth-token";

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked — login lasts until reload */ }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** JSON request. Throws ApiError with the server's message on failure. */
export async function api(path, { method = "GET", body, signal, keepalive } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(path, {
      method, headers, signal, keepalive,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token && !/\/api\/auth\/(login|signup)/.test(path)) setToken("");
    throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
  }
  return data;
}

/** Raw bytes request (SMS file parts). */
export async function apiBytes(path, { method = "GET", body } = {}) {
  const token = getToken();
  const response = await fetch(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/octet-stream" } : {}) },
    body,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
  }
  return method === "GET" ? response.blob() : response.json().catch(() => ({}));
}

export const auth = {
  /** Returns the signed-in user, or null when there is no valid session. */
  async restore() {
    if (!getToken()) return null;
    try {
      return (await api("/api/auth/me")).user;
    } catch (error) {
      if (error.status === 401) setToken("");
      return null;
    }
  },
  async signUp({ email, password, name }) {
    const data = await api("/api/auth/signup", { method: "POST", body: { email, password, name } });
    setToken(data.token);
    return data.user;
  },
  async signIn({ email, password }) {
    const data = await api("/api/auth/login", { method: "POST", body: { email, password } });
    setToken(data.token);
    return data.user;
  },
  signOut() { setToken(""); },
  forgotPassword(email) { return api("/api/auth/forgot", { method: "POST", body: { email } }); },
  resetPassword(token, password) { return api("/api/auth/reset", { method: "POST", body: { token, password } }); },
};
