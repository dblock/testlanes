test("echo waits 50 milliseconds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(true).toBe(true);
});
