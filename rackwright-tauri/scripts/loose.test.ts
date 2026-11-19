// Loose cable style: the path, and the saved setting. Made-up coordinates only.
import { loosePath, loadOpts, saveOpts, DEFAULT_OPTS } from "../src/cableView";

let fail = 0;
const t = (name: string, ok: boolean) => { if (!ok) { fail++; console.log("FAIL " + name); } };
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?(e-?\d+)?|NaN|Infinity/g) || []);
const ends = (d: string) => { const n = nums(d).map(Number); return { start: n.slice(0, 2), end: n.slice(-2) }; };

// starts and ends exactly at the ports
const d1 = loosePath([100, 50], 1, [180, 120], -1, 7);
t("starts at port a", ends(d1).start.join() === "100,50");
t("ends at port b", ends(d1).end.join() === "180,120");
t("one curve", (d1.match(/C/g) || []).length === 1 && d1.startsWith("M100 50L100 60C"));
t("leaves b along its direction", d1.endsWith("180 110L180 120"));

// same shape every time, different cables differ
t("stable per id", loosePath([0, 0], 1, [300, 0], 1, 42) === loosePath([0, 0], 1, [300, 0], 1, 42));
t("cables fan out", loosePath([0, 0], 1, [300, 0], 1, 1) !== loosePath([0, 0], 1, [300, 0], 1, 2));

// sag is downward and grows with distance
const midY = (d: string) => { const n = nums(d.split("C")[1]).map(Number); return (n[1] + n[3]) / 2; };
const near = midY(loosePath([0, 0], 1, [40, 0], 1, 3)), far = midY(loosePath([0, 0], 1, [600, 0], 1, 3));
t("sag is below the ports", near > 10 && far > 10);
t("sag grows with distance", far > near);
t("sag is capped", far < 10 + 110 + 64 * 1.3 + 1);

// awkward input never gives NaN
for (const d of [loosePath([5, 5], 1, [5, 5], 1, 0), loosePath([5, 5], 0, [5, 5], 0, -3), loosePath([NaN, 1], 1, [Infinity, 2], -1, 9)])
  t("finite: " + d, !/NaN|Infinity/.test(d) && nums(d).length === 12);
t("dir 0 counts as down", loosePath([0, 0], 0, [50, 0], 0, 4) === loosePath([0, 0], 1, [50, 0], 1, 4));

// the saved setting
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
saveOpts({ ...DEFAULT_OPTS, style: "loose" });
t("loose is remembered", loadOpts().style === "loose");
store.set("rw.cableOpts", JSON.stringify({ style: "wiggly" }));
t("unknown style falls back to routed", loadOpts().style === "routed");
t("default stays routed", DEFAULT_OPTS.style === "routed");

console.log(fail ? `${fail} failed` : "all passed");
if (fail) process.exit(1);
