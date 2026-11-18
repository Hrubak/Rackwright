import JSZip from "jszip";
import { kindOf, fmtSize, readDiagramFiles } from "../src/imports/files";
import type { FileLike } from "../src/imports/files";
import { readerError } from "../src/imports/readers";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

const cases: [string, ReturnType<typeof kindOf>][] = [
  ["a.vsdx", "Visio"], ["A.VSDX", "Visio"], ["a.vsd", "Visio (old)"], ["a.vdx", "Visio (old)"], ["a.vsdm", "Visio (old)"],
  ["a.svg", "SVG"], ["a.pdf", "PDF"], ["a.png", "Picture"], ["a.jpg", "Picture"], ["a.jpeg", "Picture"], ["a.webp", "Picture"],
  ["a.gif", "Picture"], ["a.bmp", "Picture"], ["a.txt", "Text"], ["a.csv", "Text"], ["a.tsv", "Text"], ["a.md", "Text"],
  ["Thumbs.db", null], ["a.docx", null], ["noext", null], ["dir/x.svg", "SVG"],
];
cases.forEach(([n, k]) => t("kindOf " + n, kindOf(n) === k));
t("fmtSize KB", fmtSize(12_000) === "12 KB", fmtSize(12_000));
t("fmtSize MB", fmtSize(1_468_006) === "1.4 MB", fmtSize(1_468_006));

const bytesOf = (s: string) => new TextEncoder().encode(s);
const fake = (name: string, body: string | Uint8Array = "", size?: number): FileLike => {
  const u = typeof body === "string" ? bytesOf(body) : body;
  return { name, size: size ?? u.length, text: async () => new TextDecoder().decode(u), arrayBuffer: async () => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer };
};

const cells = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `<Cell N="${k}" V="${v}"/>`).join("");
const box = (x: number, y: number, w = 2, h = 1) => cells({ PinX: x + w / 2, PinY: y + h / 2, Width: w, Height: h, LocPinX: w / 2, LocPinY: h / 2 });
async function makeVsdx(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file("visio/masters/masters.xml", `<Masters xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Master ID="1" NameU="Switch"/><Master ID="2" NameU="Server"/></Masters>`);
  z.file("visio/pages/pages.xml", `<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Page ID="0" NameU="Rack" Name="Rack"/></Pages>`);
  z.file("visio/pages/page1.xml", `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"><Shapes>
    <Shape ID="1" Master="1">${box(0, 5)}<Text>EX-SW01</Text></Shape>
    <Shape ID="2" Master="2">${box(6, 5)}<Text>EX-SRV01</Text></Shape>
    <Shape ID="5">${cells({ PinX: 4, PinY: 5.5, Width: 2, Height: 0, BeginX: 2, BeginY: 5.5, EndX: 6, EndY: 5.5 })}</Shape>
  </Shapes><Connects><Connect FromSheet="5" FromCell="BeginX" ToSheet="1"/><Connect FromSheet="5" FromCell="EndX" ToSheet="2"/></Connects></PageContents>`);
  return z.generateAsync({ type: "uint8array" });
}

