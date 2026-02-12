const run = async (): Promise<void> => {
  const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
  const mockLinkedInHtml = `
    <html><body><main>
      <h1 class="text-heading-xlarge">Ada Lovelace</h1>
      <div class="text-body-medium break-words">Distributed Systems Architect</div>
      <div class="text-body-small inline t-black--light break-words">London, United Kingdom</div>
      <section id="about"><p>Building high-throughput APIs.</p></section>
      <a href="/in/ada/followers"><span>12.4K followers</span></a>
    </main></body></html>
  `;

  const health = await (await fetch(`${baseUrl}/v1/health`)).json();
  const ready = await (await fetch(`${baseUrl}/v1/ready`)).json();
  const fetched = await (
    await fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "linkedin",
        operation: "profile",
        target: { handle: "ada", mockHtml: mockLinkedInHtml },
        fields: ["full_name", "headline", "follower_count"],
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
