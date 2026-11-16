import { resizeRack, CATALOG, addRack, fromTpl, checkPlace, findFree, shapeOf, resolveTarget, placeNew, protoOf } from "../src/edit";
import { Doc, UH, HDR, RAIL } from "../src/types";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

const doc: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] };
const r = addRack(doc, "R1", 42);
const find = (re: RegExp, pred: (c: any) => boolean = () => true) => CATALOG.findIndex((c) => re.test(c.name) && pred(c));

const sw = CATALOG.findIndex((c) => c.type === "Switch" && !c.half && !c.plate?.off && c.u_size === 1);
const a = fromTpl(doc, CATALOG[sw]); a.face = "front";
t("empty rack accepts", checkPlace(doc, a, r, 10, 0).ok);
a.rack = r.id; a.u = 10; a.side = 0; doc.devices.push(a);
const b = fromTpl(doc, CATALOG[sw]); b.face = "front";
t("overlap rejected", !checkPlace(doc, b, r, 10, 0).ok, checkPlace(doc, b, r, 10, 0).why);
t("adjacent ok", checkPlace(doc, b, r, 11, 0).ok);
t("below 1 rejected", !checkPlace(doc, b, r, 0, 0).ok);
t("above top rejected", !checkPlace(doc, b, r, 43, 0).ok);
t("move onto self ok", checkPlace(doc, a, r, 10, 0).ok);

const ap = CATALOG.findIndex((c) => c.type === "Wireless" && c.plate && (c.plate.k === "uap" || c.plate.style === "ap"));
if (ap >= 0) {
  const d = fromTpl(doc, CATALOG[ap]);
  t("AP shape is disc/squircle", shapeOf({ ...d, rack: null }) !== "rect", shapeOf({ ...d, rack: null }));
  t("AP in rack rejected", !checkPlace(doc, { ...d, rack: r.id }, r, 20, 0).ok, checkPlace(doc, { ...d, rack: r.id }, r, 20, 0).why);
} else t("AP found in catalog", false);

const sh = CATALOG.findIndex((c) => /shelf/i.test(c.name) || /shelf/i.test(c.type));
const off = CATALOG.findIndex((c) => c.plate?.off && c.type !== "Wireless");
if (off >= 0) {
  const d = fromTpl(doc, CATALOG[off]);
  t("desktop device needs shelf", !checkPlace(doc, { ...d, rack: r.id }, r, 30, 0).ok, checkPlace(doc, { ...d, rack: r.id }, r, 30, 0).why);
} else console.log("SKIP no off-rack non-AP in catalog");
void sh;

const half = CATALOG.findIndex((c) => c.half && !c.plate?.off);
if (half >= 0) {
  const h1 = fromTpl(doc, CATALOG[half]); h1.face = "front"; h1.rack = r.id; h1.u = 20; h1.side = 0; doc.devices.push(h1);
  const h2 = fromTpl(doc, CATALOG[half]); h2.face = "front";
  t("half same side rejected", !checkPlace(doc, h2, r, 20, 0).ok);
  t("half other side ok", checkPlace(doc, h2, r, 20, 1).ok);
}

const ups = CATALOG.findIndex((c) => c.type === "UPS");
if (ups >= 0) {
  const d = fromTpl(doc, CATALOG[ups]); d.face = "front";
  const f = findFree(doc, r, d);
  t("heavy goes to bottom", !!f && f[0] <= 5, JSON.stringify(f));
}
const light = fromTpl(doc, CATALOG[sw]); light.face = "front";
const fl = findFree(doc, r, light);
t("light goes to top", !!fl && fl[0] >= 38, JSON.stringify(fl));

// resolveTarget: cursor over U row 15 should map to u=15 (top row of device).
const rx = r.x + RAIL + 100;
const rowY = (u: number) => r.y + HDR + (r.u - u) * UH + UH / 2;
const p1 = { ...protoOf(CATALOG[sw]), face: "front" } as any;
const tg = resolveTarget(doc, p1, rx, rowY(15));
t("cursor row -> U", tg.kind === "rack" && tg.u === 15, JSON.stringify(tg.kind === "rack" ? { u: tg.u, ok: tg.p.ok } : tg));
const tg2 = resolveTarget(doc, p1, rx, rowY(10));
t("cursor on occupied -> not ok", tg2.kind === "rack" && !tg2.p.ok);
const tg3 = resolveTarget(doc, p1, -5000, -5000);
t("far away -> float/none", tg3.kind !== "rack");

const sdoc: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] };
const sr: any = addRack(sdoc, "Wall", 12, { kind: "wall", model: "tl-srw12us", model_name: "Tripp Lite SmartRack SRW12US", width_mm: 530, depth_mm: 500 });
t("addRack spec stored", sr.kind === "wall" && sr.model === "tl-srw12us" && sr.u === 12 && sr.width_mm === 530 && sr.depth_mm === 500 && sr.model_name.includes("SRW12US"));
const plain: any = addRack(sdoc);
t("addRack without spec has no kind", plain.kind === undefined && plain.u === 42);
const sd = fromTpl(sdoc, CATALOG[sw]); sd.rack = sr.id; sd.u = 10; sd.side = 0; sd.face = "front"; sdoc.devices.push(sd);
t("resize below device refused", resizeRack(sdoc, sr, 8) !== "" && sr.u === 12);
t("resize above ok", resizeRack(sdoc, sr, 20) === "" && sr.u === 20);

const full = placeNew(doc, fromTpl(doc, CATALOG[sw]), "front", r.id);
t("placeNew returns string", typeof full === "string", full);
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
