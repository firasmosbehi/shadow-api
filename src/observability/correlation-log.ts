import { getRequestContext } from "./request-context";

type AnyFn = (...args: unknown[]) => unknown;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const withContext = (data: Record<string, unknown>, ctx: ReturnType<typeof getRequestContext>) => {
  if (!ctx) return data;
  return {
    ...data,
    request_id: ctx.request_id,
    trace_id: ctx.trace_id,
    http_method: ctx.http_method,
    http_path: ctx.http_path,
    client_ip: ctx.client_ip,
    client_key_present: ctx.client_key_present,
    client_key_id: ctx.client_key_id,
    source: ctx.source,
    operation: ctx.operation,
  };
};

const wrap = (methodName: string, fn: AnyFn, thisArg: unknown): AnyFn => {
  return (...args: unknown[]) => {
    const ctx = getRequestContext();
    if (!ctx) return fn.apply(thisArg, args);

    const enriched: Record<string, unknown> = withContext({}, ctx);

    if (methodName === "exception") {
      // exception(error, message?, data?)
      if (args.length >= 3 && isRecord(args[2])) {
        args[2] = withContext(args[2] as Record<string, unknown>, ctx);
      } else if (args.length >= 3 && args[2] === undefined) {
        args[2] = enriched;
      } else if (args.length < 3) {
        args.push(enriched);
      } else {
        args.push(enriched);
      }
      return fn.apply(thisArg, args);
    }

    // debug/info/warning/error(message, data?)
    if (args.length >= 2 && isRecord(args[1])) {
      args[1] = withContext(args[1] as Record<string, unknown>, ctx);
    } else if (args.length < 2) {
      args.push(enriched);
    } else if (args[1] === undefined || args[1] === null) {
      args[1] = enriched;
    } else {
      args.push(enriched);
    }

    return fn.apply(thisArg, args);
  };
};

export const installCorrelationLogging = (log: Record<string, unknown>, enabled: boolean): void => {
  if (!enabled) return;
  const methods = ["debug", "info", "warning", "error", "exception"] as const;

  for (const method of methods) {
    const current = log[method];
    if (typeof current !== "function") continue;
    (log as Record<string, unknown>)[method] = wrap(method, current as AnyFn, log) as unknown;
  }
};
