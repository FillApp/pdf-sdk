import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PdfEngine } from "@embedpdf/models";
import { createNodeEngine } from "../../src/engine-node.js";
import { PdfSdk, type LoadOptions } from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

/**
 * Registered test PDFs.
 *   - f1040    : real IRS Form 1040 (2025). 2 pages, 126 text + 73 checkbox
 *                fields. Contains XFA data, but PDFium serves the AcroForm
 *                structure transparently.
 *   - choices  : SDK-authored single-page fixture carrying the three field
 *                types f1040 does not use (radio, dropdown, listbox).
 *   - flat     : No AcroForm at all — pins the "parse degrades cleanly"
 *                contract.
 *   - encrypted: Password-protected AcroForm PDF used to exercise the
 *                "refuses encrypted by default" contract.
 */
export const FIXTURES = {
  f1040: "f1040.pdf",
  choices: "choices.pdf",
  flat: "flat.pdf",
  encrypted: "encrypted.pdf",
  /** Small PNG used by overlay image tests. */
  overlayImage: "overlay-image.png",
} as const;

/**
 * Shared engine across the whole test suite. PDFium-backed, runs directly in
 * Node. Initialized lazily on first request so a single bad fixture can't
 * cascade into every test timing out.
 */
let enginePromise: Promise<PdfEngine<Blob>> | null = null;
export function getTestEngine(): Promise<PdfEngine<Blob>> {
  if (!enginePromise) enginePromise = createNodeEngine();
  return enginePromise;
}

export async function loadSdk(
  fixture: string,
  extra?: Partial<LoadOptions>,
): Promise<PdfSdk> {
  const engine = await getTestEngine();
  return PdfSdk.load(loadFixture(fixture), { engine, ...extra });
}
