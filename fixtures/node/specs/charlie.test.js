import assert from "node:assert/strict";
import { test } from "node:test";

test("charlie waits 200 milliseconds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(true);
});
