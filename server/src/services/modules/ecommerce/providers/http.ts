import type { ConnectionResult, ProviderRuntime } from './registry';

const TIMEOUT_MS = 10000;

/**
 * Performs a fetch and lets `read` consume the response, all bounded by one timeout
 * (the timer stays alive until `read` settles, so stalled bodies are aborted too).
 * Resolves to null on any failure or timeout; never exposes the error (it may contain the URL).
 */
export async function timedFetch<T>(
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>
): Promise<T | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const aborted = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, TIMEOUT_MS);
  });
  aborted.catch(() => undefined);
  try {
    return await Promise.race([
      (async () => read(await fetch(url, { ...init, signal: controller.signal })))(),
      aborted,
    ]);
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
  const secret = rt.secrets[key];
  if (typeof secret === 'string') return secret;
  const v = rt.config[key];
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}

/**
 * GETs `url` with a bearer token: 200 → ok, `invalidStatuses` → INVALID_CREDENTIALS. `classify` runs
 * first and may read the body; returning null falls through to the default mapping.
 */
export async function bearerCheck(
  url: string,
  token: string,
  invalidStatuses: number[],
  classify?: (res: Response) => Promise<ConnectionResult | null>
): Promise<ConnectionResult> {
  const result = await timedFetch<ConnectionResult>(
    url,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    async (res) => {
      const special = classify ? await classify(res) : null;
      if (special) return special;
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 200) return { ok: true };
      if (invalidStatuses.includes(res.status)) return INVALID_CREDENTIALS;
      return { ok: false, code: 'UNREACHABLE', message: `Unexpected response (HTTP ${res.status}).` };
    }
  );
  return result ?? UNREACHABLE;
}
