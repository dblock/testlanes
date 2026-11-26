test("bravo waits 300 milliseconds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(true).toBe(true);
});
