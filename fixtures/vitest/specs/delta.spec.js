import { expect, test } from "vitest";

test("delta waits 100 milliseconds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(true).toBe(true);
});
