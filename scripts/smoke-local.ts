const run = async (): Promise<void> => {
  const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";

  const health = await (await fetch(`${baseUrl}/v1/health`)).json();
  const ready = await (await fetch(`${baseUrl}/v1/ready`)).json();
  const fetched = await (
    await fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "smoke",
        operation: "health-check",
        target: { value: "ok" },
      }),
    })
  ).json();

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ health, ready, fetched }, null, 2));
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
