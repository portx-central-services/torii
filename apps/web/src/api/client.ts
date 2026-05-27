export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    if (code !== undefined) this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  /** Called whenever the API returns 401. */
  onUnauthorized?: () => void;
}

const defaults: Required<Omit<ApiClientOptions, 'onUnauthorized'>> & ApiClientOptions = {
  baseUrl: '',
};

let onUnauthorized: (() => void) | undefined;

export function configureApiClient(opts: ApiClientOptions): void {
  if (opts.baseUrl !== undefined) defaults.baseUrl = opts.baseUrl;
  if (opts.onUnauthorized !== undefined) onUnauthorized = opts.onUnauthorized;
}

async function request<T>(
  method: string,
  path: string,
  init: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const url = new URL(defaults.baseUrl + path, window.location.origin);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method,
    credentials: 'include',
    headers: init.body
      ? { 'Content-Type': 'application/json', Accept: 'application/json' }
      : { Accept: 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 401) {
    onUnauthorized?.();
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const body = parsed as { error?: string; code?: string; details?: unknown } | null;
    throw new ApiError(
      res.status,
      body?.error ?? `Request failed: HTTP ${res.status}`,
      body?.code,
      body?.details,
    );
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, string | number | undefined>) =>
    request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
