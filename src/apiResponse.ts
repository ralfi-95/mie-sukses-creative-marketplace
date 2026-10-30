export type ApiResponseErrorKind = 'http' | 'parse' | 'empty';

export class ApiResponseError extends Error {
  constructor(message: string, readonly status: number, readonly kind: ApiResponseErrorKind) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return undefined;
  for (const key of ['message', 'error']) {
    const message = value[key];
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return undefined;
}

function hasJsonContentType(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  return contentType === 'application/json' || contentType?.endsWith('+json') === true;
}

function statusFallback(message: string, status: number): string {
  return `${message} (HTTP ${status})`;
}

export async function parseApiResponse<T = unknown>(
  response: Response,
  fallbackMessage = 'Request failed',
): Promise<T | undefined> {
  if (response.status === 204 && response.ok) return undefined;

  const body = await response.text();
  if (!response.ok) {
    const fallback = statusFallback(fallbackMessage, response.status);
    if (!body.trim()) throw new ApiResponseError(fallback, response.status, 'http');

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      if (hasJsonContentType(response)) {
        throw new ApiResponseError(`Invalid JSON error response (HTTP ${response.status}).`, response.status, 'parse');
      }
      const isHtml = response.headers.get('content-type')?.toLowerCase().includes('text/html') === true;
      throw new ApiResponseError(isHtml ? fallback : body.trim(), response.status, 'http');
    }

    throw new ApiResponseError(getErrorMessage(payload) ?? fallback, response.status, 'http');
  }

  if (!body.trim()) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiResponseError(`Invalid JSON response (HTTP ${response.status}).`, response.status, 'parse');
  }
}

export async function parseRequiredApiResponse<T = unknown>(response: Response, fallbackMessage = 'Request failed'): Promise<T> {
  const payload = await parseApiResponse<T>(response, fallbackMessage);
  if (payload === undefined) {
    throw new ApiResponseError(`Expected a response body (HTTP ${response.status}).`, response.status, 'empty');
  }
  return payload;
}

async function sendApiRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = {
    ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...init.headers,
  };
  return fetch(`/api${path}`, { ...init, credentials: 'include', headers });
}

export async function requestApi<T = unknown>(
  path: string,
  init: RequestInit = {},
  fallbackMessage = 'Request failed',
): Promise<T> {
  try {
    return await parseRequiredApiResponse<T>(await sendApiRequest(path, init), fallbackMessage);
  } catch (error) {
    if (error instanceof ApiResponseError && error.kind === 'empty') {
      const endpoint = `/api${path.split('?', 1)[0]}`;
      throw new ApiResponseError(`${error.message} Request: ${init.method || 'GET'} ${endpoint}.`, error.status, error.kind);
    }
    throw error;
  }
}

export async function requestApiAllowEmpty(
  path: string,
  init: RequestInit = {},
  fallbackMessage = 'Request failed',
): Promise<void> {
  await parseApiResponse(await sendApiRequest(path, init), fallbackMessage);
}
