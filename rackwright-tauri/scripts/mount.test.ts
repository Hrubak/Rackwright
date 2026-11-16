// Shelf columns (three HE150 / two HE250 per shelf), rear and short mounting, KVM models. Synthetic data only.
import { CATALOG, addRack, checkPlace, colsOf, devDims, findFree, fromTpl, mountOf, placeNew, placeOnShelf, resolveTarget, setMount, showsRear, upgradeDoc, xOffset, Tpl } from "../src/edit";
import { swapModel } from "../src/swapModel";
import { Doc, Device, RW, RAIL, HDR, UH } from "../src/types";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };
const tpl = (short: string): Tpl => CATALOG.find((c) => c.short === short)!;
const byName = (n: string): Tpl => CATALOG.find((c) => c.name === n)!;
const mk = () => { const doc: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] }; const r = addRack(doc, "R1", 20); return { doc, r }; };
const put = (doc: Doc, tp: Tpl, rack: number, u: number, side = 0, name?: string): Device => {
  const d = fromTpl(doc, tp); d.rack = rack; d.u = u; d.side = side; if (name) d.name = name; doc.devices.push(d); return d;
};
const shelfTpl = CATALOG.find((c) => c.type === "Shelf")!;

// ---- catalog
{
  t("HE150 is a third of a shelf", colsOf(tpl("HE150")) === 3 && /3 per shelf/.test(tpl("HE150").name));
  t("HE250 is half a shelf", colsOf(tpl("HE250")) === 2 && /2 per shelf/.test(tpl("HE250").name));
  const kvms = CATALOG.filter((c) => c.type === "KVM");
  t("KVMs in the catalog", kvms.length >= 4 && kvms.every((k) => k.u_size === 1 && !k.half), kvms.map((k) => k.name).join(" | "));
  t("Tripp Lite KVMs", kvms.filter((k) => /Tripp Lite/.test(k.name)).length === 3);
  const k16 = kvms.find((k) => /B064-016/.test(k.name))!;
  t("16-port KVM has 16 PC ports", k16.ports.filter((p) => /^PC\d+$/.test(p.name)).length === 16);
}

// ---- three HE150 on one shelf
{
  const { doc, r } = mk();
  const sh = put(doc, shelfTpl, r.id, 5, 0, "Shelf"); sh.face = "front";
  const nodes: Device[] = [];
  for (let i = 0; i < 3; i++) {
    const d = fromTpl(doc, tpl("HE150")); d.name = "N" + i;
    t(`HE150 #${i + 1} goes on the shelf`, placeOnShelf(doc, d, r) && d.u === 5, `u=${d.u} side=${d.side}`);
    doc.devices.push(d); nodes.push(d);
  }
  t("one shelf only", doc.devices.filter((x) => x.type === "Shelf").length === 1);
  t("three columns used", new Set(nodes.map((n) => n.side)).size === 3);
  t("each is a third wide", devDims(nodes[0]).w === RW / 3);
  t("columns sit side by side", nodes.map(xOffset).sort((a, b) => a - b).join() === [0, RW / 3, (2 * RW) / 3].join());
  const fourth = fromTpl(doc, tpl("HE150"));
  t("a fourth needs a new shelf", placeOnShelf(doc, fourth, r) && fourth.u !== 5);
  t("drop on the middle third picks column 1", (() => {
    const probe = { ...nodes[1], rack: null } as Device;
    const tg = resolveTarget(doc, probe, r.x + RAIL + RW / 2, r.y + HDR + (r.u - 6) * UH + 2);
    return tg.kind === "rack" && tg.side === 1;
  })());
}

// ---- two HE250 per shelf, mixing
{
  const { doc, r } = mk();
  const sh = put(doc, shelfTpl, r.id, 5, 0, "Shelf"); sh.face = "front";
  const a = fromTpl(doc, tpl("HE250")), b = fromTpl(doc, tpl("HE250")), c = fromTpl(doc, tpl("HE250"));
  t("HE250 #1 on shelf", placeOnShelf(doc, a, r) && a.u === 5); doc.devices.push(a);
  t("HE250 #2 on same shelf", placeOnShelf(doc, b, r) && b.u === 5 && b.side !== a.side); doc.devices.push(b);
  t("HE250 #3 needs another shelf", placeOnShelf(doc, c, r) && c.u !== 5);
  const { doc: d2, r: r2 } = mk();
  const s2 = put(d2, shelfTpl, r2.id, 5, 0, "Shelf"); s2.face = "front";
  put(d2, tpl("HE250"), r2.id, 5, 0, "BIG");
  const n = fromTpl(d2, tpl("HE150"));
  t("HE150 beside an HE250 takes the right third", checkPlace(d2, n, r2, 5, 2).ok && !checkPlace(d2, n, r2, 5, 1).ok && !checkPlace(d2, n, r2, 5, 0).ok);
}

