import { expect, test } from "vitest";

test("charlie waits 200 milliseconds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(true).toBe(true);
});
