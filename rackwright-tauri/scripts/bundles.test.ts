import { findBundles } from "../src/bundles";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };
const v = (cable: number, x: number, y0: number, y1: number) => ({ cable, pts: [[x, y0], [x, y1]] as [number, number][] });
const h = (cable: number, y: number, x0: number, x1: number) => ({ cable, pts: [[x0, y], [x1, y]] as [number, number][] });

let b = findBundles([v(1, 100, 0, 200), v(2, 105, 20, 220)]);
t("two parallel vertical lanes -> one bundle", b.length === 1 && b[0].axis === "v" && b[0].cables.join() === "1,2", JSON.stringify(b));
t("bundle extent is the shared stretch", b[0].lo === 20 && b[0].hi === 200 && b[0].fixedMin === 100 && b[0].fixedMax === 105);

t("non-overlapping lanes -> none", findBundles([v(1, 100, 0, 100), v(2, 105, 120, 300)]).length === 0);
t("overlap under 30 px -> none", findBundles([v(1, 100, 0, 100), v(2, 105, 80, 300)]).length === 0);
t("lanes too far apart -> none", findBundles([v(1, 100, 0, 200), v(2, 140, 0, 200)]).length === 0);
t("same cable twice -> none", findBundles([{ cable: 1, pts: [[0, 0], [0, 100], [5, 100], [5, 0]] }]).length === 0);

b = findBundles([v(1, 100, 0, 200), v(2, 105, 0, 200), v(3, 110, 0, 200)]);
t("three lanes -> one bundle spanning all", b.length === 1 && b[0].cables.length === 3 && b[0].fixedMin === 100 && b[0].fixedMax === 110, JSON.stringify(b));

b = findBundles([h(1, 50, 0, 200), h(2, 55, 40, 300)]);
t("horizontal case", b.length === 1 && b[0].axis === "h" && b[0].lo === 40 && b[0].hi === 200, JSON.stringify(b));

b = findBundles([{ cable: 1, pts: [[100, 0], [100, 100], [300, 100]] }, { cable: 2, pts: [[105, 0], [105, 105], [300, 105]] }]);
t("L-shaped pair -> vertical and horizontal bundle", b.length === 2, JSON.stringify(b));

if (fails) { console.log(fails + " failed"); process.exit(1); }
