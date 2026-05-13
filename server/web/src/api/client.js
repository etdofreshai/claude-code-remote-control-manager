// Bearer-token HTTP client. The token is set on successful /api/login and
// stored in localStorage; every authenticated request appends it. A 401
// clears the token and reloads the page so the SPA falls back to <Login />.

const TOKEN_KEY = 'ccrcm_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(value) {
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

export function hasToken() {
  return !!getToken();
}

export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

export async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = new Headers(opts.headers || {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof ArrayBuffer)) {
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }
  const res = await fetch(path, { ...opts, body, headers });
  if (res.status === 401) {
    clearToken();
    location.reload();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export async function login(password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Wrong password');
  }
  const { token } = await res.json();
  setToken(token);
  return token;
}

export async function logout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  clearToken();
  location.reload();
}
