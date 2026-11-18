import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { parseVsdx } from "../src/imports/vsdx";
import { diagramToSpec } from "../src/imports/diagram";
import { buildVsdx } from "../src/export/vsdx";
import { Doc, Route } from "../src/types";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

const cells = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `<Cell N="${k}" V="${v}"/>`).join("");
const box = (x: number, y: number, w = 2, h = 1) => cells({ PinX: x + w / 2, PinY: y + h / 2, Width: w, Height: h, LocPinX: w / 2, LocPinY: h / 2 });

async function make(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file("visio/masters/masters.xml", `<Masters xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Master ID="1" NameU="Switch"/><Master ID="2" NameU="Server"/></Masters>`);
  z.file("visio/pages/pages.xml", `<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Page ID="0" NameU="Rack" Name="Rack"/></Pages>`);
  z.file("visio/pages/page1.xml", `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Shapes>
    <Shape ID="1" Master="1">${box(0, 5)}<Section N="Property"><Row N="NetName"><Cell N="Label" V="Network Name"/><Cell N="Value" V="EX-SW01"/></Row></Section></Shape>
    <Shape ID="2" Master="2">${box(6, 5)}<Text>EX-SRV01</Text></Shape>
    <Shape ID="7">${box(0, 8)}<Text>0012</Text></Shape>
    <Shape ID="3" Type="Group">${box(0, 0, 3, 2)}<Shapes><Shape ID="4">${cells({ PinX: 1, PinY: 1, Width: 1, Height: 1 })}<Text>Example <cp IX="0"/>Firewall</Text></Shape></Shapes></Shape>
    <Shape ID="5">${cells({ PinX: 4, PinY: 5.5, Width: 2, Height: 0, BeginX: 2, BeginY: 5.5, EndX: 6, EndY: 5.5 })}</Shape>
    <Shape ID="6">${cells({ PinX: 3, PinY: 1, Width: 3, Height: 0, BeginX: 3, BeginY: 1, EndX: 6.1, EndY: 5.4 })}</Shape>
  </Shapes><Connects><Connect FromSheet="5" FromCell="BeginX" ToSheet="1"/><Connect FromSheet="5" FromCell="EndX" ToSheet="2"/></Connects></PageContents>`);
  return z.generateAsync({ type: "uint8array" });
}

const bytes = await make();
const models = await parseVsdx(bytes, "test.vsdx");
const m = models[0];
t("pages read", models.length === 1 && m.source === "test.vsdx · Rack" && m.yUp === true, m.source);
const sw = m.nodes.find((n) => n.id === "1")!;
t("master name as title", sw.title === "Switch");
t("shape data", JSON.stringify(sw.data) === JSON.stringify({ "Network Name": "EX-SW01" }));
const grp = m.nodes.find((n) => n.id === "3")!;
t("group text rolled up", grp.label === "Example Firewall", JSON.stringify(grp.label));
t("glued connector", m.links.some((l) => l.a === "1" && l.b === "2"));
t("unglued connector near a shape", m.links.some((l) => l.a === "3" && l.b === "2"), JSON.stringify(m.links));
t("numeric-looking text kept", m.nodes.find((n) => n.id === "7")?.label === "0012");
t("two links only", m.links.length === 2);
let err = "";
try { await parseVsdx(new TextEncoder().encode("hello"), "x.vsdx"); } catch (e) { err = (e as Error).message; }
t("not a zip", err === "not a .vsdx file", err);
err = "";
try { const z = new JSZip(); z.file("a.txt", "x"); await parseVsdx(await z.generateAsync({ type: "uint8array" }), "x.vsdx"); } catch (e) { err = (e as Error).message; }
t("no pages", err === "no drawing pages found", err);

const spec = diagramToSpec(models, { endUsers: true });
const names = spec.devices.map((d) => d.name);
t("vsdx to spec", names.includes("EX-SW01") && names.some((n) => /EX-SRV01/.test(n)) && spec.links.length >= 1, names.join(","));

// Round trip through Rackwright's own export.
const doc: Doc = JSON.parse(readFileSync(new URL("../../Homelab.rack.json", import.meta.url), "utf8"));
const stub = () => ({ routes: doc.cables.map((c, i) => ({ cable: c.id, pts: [[40 + i, 100], [40 + i, 160 + i * 3], [90 + i, 160 + i * 3]] as [number, number][], mode: "stub", dir_a: 1, dir_b: 1 })) as Route[], hints: [] as [] });
const out = await buildVsdx(doc, { front: stub(), rear: stub(), ports: [] }, "Homelab");
const ms = await parseVsdx(out, "Homelab.vsdx");
t("export round trip pages", ms.length === 3 && ms[2].source === "Homelab.vsdx · Logical", ms.map((x) => x.source).join("|"));
const logical = ms[2];
const missing = doc.devices.filter((d) => !logical.nodes.some((n) => n.label.split("\n")[0] === d.name));
t("every device on Logical page", missing.length === 0, missing.map((d) => d.name).join(","));
// The export draws cables as open polylines (no BeginX/EndX, no Connect glue), so they read as plain shapes, not links.
t("export cables are not links (known limit)", logical.links.length === 0);

{
  const pc = `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Shapes><Shape ID="1">${box(0, 0)}<Text>EX-SW01</Text></Shape></Shapes></PageContents>`;
  const zipOf = async (n: number, pad = "") => { const z = new JSZip(); for (let i = 1; i <= n; i++) z.file(`visio/pages/page${i}.xml`, pc + pad); return z.generateAsync({ type: "uint8array", compression: "DEFLATE" }); };
  const lim = { part: 1000, total: 1500, pages: 3 };
  const msg = async (b: Uint8Array) => { try { await parseVsdx(b, "x.vsdx", lim); return "ok"; } catch (e) { return (e as Error).message; } };
  t("big part refused", await msg(await zipOf(1, " ".repeat(5000))) === "the drawing is too big");
  t("total over limit refused", await msg(await zipOf(3, " ".repeat(400))) === "the drawing is too big");
  t("too many pages refused", await msg(await zipOf(4)) === "the drawing is too big");
  { // the zip header claims a small size, the data is large
    const big = await JSZip.loadAsync(await zipOf(1, " ".repeat(5000)));
    const ent = big.file("visio/pages/page1.xml") as unknown as { _data: { uncompressedSize: number } };
    ent._data.uncompressedSize = 10;
    let m2 = "ok"; try { await parseVsdx(big, "x.vsdx", lim); } catch (e) { m2 = (e as Error).message; }
    t("lying size header still refused", m2 === "the drawing is too big", m2);
  }
  t("small drawing within limits", await msg(await zipOf(2)) === "ok");
}
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
