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

/** The error every reader failure ends in; the dialog turns it into the "couldn't load" warning. */
export const readerError = (why = ""): Error => new Error("reader" + (why ? ": " + why : ""));
export const isReaderError = (e: unknown): boolean => e instanceof Error && /^reader\b/.test(e.message);

/** Wraps a loader so a success is kept and a failure is forgotten: the next call tries again. */
export function retrying<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    if (!p) p = fn().catch((e) => { p = null; throw e; });
    return p;
  };
}

interface ResponseLike { ok: boolean; status: number; headers: { get(n: string): string | null } }
/** A missing /readers/ file on the web is answered with index.html (200, text/html). That is a failure too. */
export function checkReaderResponse(res: ResponseLike): void {
  if (!res.ok) throw readerError("HTTP " + res.status);
  if (/text\/html/i.test(res.headers.get("content-type") || "")) throw readerError("got a web page instead of the file");
}
export async function probeReader(url: string, fetchFn: (u: string) => Promise<ResponseLike> = (u) => fetch(u)): Promise<void> {
  let res: ResponseLike;
  try { res = await fetchFn(url); } catch (e) { throw readerError(String((e as Error)?.message || e)); }
  checkReaderResponse(res);
}

// ---- minimal types for the two libraries ----
export interface PdfTextItem { str: string; transform: number[] }
export interface PdfPage { getTextContent(): Promise<{ items: PdfTextItem[] }> }
export interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage> }
export interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): { promise: Promise<PdfDoc> };
}
export interface TessWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(image: Blob | HTMLCanvasElement, options?: Record<string, unknown>, output?: Record<string, boolean>): Promise<{ data: { tsv?: string | null } }>;
  terminate(): Promise<unknown>;
}

export const loadPdfJs = retrying<PdfJs>(async () => {
  const b = readerBase();
  try {
    if (webProduction()) { await probeReader(b.pdf); await probeReader(b.pdfWorker); }
    const lib = (await import(/* @vite-ignore */ b.pdf)) as PdfJs;
    if (!lib || !lib.getDocument) throw readerError("unusable");
    lib.GlobalWorkerOptions.workerSrc = b.pdfWorker;
    return lib;
  } catch (e) { throw isReaderError(e) ? e : readerError(String((e as Error)?.message || e)); }
});

function addScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => res();
    s.onerror = () => { s.remove(); rej(readerError("script")); };
    document.head.appendChild(s);
  });
}

export const loadTesseract = retrying<TessWorker>(async () => {
  const b = readerBase();
  try {
    if (webProduction()) { await probeReader(b.tess); await probeReader(b.tessWorker); await probeReader(b.lang + "eng.traineddata.gz"); }
    const g = window as unknown as { Tesseract?: { createWorker(lang: string, oem: number, o: Record<string, unknown>): Promise<TessWorker> } };
    if (!g.Tesseract) await addScript(b.tess);
    if (!g.Tesseract) throw readerError("unusable");
    const w = await g.Tesseract.createWorker("eng", 1, { workerPath: b.tessWorker, corePath: b.tessCore, langPath: b.lang, gzip: true });
    await w.setParameters({ tessedit_pageseg_mode: "11" }); // sparse text, as RackMap used
    return w;
  } catch (e) { throw isReaderError(e) ? e : readerError(String((e as Error)?.message || e)); }
});
