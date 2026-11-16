import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import { buildVsdx } from "../src/export/vsdx";
import { Doc, Route } from "../src/types";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

const doc: Doc = JSON.parse(readFileSync(new URL("../../Homelab.rack.json", import.meta.url), "utf8"));
// Stub routes: a simple 3-point polyline per cable (the real router runs in Rust).
const stub = (): { routes: Route[]; hints: [] } => ({
  routes: doc.cables.map((c, i) => ({ cable: c.id, pts: [[40 + i, 100], [40 + i, 160 + i * 3], [90 + i, 160 + i * 3]] as [number, number][], mode: "stub", dir_a: 1, dir_b: 1 })),
  hints: [],
});
const data = { front: stub(), rear: stub(), ports: [] };

const bytes = await buildVsdx(doc, data, "Homelab & <test>");
const zip = await JSZip.loadAsync(bytes);
const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
console.log("parts:", names.join(", "));

const required = ["[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml", "visio/document.xml", "visio/_rels/document.xml.rels",
  "visio/pages/pages.xml", "visio/pages/_rels/pages.xml.rels", "visio/pages/page1.xml", "visio/pages/page2.xml", "visio/pages/page3.xml", "visio/windows.xml"];
for (const r of required) t("part present: " + r, names.includes(r));

const text = async (n: string) => zip.file(n)!.async("string");

// Content types cover every part.
const ct = await text("[Content_Types].xml");
const defaults = new Set([...ct.matchAll(/<Default Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
const overrides = new Set([...ct.matchAll(/<Override PartName="([^"]+)"/g)].map((m) => m[1]));
for (const n of names) {
  if (n === "[Content_Types].xml") continue;
  t("content type covers /" + n, overrides.has("/" + n) || defaults.has(n.split(".").pop()!.toLowerCase()));
}
for (const o of overrides) t("override target exists " + o, names.includes(o.slice(1)));

// Relationship targets exist.
for (const n of names.filter((x) => x.endsWith(".rels"))) {
  const base = n.replace(/_rels\/[^/]*$/, "");
  for (const m of (await text(n)).matchAll(/Target="([^"]+)"/g)) {
    const parts = (base + m[1]).split("/"), out: string[] = [];
    for (const p of parts) { if (p === "..") out.pop(); else if (p) out.push(p); }
    t(`${n} -> ${m[1]}`, names.includes(out.join("/")));
  }
}

// Well-formed XML.
for (const n of names) {
  const v = XMLValidator.validate(await text(n));
  t("well-formed " + n, v === true, v === true ? "" : JSON.stringify(v));
}

// Shape IDs unique per page; page sizes positive; content present.
const pagesXml = await text("visio/pages/pages.xml");
const sizes = [...pagesXml.matchAll(/N="PageWidth" V="([^"]+)"\/><Cell N="PageHeight" V="([^"]+)"/g)];
t("three pages", sizes.length === 3, String(sizes.length));
for (const m of sizes) t("page size positive", +m[1] > 0 && +m[2] > 0, `${m[1]} x ${m[2]}in`);
for (const i of [1, 2, 3]) {
  const x = await text(`visio/pages/page${i}.xml`);
  const ids = [...x.matchAll(/<Shape ID="(\d+)"/g)].map((m) => m[1]);
  t(`page${i} shape IDs unique`, ids.length > 0 && new Set(ids).size === ids.length, `${ids.length} shapes`);
}
const p3 = await text("visio/pages/page3.xml");
t("logical page has every device", (p3.match(/<Text>/g) || []).length === doc.devices.length);
t("title escaped", (await text("docProps/core.xml")).includes("Homelab &amp; &lt;test&gt;"));

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