// ---- older files: HE150 placed two to a shelf
{
  const { doc, r } = mk();
  const a = put(doc, tpl("HE150"), r.id, 5, 0); const b = put(doc, tpl("HE150"), r.id, 5, 1);
  delete a.cols; delete b.cols;
  upgradeDoc(doc);
  t("upgrade gives HE150 three columns", a.cols === 3 && b.cols === 3 && a.side === 0 && b.side === 2);
}

// ---- rear and short mounting
{
  const { doc, r } = mk();
  const sw = put(doc, byName("Switch 24-port 1U"), r.id, 10, 0, "SW");
  t("plain box starts front only", mountOf(sw) === "front-short");
  const fw = put(doc, CATALOG.find((c) => c.model === "SonicWall NSa 2700")!, r.id, 12, 0, "FW");
  t("faceplate starts full depth", fw.face === "both" && mountOf(fw) === "front");
  setMount(fw, "rear");
  t("rear full depth: both faces, reversed", fw.face === "both" && fw.rev === true && mountOf(fw) === "rear");
  t("front view shows its back, rear view its front", showsRear(fw, "front") && !showsRear(fw, "rear"));
  setMount(fw, "rear-short");
  t("rear only frees the front of the U", fw.face === "rear" && fw.rev === true);
  const pp = fromTpl(doc, CATALOG.find((c) => c.type === "Patch panel")!); pp.face = "front";
  t("patch panel fits in front of a rear-only firewall", checkPlace(doc, pp, r, 12, 0).ok);
  setMount(fw, "rear");
  t("not in front of a full-depth one", !checkPlace(doc, pp, r, 12, 0).ok);
  setMount(fw, "front");
  t("back to front clears rev", fw.face === "both" && !fw.rev && !showsRear(fw, "front"));
  setMount(sw, "rear-short");
  const sw2 = fromTpl(doc, byName("Switch 24-port 1U")); sw2.face = "front";
  t("rear-only switch shares the U with a front one", checkPlace(doc, sw2, r, 10, 0).ok);
  t("findFree respects faces", (() => { const s = findFree(doc, r, sw2); return !!s; })());
}

// ---- swapping a rear-mounted device keeps the mount
{
  const { doc, r } = mk();
  const fw = put(doc, CATALOG.find((c) => c.model === "SonicWall NSa 2700")!, r.id, 12, 0, "FW");
  setMount(fw, "rear");
  const res = swapModel(doc, fw.id, CATALOG.find((c) => c.model === "SonicWall NSa 3700")!);
  const nf = doc.devices.find((x) => x.id === fw.id)!;
  t("swap keeps rear mount", res.ok && nf.rev === true && nf.face === "both", res.msg);
  const he = put(doc, tpl("HE250"), r.id, 3, 1, "HE");
  const sh = put(doc, shelfTpl, r.id, 3, 0, "Shelf"); sh.face = "front";
  const s2 = swapModel(doc, he.id, tpl("HE150"));
  const nh = doc.devices.find((x) => x.id === he.id)!;
  t("HE250 -> HE150 gets three columns", s2.ok && nh.cols === 3 && nh.side <= 2, s2.msg);
  const s3 = swapModel(doc, he.id, tpl("HE250"));
  const nb = doc.devices.find((x) => x.id === he.id)!;
  t("HE150 -> HE250 back to two", s3.ok && !nb.cols && nb.side <= 1, s3.msg);
}

// ---- KVM placement
{
  const { doc, r } = mk();
  const k = fromTpl(doc, CATALOG.find((c) => /B064-008/.test(c.name))!);
  t("KVM goes in a 1U slot", placeNew(doc, k, "front", r.id) === "" && k.rack === r.id && k.u_size === 1);
}

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
