import { readFileSync } from "node:fs";
import { READER_SHA384, sha384b64, fetchVerified, readerBase, retrying, withTimeout, probeReader, checkReaderResponse, isReaderError } from "../src/imports/readers";
import { itemsToLines } from "../src/imports/pdf";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

const d = readerBase(false);
t("pdf url", d.pdf === "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
t("pdf worker url", d.pdfWorker === "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs");
t("tesseract url", d.tess === "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js");
t("tesseract worker url", d.tessWorker === "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js");
t("core url", d.tessCore === "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/");
t("lang url", d.lang === "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/");
t("default (Node, not web) is the CDN", readerBase().pdf === d.pdf);
const w = readerBase(true);
t("web paths", w.pdf === "/readers/pdfjs/pdf.min.mjs" && w.pdfWorker === "/readers/pdfjs/pdf.worker.min.mjs" && w.tess === "/readers/tesseract/tesseract.min.js"
  && w.tessWorker === "/readers/tesseract/worker.min.js" && w.tessCore === "/readers/tesseract-core/" && w.lang === "/readers/eng/");

(async () => {
  // retrying: a failure is forgotten, a success is kept
  let calls = 0;
  const load = retrying(async () => { calls++; if (calls === 1) throw new Error("reader: offline"); return "ok"; });
  let first = ""; try { await load(); } catch (e) { first = (e as Error).message; }
  t("first call rejects", first === "reader: offline");
  t("second call tries again", (await load()) === "ok" && calls === 2);
  t("success is cached", (await load()) === "ok" && calls === 2);

  // probe with an injected fetch
  const hdr = (ct: string) => ({ get: (n: string) => (n.toLowerCase() === "content-type" ? ct : null) });
  let n = 0;
  const flaky = async () => { n++; if (n === 1) throw new Error("network down"); return { ok: true, status: 200, headers: hdr("application/javascript") }; };
  const probe = retrying(() => probeReader("/readers/x.js", flaky));
  let err: unknown = null; try { await probe(); } catch (e) { err = e; }
  t("failing fetch rejects with a reader error", isReaderError(err), String((err as Error)?.message));
  await probe();
  t("probe retried after failure", n === 2);
  let htmlErr: unknown = null;
  try { await probeReader("/readers/x.js", async () => ({ ok: true, status: 200, headers: hdr("text/html; charset=utf-8") })); } catch (e) { htmlErr = e; }
  t("index.html fallback (200 text/html) is rejected", isReaderError(htmlErr));
  let missing: unknown = null; try { checkReaderResponse({ ok: false, status: 404, headers: hdr("") }); } catch (e) { missing = e; }
  t("404 is rejected", isReaderError(missing));
  t("plain file passes", (() => { try { checkReaderResponse({ ok: true, status: 200, headers: hdr("application/gzip") }); return true; } catch { return false; } })());

  // a worker that died: reset, then the next get builds a new one
  let built = 0;
  const wk = retrying(async () => ({ id: ++built }));
  const w1 = await wk(); wk.reset(); const w2 = await wk();
  t("reset builds a new one", w1.id === 1 && w2.id === 2 && (await wk()).id === 2);

  let late = 0;
  let to: unknown = null;
  try { await withTimeout(new Promise<number>((r) => setTimeout(() => r(7), 80)), 10, (v) => { late = v; }); } catch (e) { to = e; }
  await new Promise((r) => setTimeout(r, 120));
  t("timeout rejects as reader error and hands over the late value", isReaderError(to) && late === 7);

  // pinned hashes match the npm files they were taken from
  const file = (p: string) => { const b = readFileSync(new URL("../node_modules/" + p, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
  t("pdf.min.mjs hash is current", (await sha384b64(file("pdfjs-dist/build/pdf.min.mjs"))) === READER_SHA384.pdf);
  t("tesseract.min.js hash is current", (await sha384b64(file("tesseract.js/dist/tesseract.min.js"))) === READER_SHA384.tess);
  const serve = (buf: ArrayBuffer) => async () => ({ ok: true, status: 200, arrayBuffer: async () => buf });
  t("right body accepted", (await fetchVerified("u", READER_SHA384.pdf, serve(file("pdfjs-dist/build/pdf.min.mjs")))).byteLength > 1000);
  let bad: unknown = null; try { await fetchVerified("u", READER_SHA384.pdf, serve(new TextEncoder().encode("alert(1)").buffer as ArrayBuffer)); } catch (e) { bad = e; }
  t("wrong body rejected as reader error", isReaderError(bad));

  // pdf text lines
  const it = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y] });
  const lines = itemsToLines([it("10.0.0.2", 200, 700), it("EX-SW01", 50, 701), it("Rack A", 50, 740), it("  ", 1, 1), it("EX-SRV01", 50, 650)]);
  t("pdf lines sorted top-down, left-right", JSON.stringify(lines) === JSON.stringify(["Rack A", "EX-SW01   10.0.0.2", "EX-SRV01"]), JSON.stringify(lines));

  console.log(fails ? `readers: ${fails} failed` : "readers: all passed");
  if (fails) process.exit(1);
})();
