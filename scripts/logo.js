import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Four lanes of test files with different durations, packed to end at the same edge.
const lanes = [
  [[88, "dark"], [40, "medium"], [28, "light"]],
  [[52, "medium"], [108, "dark"]],
  [[64, "light"], [64, "dark"], [28, "medium"]],
  [[120, "dark"], [40, "light"]],
];
const colors = { dark: "#28A745", medium: "#34D058", light: "#85E89D" };
const left = 46;
const top = 52;
const height = 30;
const gap = 4;
const pitch = 42;

/**
 * Renders the testlanes logo as SVG.
 *
 * @returns {string}
 */
export function logo() {
  const blocks = lanes.flatMap((lane, row) => {
    let x = left;
    return lane.map(([width, shade]) => {
      const block = `    <rect x="${x}" y="${top + row * pitch}" width="${width}" height="${height}" rx="7" fill="${colors[/** @type {keyof typeof colors} */ (shade)]}"/>`;
      x += width + gap;
      return block;
    });
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title">',
    '  <title id="title">testlanes: four lanes of differently sized green test blocks that all end at the same edge</title>',
    '  <rect x="8" y="8" width="240" height="240" rx="40" fill="#F3FBF5"/>',
    "  <g>",
    ...blocks,
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await writeFile(new URL("../assets/logo.svg", import.meta.url), logo());
}
