import { redact } from "./redaction";

type AnyFn = (...args: unknown[]) => unknown;

const wrap = (fn: AnyFn, thisArg: unknown): AnyFn => {
  return (...args: unknown[]) => {
    const redacted = args.map((arg, index) => {
      if (index === 0) return arg; // message or error
      if (arg && typeof arg === "object") return redact(arg);
      if (typeof arg === "string") return arg; // keep message strings
      return arg;
    });
    return fn.apply(thisArg, redacted);
  };
};

export const installLogRedaction = (log: Record<string, unknown>, enabled: boolean): void => {
  if (!enabled) return;
  const methods = ["debug", "info", "warning", "error", "exception"] as const;

  for (const method of methods) {
    const current = log[method];
    if (typeof current !== "function") continue;
    // Patch in-place so existing imports use the redacted version.
    (log as Record<string, unknown>)[method] = wrap(current as AnyFn, log) as unknown;
  }
};
