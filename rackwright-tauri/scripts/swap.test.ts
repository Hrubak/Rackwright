// Height change, model swap, and shelf placement of 2U half-width gear. Synthetic data only.
import { CATALOG, addRack, fromTpl, checkPlace, newCable, placeOnShelf, Tpl } from "../src/edit";
import { resizeDevice, swapModel } from "../src/swapModel";
import { matchTemplate } from "../src/auvik/plan";
import { Doc, Device } from "../src/types";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };
const tpl = (short: string): Tpl => CATALOG.find((c) => c.short === short)!;
const byName = (n: string): Tpl => CATALOG.find((c) => c.name === n)!;
const mk = () => { const doc: Doc = { v: 1, nid: 1, racks: [], devices: [], cables: [] }; const r = addRack(doc, "R1", 20); return { doc, r }; };
const put = (doc: Doc, tp: Tpl, rack: number, u: number, side = 0, name?: string): Device => {
  const d = fromTpl(doc, tp); d.rack = rack; d.u = u; d.side = side; d.face = d.plate ? "both" : "front"; if (name) d.name = name; doc.devices.push(d); return d;
};
const portNamed = (d: Device, n: string) => d.ports.find((p) => p.name === n);

// ---- height change
{
  const { doc, r } = mk();
  const s = put(doc, byName("Server 1U"), r.id, 10, 0, "SRV");
  const res = resizeDevice(doc, s.id, 2);
  t("1U -> 2U keeps top edge", res.ok, res.msg);
  const dev = (id: number) => doc.devices.find((x) => x.id === id)!;
  const sd = () => dev(s.id);
  t("grown device is in the doc", sd().u === 9 && sd().u_size === 2);
  put(doc, byName("Server 1U"), r.id, 8, 0, "BLK");
  put(doc, byName("Server 1U"), r.id, 11, 0, "BLK2");
  const bad = resizeDevice(doc, s.id, 3);
  t("rejection has a reason", !bad.ok && /taken|fit/i.test(bad.msg), bad.msg);
  t("unchanged on reject", sd().u === 9 && sd().u_size === 2);
  t("taller than rack rejected", !resizeDevice(doc, s.id, 30).ok);
  const off = fromTpl(doc, byName("Server 1U")); off.rack = null; doc.devices.push(off);
  t("off-rack just changes size", resizeDevice(doc, off.id, 4).ok && dev(off.id).u_size === 4);
  const top = put(doc, byName("Server 1U"), r.id, 20, 0, "TOP");
  const rt = resizeDevice(doc, top.id, 2);
  t("at top of rack grows downward", rt.ok && dev(top.id).u === 19, `u=${dev(top.id).u}`);
  const hw = put(doc, byName("Server 1U"), r.id, 4, 0, "HALF");
  t("half toggle ok", resizeDevice(doc, hw.id, 1, true).ok && dev(hw.id).half);
  const sw = put(doc, tpl("PE-R650"), r.id, 1, 0, "PLATE");
  t("fixed plate cannot change width", !resizeDevice(doc, sw.id, 1, true).ok);
}

