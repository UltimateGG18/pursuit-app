import type {
  ApiErrorDetail,
  CreateIcpRequestInput,
  DeletedIcpDto,
  DiscoverProspectsRequestInput,
  IcpAnalysisDto,
  IcpAnalysisListDto,
  IcpProfileDto,
  IcpProfileListDto,
  ModelProviderHealth,
  ProspectHealthDto,
  ProspectRunDto,
} from '@pursuit/shared';

export interface ClientError {
  code: string;
  message: string;
  details: ApiErrorDetail[];
}

export type ClientResult<T> = { ok: true; data: T } | { ok: false; error: ClientError };

const API_BASE_URL =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ??
  'http://localhost:4000';

interface RawEnvelope<T> {
  success?: boolean;
  data?: T | null;
  error?: Partial<ClientError> | null;
}

/**
 * Every call returns the shared envelope, so the caller never has to look at
 * HTTP status codes. Transport and parse failures are mapped onto the same
 * error shape as a server-side failure.
 */
async function request<T>(path: string, init?: RequestInit): Promise<ClientResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when there is one. DELETE may legally carry
        // a body, so Fastify runs its JSON parser whenever this header is set
        // and rejects the empty payload with BAD_REQUEST.
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: `Could not reach the API at ${API_BASE_URL}. Is the backend running?`,
        details: [{ path: '', message: cause instanceof Error ? cause.message : 'Unknown network error' }],
      },
    };
  }

  let body: RawEnvelope<T> | null = null;
  try {
    body = (await response.json()) as RawEnvelope<T>;
  } catch {
    body = null;
  }

  if (body?.success === true && body.data !== undefined && body.data !== null) {
    return { ok: true, data: body.data };
  }

  if (body?.error) {
    return {
      ok: false,
      error: {
        code: body.error.code ?? 'UNKNOWN_ERROR',
        message: body.error.message ?? 'The request failed',
        details: body.error.details ?? [],
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_RESPONSE',
      message: `The API returned an unexpected response (HTTP ${response.status})`,
      details: [],
    },
  };
}

export const icpApi = {
  list: (): Promise<ClientResult<IcpProfileListDto>> => request<IcpProfileListDto>('/api/icps'),

  get: (id: string): Promise<ClientResult<IcpProfileDto>> =>
    request<IcpProfileDto>(`/api/icps/${id}`),

  create: (payload: CreateIcpRequestInput): Promise<ClientResult<IcpProfileDto>> =>
    request<IcpProfileDto>('/api/icps', { method: 'POST', body: JSON.stringify(payload) }),

  update: (id: string, payload: CreateIcpRequestInput): Promise<ClientResult<IcpProfileDto>> =>
    request<IcpProfileDto>(`/api/icps/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  remove: (id: string): Promise<ClientResult<DeletedIcpDto>> =>
    request<DeletedIcpDto>(`/api/icps/${id}`, { method: 'DELETE' }),
};

/**
 * Model analysis. Only `run` invokes the model; the reads return whatever was
 * stored, so re-opening a result never costs a model call.
 */
export const analysisApi = {
  run: (icpId: string): Promise<ClientResult<IcpAnalysisDto>> =>
    request<IcpAnalysisDto>(`/api/icps/${icpId}/analyze`, { method: 'POST' }),

  list: (icpId: string): Promise<ClientResult<IcpAnalysisListDto>> =>
    request<IcpAnalysisListDto>(`/api/icps/${icpId}/analyses`),

  get: (icpId: string, analysisId: string): Promise<ClientResult<IcpAnalysisDto>> =>
    request<IcpAnalysisDto>(`/api/icps/${icpId}/analyses/${analysisId}`),

  health: (): Promise<ClientResult<ModelProviderHealth>> =>
    request<ModelProviderHealth>('/api/model/health'),
};

/**
 * Prospect search - the step after analysis.
 *
 * Every call goes through the same `request` helper as everything else, which
 * is what keeps the data provider's credential where it belongs: the browser
 * talks to our API, our API talks to the provider, and no key, header or
 * provider URL exists in this bundle. There is deliberately no `VITE_`
 * provider setting for the same reason - a `VITE_` variable is compiled into
 * the JavaScript every visitor downloads.
 */
export const prospectsApi = {
  search: (
    icpId: string,
    payload: DiscoverProspectsRequestInput = {},
  ): Promise<ClientResult<ProspectRunDto>> =>
    request<ProspectRunDto>(`/api/icps/${icpId}/prospects`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  health: (): Promise<ClientResult<ProspectHealthDto>> =>
    request<ProspectHealthDto>('/api/prospects/health'),
};
