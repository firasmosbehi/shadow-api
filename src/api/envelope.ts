import { API_VERSION } from "./contracts";

export interface ApiMeta {
  request_id: string;
  timestamp: string;
  version: string;
  [key: string]: unknown;
}

export const createMeta = (
  requestId: string,
  extras: Record<string, unknown> = {},
): ApiMeta => ({
  request_id: requestId,
  timestamp: new Date().toISOString(),
  version: API_VERSION,
  ...extras,
});

export const createSuccessEnvelope = <T>(
  requestId: string,
  data: T,
  metaExtras: Record<string, unknown> = {},
) => ({
  ok: true,
  data,
  error: null,
  meta: createMeta(requestId, metaExtras),
});