// ---- model swap, ports and cables
{
  const { doc, r } = mk();
  const srv = { name: "Generic", type: "Server", u_size: 2, color: "#4b5563", rows: 0, half: false, ports: [
    { name: "NIC1", type: "RJ45" }, { name: "NIC2", type: "RJ45" }, { name: "NIC3", type: "RJ45" }, { name: "iDRAC", type: "Mgmt" }, { name: "PSU1", type: "Power" }, { name: "PSU2", type: "Power" }] } as Tpl;
  const d0 = put(doc, srv, r.id, 12, 0, "HV01"); d0.ip = "10.0.0.5"; d0.notes = "note"; d0.serial = "S1"; d0.auvik_id = "k1";
  const sw = put(doc, byName("Switch 24-port 1U"), r.id, 5, 0, "SW");
  const cab = (a: number, b: number, label: string) => { const c = newCable(doc, a, b); if (typeof c === "string") throw new Error(c); c.label = label; c.color = "#abcdef"; return c; };
  const c1 = cab(d0.ports[0].id, sw.ports[0].id, "c1");
  const c2 = cab(d0.ports[2].id, sw.ports[1].id, "c3");
  const c3 = cab(d0.ports[3].id, sw.ports[2].id, "mgmt");
  const c4 = cab(d0.ports[4].id, sw.ports[3].id, "pwr");
  d0.oobm = { name: "HV01-idrac", ip: "10.0.0.6", mac: "", key: "x", portId: d0.ports[3].id };
  const id0 = d0.id;
  const res = swapModel(doc, d0.id, tpl("HE250"));
  const d = doc.devices.find((x) => x.id === id0)!;
  t("swap ok", res.ok, res.msg);
  t("identity kept", d.name === "HV01" && d.ip === "10.0.0.5" && d.serial === "S1" && d.notes === "note" && !!d.auvik_id);
  t("size, half, plate applied", d.u_size === 2 && d.half && d.plate?.nuc === "he250" && d.face === "both");
  t("model set and locked", /HE250/.test(d.model || "") && !!d.locked?.includes("model"));
  const other = (c: { a: number; b: number }, o: number) => (c.a === o ? c.b : c.a);
  t("NIC1 cable -> LAN1", portNamed(d, "LAN1")!.id === other(c1, sw.ports[0].id));
  t("NIC3 cable -> LAN2 (type order)", portNamed(d, "LAN2")!.id === other(c2, sw.ports[1].id));
  t("power cable -> DC in", portNamed(d, "DC in")!.id === other(c4, sw.ports[3].id));
  t("cable ids, colours and labels kept", c1.label === "c1" && c1.color === "#abcdef" && doc.cables.length === 4);
  const mg = d.ports.find((p) => p.id === other(c3, sw.ports[2].id))!;
  t("unmappable cable kept on extra port", !!mg && mg.type === "Mgmt" && d.ports.indexOf(mg) >= 5, mg?.name);
  t("oobm port still resolves", d.oobm!.portId === mg.id);
  t("message counts extra cables", /1 cable kept on extra ports/.test(res.msg), res.msg);
  t("all cable ends exist", doc.cables.every((c) => [c.a, c.b].every((pid) => doc.devices.some((x) => x.ports.some((p) => p.id === pid)))));
  t("HE250 lands on a shelf", d.rack === r.id && doc.devices.some((x) => x.type === "Shelf" && x.rack === r.id && x.u === d.u), `u=${d.u}`);
  t("placement valid", checkPlace(doc, d, r, d.u, d.side).ok);
}
{
  const { doc, r } = mk();
  const filler = { name: "F", type: "Server", u_size: 19, color: "#444444", rows: 0, half: false, ports: [] } as Tpl;
  put(doc, filler, r.id, 1, 0, "FILL");
  const d = put(doc, byName("Server 1U"), r.id, 20, 0, "ONE");
  const before = JSON.stringify(doc);
  const res = swapModel(doc, d.id, tpl("HE250"));
  t("no room: refused with message", !res.ok && /No room/.test(res.msg), res.msg);
  t("no room: document untouched", JSON.stringify(doc) === before);
}

// ---- full rack: a 2U server boxed in above and below swaps to HE250 in its own slot
{
  const { doc, r } = mk();
  const filler = { name: "F", type: "Server", u_size: 9, color: "#444444", rows: 0, half: false, ports: [] } as Tpl;
  put(doc, filler, r.id, 1, 0, "LOW");
  const d = put(doc, byName("Server 2U"), r.id, 10, 0, "MID");
  put(doc, filler, r.id, 12, 0, "HIGH");
  const res = swapModel(doc, d.id, tpl("HE250"));
  const nd = doc.devices.find((x) => x.id === d.id)!;
  t("boxed-in swap fits its own slot", res.ok && nd.u === 10 && doc.devices.some((x) => x.type === "Shelf" && x.u === 10), res.msg);
}

// ---- 2U half-width shelf devices, side by side
{
  const { doc, r } = mk();
  const a = fromTpl(doc, tpl("HE250")), b = fromTpl(doc, tpl("HE150")), c = fromTpl(doc, tpl("HE250"));
  for (const x of [a, b, c]) x.face = "both";
  t("no shelf -> refused", !checkPlace(doc, { ...a, rack: r.id }, r, 10, 0).ok);
  const pa = placeOnShelf(doc, a, r); if (pa) doc.devices.push(a);
  t("placeOnShelf adds a shelf", pa && doc.devices.filter((x) => x.type === "Shelf").length === 1);
  const pb = placeOnShelf(doc, b, r); if (pb) doc.devices.push(b);
  t("second goes beside on the same shelf", pb && b.u === a.u && b.side !== a.side && doc.devices.filter((x) => x.type === "Shelf").length === 1);
  const pc = placeOnShelf(doc, c, r); if (pc) doc.devices.push(c);
  t("third gets its own shelf", pc && c.u !== a.u && doc.devices.filter((x) => x.type === "Shelf").length === 2);
  t("U above the shelf is taken", !checkPlace(doc, fromTpl(doc, byName("Server 1U")), r, a.u + 1, 0).ok);
}

// ---- importer matching
{
  const m = (model: string, name = "N1", type = "Hypervisor") => matchTemplate({ model, name, type }, "server");
  t("HE250 text matches", m("Scale Computing HE250").tpl.short === "HE250");
  t("NUC24OXG matches HE250", m("SNUC NUC24OXGv9").tpl.short === "HE250");
  t("HE150 text matches", m("Scale HE150").tpl.short === "HE150");
  t("NUC13OX matches HE150", m("SNUC NUC13OXi7").tpl.short === "HE150");
  t("Onyx matches", m("SNUC Onyx").tpl.short === "HE250");
  const pg = m("Pegatron", "HC3-NODE", "Hypervisor");
  t("Pegatron stays generic", pg.generic && pg.tpl.name === "Server 2U", pg.tpl.name);
}

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
