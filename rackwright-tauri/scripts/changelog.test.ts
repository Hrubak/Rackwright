// npx tsx scripts/changelog.test.ts — changelog entry splitting
import { latestEntries } from "../src/changelogParse";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const s = "# Changelog\nintro\n\n## 2.0.0 — 2026-01-02\n- **A.** one\n\n## 1.0.0 — 2026-01-01\n- two\n";
eq("count", latestEntries(s, 5).length, 2);
eq("first heading", latestEntries(s, 1)[0].heading, "2.0.0 — 2026-01-02");
eq("lines", latestEntries(s, 1)[0].lines.filter(Boolean), ["- **A.** one"]);
if (fail) process.exit(1);
console.log("changelog ok");