(async () => {
  const say: string[] = [];
  const o = { endUsers: false, say: (s: string) => { say.push(s); } };

  // junk folder: text list + old Visio + docx
  const spec = await readDiagramFiles([fake("Example IT/rack.txt", "42U\nEX-SW01\nEX-SRV01\n"), fake("Example IT/x.vsd", "zz"), fake("Example IT/x.docx", "zz")], o);
  t("text devices read", spec.devices.some((d) => d.name === "EX-SW01") && spec.devices.some((d) => d.name === "EX-SRV01"), spec.devices.map((d) => d.name).join(","));
  t("old visio warning", spec.warnings.includes("Example IT/x.vsd: old Visio file — open it in Visio and save it as .vsdx first."), spec.warnings.join("|"));
  t("docx warning", spec.warnings.includes("Example IT/x.docx: this kind of file can't be read — skipped."));
  t("status line", say.includes("Reading Example IT/rack.txt…"));

  // nothing readable
  let err = "";
  try { await readDiagramFiles([fake("Thumbs.db"), fake("a.vsd")], o); } catch (e) { err = (e as Error).message; }
  t("none readable error", err === "None of these files can be read — add a .vsdx, .svg, .pdf or picture file.", err);

  // vsdx + text merge, shared name once
  const vs = await makeVsdx();
  const m = await readDiagramFiles([fake("a.vsdx", vs), fake("b.txt", "42U\nex-sw01\nEX-NAS01\n")], { ...o, endUsers: true });
  const names = m.devices.map((d) => d.name);
  t("merged kind diagram", m.kind === "diagram", m.kind);
  t("shared name once", names.filter((n) => n.toLowerCase().replace(/[^a-z0-9]/g, "") === "exsw01").length === 1, names.join(","));
  t("both sources present", names.includes("EX-SRV01") && names.includes("EX-NAS01"), names.join(","));
  t("lines run 1..n", m.devices.every((d, i) => d.line === i + 1), m.devices.map((d) => d.line).join(","));
  t("link kept", m.links.length === 1);

  // reader failures, desktop and web wording
  const bad = { pdf: async () => { throw readerError("offline"); }, picture: async () => { throw readerError("offline"); } };
  const w1 = await readDiagramFiles([fake("a.vsdx", vs), fake("a.pdf", "x"), fake("a.png", "x")], { ...o, readers: bad });
  t("pdf reader warning desktop", w1.warnings.includes("a.pdf: the PDF reader couldn't load. Check the internet connection and try again."), w1.warnings.join("|"));
  t("picture reader warning desktop", w1.warnings.includes("a.png: the picture reader couldn't load. Check the internet connection and try again."));
  t("other file still imported", w1.devices.length >= 2);
  const w2 = await readDiagramFiles([fake("a.vsdx", vs), fake("a.png", "x")], { ...o, web: true, readers: bad });
  t("picture reader warning web", w2.warnings.includes("a.png: the picture reader couldn't load. Try again."), w2.warnings.join("|"));

  // PDF text, empty svg, no equipment, size cap
  const pdfOk = { pdf: async () => "42U\nEX-FW01\n" };
  const p = await readDiagramFiles([fake("a.pdf", "x")], { ...o, readers: pdfOk });
  t("pdf text read", p.devices.some((d) => d.name === "EX-FW01"));
  const e1 = await readDiagramFiles([fake("a.vsdx", vs), fake("e.pdf", "x")], { ...o, readers: { pdf: async () => "  " } });
  t("pdf no text warning", e1.warnings.includes("e.pdf: no readable text was found."));
  const sv = { svg: async (_t: string, n: string) => ({ source: n, nodes: [], links: [], yUp: false }) };
  err = ""; try { await readDiagramFiles([fake("e.svg", "<svg/>")], { ...o, readers: sv }); } catch (e) { err = (e as Error).message; }
  t("no equipment error", err === "No equipment was found in these files.", err);
  const e2 = await readDiagramFiles([fake("a.vsdx", vs), fake("e.svg", "<svg/>")], { ...o, readers: sv });
  t("no shapes warning", e2.warnings.includes("e.svg: no shapes found."));
  const big = await readDiagramFiles([fake("a.vsdx", vs), fake("big.png", "", 51 * 1024 * 1024)], o);
  t("50 MB cap", big.warnings.includes("big.png: the file is over 50 MB — skipped."));


  // per-device off-rack flag in a mixed set; warnings travel with the errors; skipped-file grouping
  {
    const mk = (n: string, t: string, l: string, x: number) => ({ id: n, title: t, label: l, data: {}, x, y: 0, w: 5, h: 5 });
    const svgOk = { svg: async (_t: string, n: string) => ({ source: n, nodes: [mk("a", "Switch", "EX-SW09", 100), mk("b", "Server", "EX-SRV09", 120)], links: [], yUp: false }) };
    const mx = await readDiagramFiles([fake("a.svg", "<svg/>"), fake("b.txt", "42U\nEX-TXT01\n")], { ...o, readers: svgOk });
    const dv = mx.devices.find((d) => d.name === "EX-SW09")!, tx = mx.devices.find((d) => d.name === "EX-TXT01")!;
    t("diagram device offRackIfNew, text device not", dv?.offRackIfNew === true && !!tx && !tx.offRackIfNew, JSON.stringify([dv?.offRackIfNew, tx?.offRackIfNew]));
  }
  {
    let er: unknown = null;
    try { await readDiagramFiles([fake("a.png", "x")], { ...o, readers: bad }); } catch (e) { er = e; }
    const w = (er as { warnings?: string[] })?.warnings ?? [];
    t("error carries reader warning", w.includes("a.png: the picture reader couldn't load. Check the internet connection and try again."), w.join("|"));
    er = null;
    try { await readDiagramFiles([fake("a.vsd", "x")], o); } catch (e) { er = e; }
    t("lone .vsd error carries old-Visio warning", ((er as { warnings?: string[] })?.warnings ?? []).some((x) => /old Visio file/.test(x)));
    const junk = Array.from({ length: 13 }, (_, i) => fake(`j${i}.dat`, "x"));
    const g = await readDiagramFiles([fake("a.vsdx", vs), ...junk], o);
    t("skipped warnings grouped", g.warnings.filter((x) => /can't be read — skipped/.test(x)).length === 10 && g.warnings.includes("3 other files were skipped."), g.warnings.length + "");
  }
  console.log(fails ? `${fails} failed` : "0 failed");
  if (fails) process.exit(1);
})();
