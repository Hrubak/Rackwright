// Loads the PDF reader (pdf.js) and the picture reader (tesseract.js) the first time they are needed.
// The npm packages are never imported here, so they stay out of the bundle: desktop and dev fetch pinned
// files from jsDelivr, the web build serves the same files from /readers/ (copied by vite.config.ts).

// Same test as IS_WEB in backend.ts, read directly so this file also loads under the Node tests.
const env = (import.meta as { env?: Record<string, unknown> }).env;
const webProduction = (): boolean => !!env && env.VITE_TARGET === "web" && !env.DEV;

export interface ReaderBase { pdf: string; pdfWorker: string; tess: string; tessWorker: string; tessCore: string; lang: string }

const CDN = "https://cdn.jsdelivr.net/npm/";
export function readerBase(web: boolean = webProduction()): ReaderBase {
  if (web) return {
    pdf: "/readers/pdfjs/pdf.min.mjs", pdfWorker: "/readers/pdfjs/pdf.worker.min.mjs",
    tess: "/readers/tesseract/tesseract.min.js", tessWorker: "/readers/tesseract/worker.min.js",
    tessCore: "/readers/tesseract-core/", lang: "/readers/eng/",
  };
  return {
    pdf: CDN + "pdfjs-dist@4.10.38/build/pdf.min.mjs", pdfWorker: CDN + "pdfjs-dist@4.10.38/build/pdf.worker.min.mjs",
    tess: CDN + "tesseract.js@7.0.0/dist/tesseract.min.js", tessWorker: CDN + "tesseract.js@7.0.0/dist/worker.min.js",
    tessCore: CDN + "tesseract.js-core@7.0.0/", lang: CDN + "@tesseract.js-data/eng@1.0.0/4.0.0_best_int/",
  };
}

/** SHA-384 (base64) of the two files that run in the main window, from the pinned npm packages (jsDelivr and /readers/ serve them byte for byte). */
export const READER_SHA384 = {
  pdf: "+0ti2moQlmLN7WZHE2RHIf5lV8hHxhxEalN0il3YZceG26fUPyOkR0hp9daxk1i7", // pdfjs-dist@4.10.38 build/pdf.min.mjs
  tess: "2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM", // tesseract.js@7.0.0 dist/tesseract.min.js
};

/** The error every reader failure ends in; the dialog turns it into the "couldn't load" warning. */
export const readerError = (why = ""): Error => new Error("reader" + (why ? ": " + why : ""));
export const isReaderError = (e: unknown): boolean => e instanceof Error && /^reader\b/.test(e.message);

/** Wraps a loader so a success is kept and a failure is forgotten: the next call tries again. `reset()` forgets a success too (a dead worker). */
export type Retrying<T> = (() => Promise<T>) & { reset(): void };
export function retrying<T>(fn: () => Promise<T>): Retrying<T> {
  let p: Promise<T> | null = null;
  const get = (() => {
    if (!p) { const mine: Promise<T> = fn().catch((e) => { if (p === mine) p = null; throw e; }); p = mine; }
    return p;
  }) as Retrying<T>;
  get.reset = () => { p = null; };
  return get;
}

/** Rejects with readerError("timeout") when `p` takes longer than `ms`; `onLate` gets the value if it arrives afterwards. */
export function withTimeout<T>(p: Promise<T>, ms: number, onLate?: (v: T) => void): Promise<T> {
  return new Promise<T>((res, rej) => {
    let done = false;
    const t = setTimeout(() => { done = true; rej(readerError("timeout")); }, ms);
    p.then((v) => { clearTimeout(t); if (done) onLate?.(v); else { done = true; res(v); } },
      (e) => { clearTimeout(t); if (!done) { done = true; rej(e); } });
  });
}

