// npx tsx scripts/docx.test.ts — Word report export (synthetic data only)
import { longDate, markerValues, replaceMarkers, scanMarkers, xmlText, type MarkerValues } from "../src/report/docxMarkers";
import type { ReportModel } from "../src/report/model";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const ok = (name: string, c: boolean, info = "") => { if (!c) { fail++; console.log(`FAIL ${name} ${info}`); } };

// ---- markers ----
const V: MarkerValues = {
  CLIENT: "Example Client", SITE: "Head Office, Warehouse", DATE: "November 18, 2026",
  REPORT_TITLE: "Network review — Example Client", PREPARED_FOR: "Jane Example", PREPARED_BY: "Example IT",
  SUMMARY: "Line one\nLine two", RECOMMENDATIONS: "",
};
const doc = (b: string) => `<w:document xmlns:w="w" xmlns:mc="mc"><w:body>${b}<w:sectPr><w:pgSz/></w:sectPr></w:body></w:document>`;
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const texts = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
const count = (s: string, sub: string) => s.split(sub).length - 1;
const BODY = `<w:p><w:r><w:t>BODY</w:t></w:r></w:p>`;

{
  const o = replaceMarkers(doc(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{{CLI</w:t></w:r><w:r><w:t>ENT}}</w:t></w:r></w:p>`), V).xml;
  ok("split across 2 runs", o.includes(`<w:r><w:rPr><w:b/></w:rPr><w:t>Example Client</w:t></w:r>`) && !o.includes("{{"), o);
}
{
  const o = replaceMarkers(doc(`<w:p><w:r><w:t>{{</w:t></w:r><w:r><w:t>PREP</w:t></w:r><w:r><w:t>ARED_</w:t></w:r><w:r><w:t>FOR}} rest</w:t></w:r></w:p>`), V).xml;
  eq("split across 4 runs text", texts(o), "Jane Example rest");
  eq("split across 4 runs count", count(o, "<w:t"), 2 + count(o, "<w:tab"));
}
{
  const x = doc([["C", "CLIENT"], ["S1", "SITE"], ["D", "DATE"], ["T", "REPORT_TITLE"], ["F", "PREPARED_FOR"], ["B", "PREPARED_BY"], ["S", "SUMMARY"], ["R", "RECOMMENDATIONS"]]
    .map(([k, n]) => p(`${k}:{{${n}}};`)).join(""));
  eq("all markers", texts(replaceMarkers(x, V).xml),
    "C:Example Client;S1:Head Office, Warehouse;D:November 18, 2026;T:Network review — Example Client;F:Jane Example;B:Example IT;S:Line oneLine two;R:;");
}
eq("in a table cell", texts(replaceMarkers(doc(`<w:tbl><w:tr><w:tc>${p("{{CLIENT}}")}</w:tc></w:tr></w:tbl>`), V).xml), "Example Client");
eq("in a text box", texts(replaceMarkers(doc(`<w:p><w:r><w:pict><w:txbxContent>${p("{{CLIENT}}")}</w:txbxContent></w:pict></w:r></w:p>`), V).xml), "Example Client");
eq("in header", texts(replaceMarkers(`<w:hdr xmlns:w="w">${p("{{CLIENT}}")}</w:hdr>`, V).xml), "Example Client");
eq("in footer", texts(replaceMarkers(`<w:ftr xmlns:w="w">${p("{{DATE}}")}</w:ftr>`, V).xml), "November 18, 2026");
eq("shares a paragraph", texts(replaceMarkers(doc(p("Prepared for {{PREPARED_FOR}} today")), V).xml), "Prepared for Jane Example today");
eq("unknown and empty removed", texts(replaceMarkers(doc(p("A {{NOPE}}B{{RECOMMENDATIONS}} C")), V).xml), "A B C");
{
  const o = replaceMarkers(doc(p("{{CLIENT}}")), { ...V, CLIENT: `Example & Sons <EU> "x" 🙂\u0001\nSecond` }).xml;
  ok("escaping inline values", o.includes(`Example &amp; Sons &lt;EU&gt; &quot;x&quot; 🙂</w:t><w:br/><w:t>Second</w:t>`) && !o.includes("\u0001") && count(o, "<w:br/>") === 1, o);
}
eq("xmlText", xmlText(`a&b<c>"d"'e'\u0001\uD800\tz🙂`), "a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;\tz🙂");
{
  const x = doc(`<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>{{SUMMARY}}</w:t></w:r></w:p>`);
  const run = (t: string) => `<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>${t}</w:t></w:r></w:p>`;
  ok("summary alone", replaceMarkers(x, V).xml.includes(run("Line one") + run("Line two")), replaceMarkers(x, V).xml);
}
{
  const o = replaceMarkers(doc(p("Summary: {{SUMMARY}}")), V).xml;
  ok("summary inline", o.includes(`<w:t>Summary: Line one</w:t><w:br/><w:t>Line two</w:t>`) && count(o, "<w:p>") === 1, o);
}
{
  const r = replaceMarkers(doc(p("Before") + p("{{RACKWRIGHT}}") + p("After")), V, BODY);
  ok("rackwright alone", r.xml.includes(`Before</w:t></w:r></w:p>${BODY}<w:p><w:r><w:t>After`) && r.rackwright === "alone" && !r.xml.includes("{{"), r.xml);
}
{
  const r = replaceMarkers(doc(p("Intro {{RACKWRIGHT}}")), V, BODY);
  ok("rackwright shared", r.rackwright === "shared" && r.xml.includes(BODY) && !r.xml.includes("Intro"), r.xml);
}
{
  const r = replaceMarkers(doc(p("Text")), V, BODY);
  ok("rackwright missing", r.rackwright === "missing" && r.xml.includes(`${BODY}<w:sectPr><w:pgSz/></w:sectPr></w:body>`), r.xml);
  const r2 = replaceMarkers(`<w:document xmlns:w="w"><w:body>${p("T")}</w:body></w:document>`, V, BODY);
  ok("rackwright missing, no sectPr", r2.xml.endsWith(`${BODY}</w:body></w:document>`), r2.xml);
}
{
  const r = replaceMarkers(doc(`<w:p><w:pPr><w:sectPr><w:pgSz w:w="1"/></w:sectPr></w:pPr></w:p>`), V, BODY);
  ok("append before body sectPr", r.xml.includes(`</w:pPr></w:p>${BODY}<w:sectPr><w:pgSz/>`), r.xml);
}
{
  const r = replaceMarkers(doc(p("{{RACKWRIGHT}}") + p("x {{RACKWRIGHT}}")), V, BODY);
  ok("rackwright twice", count(r.xml, "BODY") === 1 && !r.xml.includes("{{") && r.rackwright === "alone", r.xml);
}
{
  const fb = `<mc:AlternateContent><mc:Choice>${p("{{RACKWRIGHT}}")}</mc:Choice><mc:Fallback>${p("{{RACKWRIGHT}}")}</mc:Fallback></mc:AlternateContent>`;
  const r = replaceMarkers(doc(fb), V, BODY);
  ok("rackwright in fallback", count(r.xml, "BODY") === 1 && r.xml.indexOf("BODY") < r.xml.indexOf("<mc:Fallback>") && !r.xml.includes("{{") && r.rackwright === "alone", r.xml);
  eq("scan counts Choice only", [...scanMarkers(doc(fb))], ["RACKWRIGHT"]);
  eq("scan ignores Fallback", [...scanMarkers(doc(`<mc:Fallback>${p("{{RACKWRIGHT}}")}</mc:Fallback>`))], []);
  const only = replaceMarkers(doc(`<mc:Fallback>${p("{{RACKWRIGHT}}")}</mc:Fallback>`), V, BODY);
  eq("fallback-only is missing", only.rackwright, "missing");
}
eq("scan split runs", [...scanMarkers(doc(`<w:p><w:r><w:t>{{CLI</w:t></w:r><w:r><w:t>ENT}} {{DATE}}</w:t></w:r></w:p>`))].sort(), ["CLIENT", "DATE"]);
{
  const x = `<w:hdr xmlns:w="w">${p("{{RACKWRIGHT}}")}</w:hdr>`;
  const r = replaceMarkers(x, V);
  eq("no body given", [r.rackwright, r.xml], ["missing", `<w:hdr xmlns:w="w"><w:p><w:r></w:r></w:p></w:hdr>`]);
}
{
  const o = replaceMarkers(doc(`<w:p><w:r><w:t>{{CLI</w:t><w:tab/><w:t>ENT}} </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> {{CLIENT}} </w:instrText></w:r></w:p>`), V).xml;
  ok("non-text run children survive", o.includes("<w:tab/>") && o.includes("<w:instrText> {{CLIENT}} </w:instrText>") && texts(o) === "Example Client ", o);
}
{
  const o = replaceMarkers(doc(`<w:p><w:r><w:t>A {{CLIENT}}</w:t></w:r><w:r><w:pict><w:txbxContent>${p("{{DATE}}")}</w:txbxContent></w:pict></w:r></w:p>`), V).xml;
  ok("nested paragraphs", o.includes("<w:t>A Example Client</w:t>") && o.includes("<w:t>November 18, 2026</w:t>") && !o.includes("{{"), o);
}
{
  const odd = `<w:p  w:rsidR="00A1" >\n <w:r  ><w:t   xml:space="preserve">  odd  </w:t></w:r></w:p>`;
  const o = replaceMarkers(doc(odd + p("{{CLIENT}}")), V).xml;
  ok("untouched bytes", o.includes(odd), o);
}
eq("longDate", [longDate("2026-11-18"), longDate("2026-01-05"), longDate("soon")], ["November 18, 2026", "January 5, 2026", "soon"]);
{
  const m = { title: "T", date: "2026-11-18", preparedFor: "F", preparedBy: "B", summary: "S", recommendations: "R", client: { name: "Example Client" }, sites: [{ name: "Head Office" }, { name: "Warehouse" }] } as unknown as ReportModel;
  eq("markerValues", markerValues(m), { CLIENT: "Example Client", SITE: "Head Office, Warehouse", DATE: "November 18, 2026", REPORT_TITLE: "T", PREPARED_FOR: "F", PREPARED_BY: "B", SUMMARY: "S", RECOMMENDATIONS: "R" });
}

process.exit(fail ? 1 : 0);
