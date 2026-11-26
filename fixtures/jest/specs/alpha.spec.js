test("alpha waits 400 milliseconds", async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(true).toBe(true);
});