interface ResponseLike { ok: boolean; status: number; headers: { get(n: string): string | null } }
/** A missing /readers/ file on the web is answered with index.html (200, text/html). That is a failure too. */
export function checkReaderResponse(res: ResponseLike): void {
  if (!res.ok) throw readerError("HTTP " + res.status);
  if (/text\/html/i.test(res.headers.get("content-type") || "")) throw readerError("got a web page instead of the file");
}
export async function probeReader(url: string, fetchFn: (u: string) => Promise<ResponseLike> = (u) => fetch(u, { method: "HEAD" })): Promise<void> {
  let res: ResponseLike;
  try { res = await fetchFn(url); } catch (e) { throw readerError(String((e as Error)?.message || e)); }
  checkReaderResponse(res);
}

export async function sha384b64(bytes: ArrayBuffer): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-384", bytes));
  let bin = ""; h.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
/** Fetches a file and rejects (as a reader failure) unless its SHA-384 is the expected one. */
export async function fetchVerified(url: string, sha384: string, fetchFn: (u: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }> = (u) => fetch(u)): Promise<ArrayBuffer> {
  let res;
  try { res = await fetchFn(url); } catch (e) { throw readerError(String((e as Error)?.message || e)); }
  if (!res.ok) throw readerError("HTTP " + res.status);
  const buf = await res.arrayBuffer();
  if ((await sha384b64(buf)) !== sha384) throw readerError("the file is not the expected one");
  return buf;
}

// ---- minimal types for the two libraries ----
export interface PdfTextItem { str: string; transform: number[] }
export interface PdfPage { getTextContent(): Promise<{ items: PdfTextItem[] }> }
export interface PdfDoc { numPages: number; destroy?(): Promise<void>; getPage(n: number): Promise<PdfPage> }
export interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): { promise: Promise<PdfDoc>; destroy?(): Promise<void> };
}
export interface TessWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(image: Blob | HTMLCanvasElement, options?: Record<string, unknown>, output?: Record<string, boolean>): Promise<{ data: { tsv?: string | null } }>;
  terminate(): Promise<unknown>;
}

export const PDF_TIMEOUT_MS = 60_000, TESS_TIMEOUT_MS = 180_000;

export const loadPdfJs = retrying<PdfJs>(async () => {
  const b = readerBase();
  try {
    return await withTimeout((async () => {
      if (webProduction()) { await probeReader(b.pdf); await probeReader(b.pdfWorker); }
      const code = await fetchVerified(b.pdf, READER_SHA384.pdf);
      const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      let lib: PdfJs;
      try { lib = (await import(/* @vite-ignore */ blobUrl)) as PdfJs; } finally { URL.revokeObjectURL(blobUrl); }
      if (!lib || !lib.getDocument) throw readerError("unusable");
      lib.GlobalWorkerOptions.workerSrc = b.pdfWorker;
      return lib;
    })(), PDF_TIMEOUT_MS);
  } catch (e) { throw isReaderError(e) ? e : readerError(String((e as Error)?.message || e)); }
});

function addScript(src: string, integrity: string): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.integrity = "sha384-" + integrity; s.crossOrigin = "anonymous";
    s.onload = () => res();
    s.onerror = () => { s.remove(); rej(readerError("script")); };
    document.head.appendChild(s);
  });
}

export const loadTesseract = retrying<TessWorker>(async () => {
  const b = readerBase();
  try {
    return await withTimeout((async () => {
      if (webProduction()) { await probeReader(b.tess); await probeReader(b.tessWorker); }
      const g = window as unknown as { Tesseract?: { createWorker(lang: string, oem: number, o: Record<string, unknown>): Promise<TessWorker> } };
      if (!g.Tesseract) await addScript(b.tess, READER_SHA384.tess);
      if (!g.Tesseract) throw readerError("unusable");
      const w = await g.Tesseract.createWorker("eng", 1, { workerPath: b.tessWorker, corePath: b.tessCore, langPath: b.lang, gzip: true });
      try { await w.setParameters({ tessedit_pageseg_mode: "11" }); } // sparse text, as RackMap used
      catch (e) { w.terminate().catch(() => {}); throw e; }
      return w;
    })(), TESS_TIMEOUT_MS, (w) => { w.terminate().catch(() => {}); }); // a worker that arrives after the timeout is shut down
  } catch (e) { throw isReaderError(e) ? e : readerError(String((e as Error)?.message || e)); }
});
