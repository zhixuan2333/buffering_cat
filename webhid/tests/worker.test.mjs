import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker.ts";

const assets = {
  fetch() {
    return Promise.resolve(new Response("static asset"));
  },
};

test("serves non-API requests from static assets", async () => {
  const response = await worker.fetch(new Request("https://example.com/"), { ASSETS: assets });
  assert.equal(await response.text(), "static asset");
});

test("rejects invalid firmware URLs", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/firmware?url=https://example.net/firmware.bin"),
    { ASSETS: assets },
  );
  assert.equal(response.status, 400);
});

test("proxies a validated firmware release asset", async () => {
  const originalFetch = globalThis.fetch;
  const firmware = new Uint8Array([1, 2, 3, 4]);
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    return new Response(firmware, {
      headers: { "content-length": String(firmware.length) },
    });
  };

  try {
    const source = encodeURIComponent(
      "https://github.com/zhixuan2333/buffering_cat/releases/download/v1.0.0/buffering-cat-v1.1-v1.0.0.bin",
    );
    const response = await worker.fetch(
      new Request(`https://example.com/api/firmware?url=${source}`),
      { ASSETS: assets },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), firmware);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
