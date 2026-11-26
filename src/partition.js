/**
 * Splits weighted files into at most `count` groups using a deterministic
 * longest-processing-time greedy assignment: the heaviest remaining file goes
 * to the lightest group, preferring groups with fewer files and then lower
 * indexes on ties. Files within each group are sorted by path.
 *
 * @param {Record<string, number>} weights
 * @param {number} count
 * @returns {string[][]}
 */
export function partition(weights, count) {
  const files = Object.keys(weights).sort(
    (a, b) => weights[b] - weights[a] || (a < b ? -1 : a > b ? 1 : 0),
  );
  const groups = Array.from({ length: count }, () => ({ files: /** @type {string[]} */ ([]), total: 0 }));
  for (const file of files) {
    let lightest = groups[0];
    for (const group of groups) {
      if (group.total < lightest.total || (group.total === lightest.total && group.files.length < lightest.files.length)) {
        lightest = group;
      }
    }
    lightest.files.push(file);
    lightest.total += weights[file];
  }
  return groups.filter((group) => group.files.length > 0).map((group) => group.files.sort());
}
