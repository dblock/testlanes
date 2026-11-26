import assert from "node:assert/strict";
import { test } from "node:test";

test("delta waits 100 milliseconds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(true);
});
