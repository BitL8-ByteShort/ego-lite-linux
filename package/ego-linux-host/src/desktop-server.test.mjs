import test from "node:test";
import assert from "node:assert/strict";
import { startDesktopController } from "../dist/src/desktop-server.js";
test("controller requires secret plus same origin; static surface CSP and escaping", async () => {
  let paused = 0;
  const controller = await startDesktopController({
    host: {
      profileId: "default",
      summaries: () => [{ id: 1, name: "<script>x</script>" }],
      pause: async () => {
        paused++;
      },
    },
    profiles: async () => ["default"],
    createProfile: async () => {},
    openPersonal: async () => {},
    stop: async () => {},
  });
  try {
    const url = new URL(controller.url),
      token = url.hash.slice(1);
    url.hash = "";
    const html = await fetch(url);
    assert.match(
      html.headers.get("content-security-policy"),
      /default-src 'self'/,
    );
    assert.equal((await fetch(new URL("/api", url))).status, 403);
    assert.equal(
      (
        await fetch(new URL("/api", url), {
          method: "POST",
          headers: {
            "x-ego-token": token,
            origin: "https://evil.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "pause", id: 1 }),
        })
      ).status,
      403,
    );
    assert.equal(paused, 0);
    const r = await fetch(new URL("/api", url), {
      method: "POST",
      headers: {
        "x-ego-token": token,
        origin: url.origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "pause", id: 1 }),
    });
    assert.equal(r.status, 200);
    assert.equal(paused, 1);
  } finally {
    await controller.close();
  }
});
