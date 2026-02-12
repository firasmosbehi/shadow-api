import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  API_VERSION,
  EXAMPLES,
  buildFetchRequestSchema,
  type FetchTimeoutPolicy,
} from "../src/api/contracts";

const timeoutPolicy: FetchTimeoutPolicy = {
  minMs: 1000,
  maxMs: 15000,
  defaultMs: 8000,
};

const document = {
  openapi: "3.1.0",
  info: {
    title: "Shadow API",
    version: API_VERSION,
    description:
      "Real-time Shadow API for non-API websites. This specification is generated from source contracts.",
  },
  servers: [
    {
      url: "http://127.0.0.1:3000",
      description: "Local development server",
    },
  ],
  tags: [
    { name: "Health", description: "Service liveness and readiness" },
    { name: "Extraction", description: "Source extraction endpoints" },
    { name: "Operations", description: "Queue and adapter diagnostics" },
  ],
  paths: {
    "/v1/health": {
      get: {
        tags: ["Health"],
        summary: "Service liveness",
        responses: {
          "200": {
            description: "Service is alive",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
        },
      },
    },
    "/v1/ready": {
      get: {
        tags: ["Health"],
        summary: "Service readiness",
        responses: {
          "200": {
            description: "Service readiness details",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
        },
      },
    },
    "/v1/adapters/health": {
      get: {
        tags: ["Operations"],
        summary: "Adapter health snapshots",
        security: [{ ApiKeyHeader: [] }, { BearerAuth: [] }],
        responses: {
          "200": {
            description: "Adapter health list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          default: {
            description: "Error response",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
        },
      },
    },
    "/v1/debug/performance": {
      get: {
        tags: ["Operations"],
        summary: "Performance, cache, and prewarm telemetry",
        security: [{ ApiKeyHeader: [] }, { BearerAuth: [] }],
        responses: {
          "200": {
            description: "Performance telemetry response",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          default: {
            description: "Error response",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
        },
      },
    },
    "/v1/fetch": {
      post: {
        tags: ["Extraction"],
        summary: "Extract normalized data from a source",
        security: [{ ApiKeyHeader: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FetchRequestV1" },
              example: EXAMPLES.fetchRequest,
            },
          },
        },
        responses: {
          "200": {
            description: "Successful extraction",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
                example: EXAMPLES.fetchResponse,
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
                example: EXAMPLES.errorResponse,
              },
            },
          },
          "401": {
            description: "Authentication error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
          "429": {
            description: "Queue backpressure",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
          "503": {
            description: "Source blocked / service shutting down",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyHeader: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
      },
      BearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
    schemas: {
      FetchRequestV1: buildFetchRequestSchema(timeoutPolicy),
      SuccessEnvelope: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "data", "error", "meta"],
        properties: {
          ok: { type: "boolean", const: true },
          data: {},
          error: { type: "null" },
          meta: { $ref: "#/components/schemas/ResponseMeta" },
        },
      },
      ErrorEnvelope: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "data", "error", "meta"],
        properties: {
          ok: { type: "boolean", const: false },
          data: { type: "null" },
          error: {
            type: "object",
            required: ["code", "message", "retryable", "details"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              retryable: { type: "boolean" },
              details: {},
            },
          },
          meta: { $ref: "#/components/schemas/ResponseMeta" },
        },
      },
      ResponseMeta: {
        type: "object",
        required: ["request_id", "timestamp", "version"],
        properties: {
          request_id: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
          version: { type: "string" },
        },
      },
    },
  },
} as const;

const run = async (): Promise<void> => {
  const outDir = path.join(process.cwd(), "docs", "api");
  const outPath = path.join(outDir, "openapi.json");

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(`OpenAPI written: ${outPath}`);
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
