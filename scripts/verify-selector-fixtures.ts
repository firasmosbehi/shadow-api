import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ExtractionService } from "../src/extraction/service";

interface FixtureExpectation {
  source: string;
  operation: string;
  target: Record<string, unknown>;
  expectedData: Record<string, unknown>;
}

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return left === right;

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((entry, index) => deepEqual(entry, right[index]));
  }

  if (typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])];
    return keys.every((key) => deepEqual(leftRecord[key], rightRecord[key]));
  }

  return false;
};

const run = async (): Promise<void> => {
  const fixturesDir = path.join(process.cwd(), "fixtures", "selectors");
  const fixtureFiles = await readdir(fixturesDir);
  const expectationFiles = fixtureFiles
    .filter((file) => file.endsWith(".expected.json"))
    .sort((a, b) => a.localeCompare(b));

  if (expectationFiles.length === 0) {
    throw new Error("No selector expectation fixtures found.");
  }

  const extractionService = new ExtractionService({
    defaultTimeoutMs: 5000,
    maxTimeoutMs: 30_000,
  });

  const failures: string[] = [];
  for (const expectationFile of expectationFiles) {
    const baseName = expectationFile.replace(".expected.json", "");
    const htmlPath = path.join(fixturesDir, `${baseName}.html`);
    const expectationPath = path.join(fixturesDir, expectationFile);

    const [html, expectationRaw] = await Promise.all([
      readFile(htmlPath, "utf8"),
      readFile(expectationPath, "utf8"),
    ]);

    const expectation = JSON.parse(expectationRaw) as FixtureExpectation;
    const result = await extractionService.execute({
      source: expectation.source,
      operation: expectation.operation,
      target: {
        ...expectation.target,
        mockHtml: html,
      },
    });

    for (const [key, expectedValue] of Object.entries(expectation.expectedData)) {
      const actual = result.data[key];
      if (!deepEqual(actual, expectedValue)) {
        failures.push(
          `${baseName}.${key} expected=${JSON.stringify(expectedValue)} actual=${JSON.stringify(actual)}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Fixture validation failed:\n${failures.map((line) => `- ${line}`).join("\n")}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Selector fixture validation passed (${expectationFiles.length} fixtures).`,
  );
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
