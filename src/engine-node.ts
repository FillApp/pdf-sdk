/**
 * Node engine factory. Loads the PDFium WASM that ships with `@embedpdf/pdfium`
 * from the local filesystem and wires it through `PdfiumNative` + `PdfEngine`.
 *
 * Deliberately direct (no worker) — Node has no real overhead for synchronous
 * WASM and tests want a single process. Callers are responsible for calling
 * `engine.closeAllDocuments()` / `engine.destroy()` when done.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { init } from "@embedpdf/pdfium";
import { PdfiumNative, PdfEngine } from "@embedpdf/engines";
import type { ImageDataConverter } from "@embedpdf/engines";

// The SDK never reads rendered page images — it only uses PDFium for
// annotation and form operations. We still have to provide an image
// converter to satisfy `PdfEngine`'s constructor; this one produces a stub
// Blob from the lazy image data so callers that render pages still work.
const bytesToBlobConverter: ImageDataConverter<Blob> = async (getImageData) => {
  const img = getImageData();
  return new Blob([img.data], { type: "application/octet-stream" });
};

export async function createNodeEngine(): Promise<PdfEngine<Blob>> {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("@embedpdf/pdfium/pdfium.wasm");
  const wasmBuf = await readFile(wasmPath);
  // Detach a plain ArrayBuffer — emscripten's loader mutates what it's given.
  const ab = wasmBuf.buffer.slice(
    wasmBuf.byteOffset,
    wasmBuf.byteOffset + wasmBuf.byteLength,
  );
  const wasmModule = await init({ wasmBinary: ab });
  const native = new PdfiumNative(wasmModule);
  return new PdfEngine(native, { imageConverter: bytesToBlobConverter });
}
