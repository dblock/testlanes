import assert from "node:assert/strict";
import { test } from "node:test";

test("alpha waits 400 milliseconds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(true);
});
