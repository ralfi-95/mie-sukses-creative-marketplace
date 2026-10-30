import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseApiResponse, requestApi, requestApiAllowEmpty } from './apiResponse';

afterEach(() => vi.unstubAllGlobals());

describe('API response parsing', () => {
  it('parses successful JSON responses', async () => {
    await expect(parseApiResponse<{ id: string }>(new Response('{"id":"order-1"}', {
      headers: { 'Content-Type': 'application/json' },
    }))).resolves.toEqual({ id: 'order-1' });
  });

  it('parses HTTP 201 JSON responses', async () => {
    await expect(parseApiResponse<{ id: string }>(new Response('{"id":"created-1"}', {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }))).resolves.toEqual({ id: 'created-1' });
  });

  it('parses HTTP 202 JSON responses when an endpoint returns an accepted payload', async () => {
    await expect(parseApiResponse<{ accepted: boolean }>(new Response('{"accepted":true}', {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    }))).resolves.toEqual({ accepted: true });
  });

  it('returns undefined for 204 No Content without JSON parsing', async () => {
    await expect(parseApiResponse(new Response(null, { status: 204 }))).resolves.toBeUndefined();
  });

  it('rejects missing required data instead of passing undefined to callers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(requestApi('/admin/applications', {}, 'Applications failed'))
      .rejects.toMatchObject({ name: 'ApiResponseError', status: 204, kind: 'empty' });
  });

  it('rejects an empty successful body for endpoints that require JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('  ', { status: 200 })));
    await expect(requestApi('/categories')).rejects.toMatchObject({ status: 200, kind: 'empty' });
  });

  it('returns undefined for other empty successful responses', async () => {
    await expect(parseApiResponse(new Response('  \n', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))).resolves.toBeUndefined();
  });

  it('allows a contract-authorized empty HTTP 200 through the empty-response helper', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(requestApiAllowEmpty('/example/empty', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('identifies the request when a required HTTP 200 body is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(requestApi('/categories?active=true')).rejects.toMatchObject({
      message: 'Expected a response body (HTTP 200). Request: GET /api/categories.',
      status: 200,
      kind: 'empty',
    });
  });

  it('uses meaningful JSON error messages and retains the HTTP status', async () => {
    const response = new Response('{"error":"Session expired"}', {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(parseApiResponse(response)).rejects.toMatchObject({
      name: 'ApiResponseError',
      message: 'Session expired',
      status: 401,
      kind: 'http',
    });
  });

  it('uses plain text errors without treating failed requests as successful', async () => {
    const response = new Response('Service temporarily unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
    await expect(parseApiResponse(response)).rejects.toMatchObject({
      message: 'Service temporarily unavailable',
      status: 503,
      kind: 'http',
    });
  });

  it('includes the status when an error response is empty', async () => {
    await expect(parseApiResponse(new Response(null, { status: 404 }), 'Order request failed'))
      .rejects.toMatchObject({ message: 'Order request failed (HTTP 404)', status: 404 });
  });

  it('treats unexpected redirect responses as failures', async () => {
    await expect(parseApiResponse(new Response(null, { status: 302, headers: { Location: '/login' } })))
      .rejects.toMatchObject({ status: 302, kind: 'http' });
  });

  it('surfaces malformed successful JSON with the response status', async () => {
    const response = new Response('{"order":', {
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(parseApiResponse(response)).rejects.toMatchObject({
      name: 'ApiResponseError',
      message: 'Invalid JSON response (HTTP 200).',
      status: 200,
      kind: 'parse',
    });
  });

  it('surfaces malformed JSON error bodies instead of hiding them', async () => {
    const response = new Response('{"error":', {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(parseApiResponse(response)).rejects.toMatchObject({
      name: 'ApiResponseError',
      message: 'Invalid JSON error response (HTTP 502).',
      status: 502,
      kind: 'parse',
    });
  });

  it('keeps explicitly bodyless requests successful', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(requestApiAllowEmpty('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('preserves network failures from fetch', async () => {
    const networkError = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));
    await expect(requestApi('/categories')).rejects.toBe(networkError);
  });

  it('does not unwrap a valid JSON response envelope', async () => {
    const payload = { applications: [{ id: 'application-1' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
    })));
    await expect(requestApi('/admin/applications')).resolves.toEqual(payload);
  });
});
