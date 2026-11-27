import assert from "node:assert/strict";
import { test } from "node:test";

test("bravo waits 300 milliseconds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(true);
});
