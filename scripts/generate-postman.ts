import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { API_VERSION, EXAMPLES } from "../src/api/contracts";

const collection = {
  info: {
    name: "Shadow API MVP",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    description: `MVP endpoints for Shadow API v${API_VERSION}.`,
  },
  variable: [
    {
      key: "baseUrl",
      value: "http://127.0.0.1:3000",
    },
    {
      key: "apiKey",
      value: "change-me",
    },
  ],
  item: [
    {
      name: "Health",
      request: {
        method: "GET",
        url: "{{baseUrl}}/v1/health",
      },
    },
    {
      name: "Ready",
      request: {
        method: "GET",
        url: "{{baseUrl}}/v1/ready",
      },
    },
    {
      name: "Adapters Health",
      request: {
        method: "GET",
        header: [{ key: "x-api-key", value: "{{apiKey}}" }],
        url: "{{baseUrl}}/v1/adapters/health",
      },
    },
    {
      name: "Fetch",
      request: {
        method: "POST",
        header: [
          { key: "content-type", value: "application/json" },
          { key: "x-api-key", value: "{{apiKey}}" },
        ],
        body: {
          mode: "raw",
          raw: JSON.stringify(EXAMPLES.fetchRequest, null, 2),
        },
        url: "{{baseUrl}}/v1/fetch",
      },
    },
  ],
};

const run = async (): Promise<void> => {
  const outDir = path.join(process.cwd(), "docs", "api", "postman");
  const outPath = path.join(outDir, "shadow-api-mvp.postman_collection.json");

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(collection, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Postman collection written: ${outPath}`);
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
