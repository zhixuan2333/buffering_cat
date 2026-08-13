import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports the WebHID controller as static HTML", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /Buffering Cat/);
  assert.match(html, /LED matrix/);
  assert.match(html, /Custom frame sequence/);
  assert.match(html, /Reboot to USB updater/);
  assert.match(html, /Update in the browser/);
  assert.doesNotMatch(html, /chatgpt\.site|codex-preview/);
});
