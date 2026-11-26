import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { logo } from "../scripts/logo.js";
import { root } from "./support.js";

test("committed logo matches the generator", async () => {
  assert.equal(await readFile(join(root, "assets", "logo.svg"), "utf8"), logo());
});

test("every lane ends at the same edge", () => {
  const ends = new Map();
  for (const [, x, y, width] of logo().matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="30"/gu)) {
    ends.set(y, Math.max(ends.get(y) ?? 0, Number(x) + Number(width)));
  }
  assert.equal(ends.size, 4);
  assert.deepEqual(new Set(ends.values()), new Set([210]));
});
