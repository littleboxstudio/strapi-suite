import type { ConnectionResult, ProviderRuntime } from './registry';

const TIMEOUT_MS = 10000;

/** Performs a fetch with a timeout. Resolves to null on any network failure; never exposes the error (it may contain the URL). */
export async function timedFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const UNREACHABLE: ConnectionResult = {
  ok: false,
  code: 'UNREACHABLE',
  message: 'Could not reach the provider.',
};

export const INVALID_CREDENTIALS: ConnectionResult = {
  ok: false,
  code: 'INVALID_CREDENTIALS',
  message: 'The provider rejected the credentials.',
};

export function missingFields(keys: string[]): ConnectionResult {
  return { ok: false, code: 'MISSING_FIELDS', message: `Missing fields: ${keys.join(', ')}` };
}

export function str(rt: ProviderRuntime, key: string): string {
  const v = rt.secrets[key] ?? rt.config[key];
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}

export async function bearerCheck(
  url: string,
  token: string,
  invalidStatuses: number[]
): Promise<ConnectionResult> {
  const res = await timedFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  if (!res) return UNREACHABLE;
  if (res.status === 200) return { ok: true };
  if (invalidStatuses.includes(res.status)) return INVALID_CREDENTIALS;
  return { ok: false, code: 'UNREACHABLE', message: `Unexpected response (HTTP ${res.status}).` };
}
