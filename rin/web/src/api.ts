import { auth } from './auth';

const BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

async function request<T = any>(
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.detail || data?.title || `HTTP ${res.status}`;
    throw new Error(Array.isArray(data?.errors) ? data.errors.join(', ') : msg);
  }
  return data as T;
}

export const api = {
  base: BASE,

  // ── merchant (brand) ──
  merchantToken: (client_id: string, client_secret: string) =>
    request('POST', '/oauth/token', { body: { grant_type: 'client_credentials', client_id, client_secret } }),
  m: <T = any>(method: string, path: string, body?: unknown) =>
    request<T>(method, path, { token: auth.merchantToken(), body }),

  // ── consumer ──
  register: (email: string, password: string) => request('POST', '/v1/auth/register', { body: { email, password } }),
  login: (email: string, password: string) => request('POST', '/v1/auth/login', { body: { email, password } }),
  social: (provider: string, idToken: string) => request('POST', '/v1/auth/social', { body: { provider, idToken } }),
  c: <T = any>(method: string, path: string, body?: unknown) =>
    request<T>(method, path, { token: auth.consumerToken(), body }),

  raw: request,
};
