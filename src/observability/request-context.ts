import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  request_id: string;
  trace_id: string;
  http_method: string;
  http_path: string;
  client_ip: string | null;
  client_key_present: boolean;
  client_key_id: string | null;
  source: string | null;
  operation: string | null;
  started_at_ms: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const getRequestContext = (): RequestContext | undefined => storage.getStore();
