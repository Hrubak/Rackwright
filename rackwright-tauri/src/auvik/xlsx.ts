// Minimal .xlsx reader: sheet name -> rows of strings. Lazy-loads jszip and fast-xml-parser so they stay out of the main bundle.

export type Sheets = { name: string; rows: string[][] }[];

type Node = any;
const arr = (x: Node): Node[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** Text of a <t> element: plain string, or { "#text": "..." } when it carries xml:space. */
const tText = (t: Node): string => {
  if (t == null) return "";
  if (typeof t === "object") return t["#text"] == null ? "" : String(t["#text"]);
  return String(t);
};
/** Text of a shared/inline string item: <t> or several rich-text runs <r><t>. */
const siText = (si: Node): string => {
  if (si == null) return "";
  if (typeof si === "string") return si;
  let s = arr(si.t).map(tText).join("");
  for (const r of arr(si.r)) s += arr(r.t).map(tText).join("");
  return s;
};

/** "AA12" -> column index 26 (0-based). */
export function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

const norm = (p: string) => p.replace(/^\/+/, "");

export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<Sheets> {
  const [{ default: JSZip }, { XMLParser }] = await Promise.all([import("jszip"), import("fast-xml-parser")]);
  const zip = await JSZip.loadAsync(data);
  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, parseAttributeValue: false, trimValues: false,
    isArray: (name) => ["sheet", "Relationship", "si", "r", "row", "c", "t"].includes(name),
  });
  const read = async (path: string) => {
    const f = zip.file(norm(path));
    return f ? parser.parse(await f.async("string")) : null;
  };

  const wb = await read("xl/workbook.xml");
  if (!wb) throw new Error("This is not an Excel (.xlsx) file.");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const target = new Map<string, string>();
  for (const r of arr(rels?.Relationships?.Relationship)) {
    const t = String(r["@_Target"] || "");
    target.set(String(r["@_Id"]), t.startsWith("/") ? norm(t) : "xl/" + t.replace(/^\.\//, ""));
  }

  const ss = await read("xl/sharedStrings.xml");
  const shared: string[] = arr(ss?.sst?.si).map(siText);

  const out: Sheets = [];
  for (const sh of arr(wb.workbook?.sheets?.sheet)) {
    const name = String(sh["@_name"] ?? "");
    const rid = sh["@_r:id"] ?? sh["@_id"];
    const path = target.get(String(rid));
    const x = path ? await read(path) : null;
    const rows: string[][] = [];
    let seq = 0;
    for (const row of arr(x?.worksheet?.sheetData?.row)) {
      const ri = row["@_r"] ? parseInt(row["@_r"]) - 1 : seq;
      seq = ri + 1;
      const cells: string[] = [];
      let cseq = 0;
      for (const c of arr(row.c)) {
        const ci = c["@_r"] ? colIndex(String(c["@_r"])) : cseq;
        cseq = ci + 1;
        const type = c["@_t"];
        let v = "";
        if (type === "inlineStr") v = siText(c.is);
        else if (c.v != null) {
          const raw = typeof c.v === "object" ? tText(c.v) : String(c.v);
          v = type === "s" ? shared[parseInt(raw)] ?? "" : type === "b" ? (raw === "1" ? "TRUE" : "FALSE") : raw;
        }
        while (cells.length < ci) cells.push("");
        cells[ci] = v;
      }
      while (rows.length < ri) rows.push([]);
      rows[ri] = cells;
    }
    out.push({ name, rows });
  }
  return out;
}
