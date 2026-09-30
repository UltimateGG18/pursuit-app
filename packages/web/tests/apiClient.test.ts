import { beforeEach, describe, expect, it, vi } from 'vitest';
import { icpApi } from '../src/api/client.js';

/**
 * These tests exercise the real client against a stubbed `fetch`.
 *
 * The ICP form tests mock `icpApi` wholesale, so they can never see the
 * request the client actually builds. That blind spot let a bug ship: the
 * client set `content-type: application/json` on every call, and because
 * DELETE may legally carry a body, Fastify ran its JSON parser and rejected
 * the empty payload with `BAD_REQUEST` - archiving an ICP always failed.
 */
const fetchMock = vi.fn();

function ok(data: unknown) {
  return Promise.resolve({
    status: 200,
    json: () => Promise.resolve({ success: true, data, error: null }),
  });
}

/** Headers as the client passed them, lower-cased for comparison. */
function sentHeaders(call: number): Record<string, string> {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  const entries = Object.entries((init?.headers ?? {}) as Record<string, string>);
  return Object.fromEntries(entries.map(([key, value]) => [key.toLowerCase(), value]));
}

function sentInit(call: number): RequestInit {
  return (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

describe('icpApi request headers', () => {
  it('omits content-type on DELETE, which has no body', async () => {
    fetchMock.mockReturnValue(ok({ id: 'abc', status: 'ARCHIVED', deletedAt: 'now' }));

    const result = await icpApi.remove('abc');

    expect(result.ok).toBe(true);
    expect(sentInit(0).method).toBe('DELETE');
    expect(sentInit(0).body).toBeUndefined();
    expect(sentHeaders(0)).not.toHaveProperty('content-type');
  });

  it('omits content-type on GET requests', async () => {
    fetchMock.mockReturnValue(ok({ items: [], total: 0, limit: 25, offset: 0 }));

    await icpApi.list();

    expect(sentHeaders(0)).not.toHaveProperty('content-type');
  });

  it('sends content-type with the body on POST and PUT', async () => {
    fetchMock.mockReturnValue(ok({ id: 'abc' }));
    const payload = { config: { schemaVersion: 'icp.v1' }, status: 'ACTIVE' } as never;

    await icpApi.create(payload);
    expect(sentInit(0).method).toBe('POST');
    expect(sentHeaders(0)['content-type']).toBe('application/json');
    expect(sentInit(0).body).toBe(JSON.stringify(payload));

    await icpApi.update('abc', payload);
    expect(sentInit(1).method).toBe('PUT');
    expect(sentHeaders(1)['content-type']).toBe('application/json');
  });
});

describe('icpApi error mapping', () => {
  it('maps an envelope error onto the client error shape', async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        status: 400,
        json: () =>
          Promise.resolve({
            success: false,
            data: null,
            error: { code: 'BAD_REQUEST', message: 'Nope', details: [] },
          }),
      }),
    );

    const result = await icpApi.remove('abc');

    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Nope', details: [] },
    });
  });

  it('maps a transport failure onto NETWORK_ERROR', async () => {
    fetchMock.mockReturnValue(Promise.reject(new Error('boom')));

    const result = await icpApi.list();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NETWORK_ERROR');
  });
});
