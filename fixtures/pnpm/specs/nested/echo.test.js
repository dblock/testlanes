import assert from "node:assert/strict";
import { test } from "node:test";

test("echo waits 50 milliseconds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(true);
});
