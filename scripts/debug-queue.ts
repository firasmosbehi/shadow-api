const run = async (): Promise<void> => {
  const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
  const totalRequests = Number(process.env.TOTAL_REQUESTS ?? 25);
  const mockXHtml = `
    <html><body>
      <div data-testid="UserName"><span>OpenAI</span><span>@OpenAI</span></div>
      <div data-testid="UserDescription">Building safe AGI.</div>
      <div data-testid="UserLocation">San Francisco, CA</div>
      <a href="/openai/followers"><span>1.5M Followers</span></a>
      <a href="/openai/following"><span>42 Following</span></a>
      <a href="/openai/with_replies"><span>9,876 Posts</span></a>
    </body></html>
  `;

  const requests = Array.from({ length: totalRequests }, (_, index) =>
    fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "x",
        operation: "profile",
        target: { id: index + 1, handle: "openai", mockHtml: mockXHtml },
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
