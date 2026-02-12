import Ajv, { type ErrorObject } from "ajv";
import { ValidationError } from "../runtime/errors";
import { buildFetchRequestSchema, type FetchTimeoutPolicy } from "./contracts";
import type { FetchRequestInput } from "../extraction/types";

const formatAjvError = (error: ErrorObject): string => {
  const location = error.instancePath || "/";
  if (error.keyword === "required") {
    const field = String((error.params as { missingProperty?: string }).missingProperty ?? "");
    return `${location} missing required field '${field}'.`;
  }
  return `${location} ${error.message ?? "is invalid"}.`;
};

const normalizeFetchRequest = (
  payload: Record<string, unknown>,
  timeoutPolicy: FetchTimeoutPolicy,
): FetchRequestInput => {
  const source = String(payload.source).trim();
  const operation = String(payload.operation).trim();
  const fields =
    Array.isArray(payload.fields) && payload.fields.length > 0
      ? [...new Set(payload.fields.map((entry) => String(entry).trim()).filter(Boolean))]
      : undefined;
  const freshness =
    typeof payload.freshness === "string" ? payload.freshness.trim().toLowerCase() : undefined;
  const timeout_ms =
    typeof payload.timeout_ms === "number"
      ? payload.timeout_ms
      : timeoutPolicy.defaultMs;
  const fast_mode = payload.fast_mode === true;
  const cache_mode =
    payload.cache_mode === "bypass" || payload.cache_mode === "refresh"
      ? payload.cache_mode
      : "default";

  if (!source || !operation) {
    throw new ValidationError("`source` and `operation` must be non-empty strings.");
  }

  return {
    source,
    operation,
    target: payload.target as Record<string, unknown>,
    fields,
    freshness,
    timeout_ms,
    fast_mode,
    cache_mode,
  };
};

export const createFetchRequestValidator = (timeoutPolicy: FetchTimeoutPolicy) => {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
  });
  const schema = buildFetchRequestSchema(timeoutPolicy);
  const validate = ajv.compile(schema);

  return (payload: unknown): FetchRequestInput => {
    if (!validate(payload)) {
      const issues = (validate.errors ?? []).map(formatAjvError);
      throw new ValidationError("Request payload failed schema validation.", {
        schema: "FetchRequestV1",
        issues,
      });
    }

    return normalizeFetchRequest(payload as Record<string, unknown>, timeoutPolicy);
  };
};
