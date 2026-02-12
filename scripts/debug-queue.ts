const run = async (): Promise<void> => {
  const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
  const totalRequests = Number(process.env.TOTAL_REQUESTS ?? 25);

  const requests = Array.from({ length: totalRequests }, (_, index) =>
    fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "debug",
        operation: "queue-test",
        target: { id: index + 1 },
      }),
    }).then(async (response) => ({
      status: response.status,
      body: await response.json(),
    })),
  );

  const settled = await Promise.all(requests);
  const summary = settled.reduce(
    (acc, entry) => {
      if (entry.status >= 200 && entry.status < 300) acc.ok += 1;
      else acc.failed += 1;
      return acc;
    },
    { ok: 0, failed: 0 },
  );

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        baseUrl,
        totalRequests,
        summary,
        sample: settled.slice(0, 5),
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
