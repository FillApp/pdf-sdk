/**
 * Browser engine factory. Bootstraps a PDFium-backed `PdfEngine` running in a
 * Web Worker, using the WASM bundled with `@embedpdf/pdfium`.
 *
 * If the host app is already using `usePdfiumEngine()` (EmbedPDF's React hook),
 * pass that engine to `PdfSdk.load` directly — don't spin up a second one.
 * Use this helper only when the SDK is the sole consumer on the page.
 */
import { createPdfiumEngine } from "@embedpdf/engines/pdfium-worker-engine";
import type { PdfEngine } from "@embedpdf/models";

const DEFAULT_WASM_URL = `https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.14.0/dist/pdfium.wasm`;

export interface CreateBrowserEngineOptions {
  /** URL to the pdfium.wasm file. Defaults to a CDN copy pinned to the installed version. */
  wasmUrl?: string;
}

export async function createBrowserEngine(
  opts: CreateBrowserEngineOptions = {},
): Promise<PdfEngine<Blob>> {
  const wasmUrl = opts.wasmUrl ?? DEFAULT_WASM_URL;
  return await createPdfiumEngine(wasmUrl);
}
