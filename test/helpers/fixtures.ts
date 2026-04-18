import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

/**
 * Registered test PDFs. Only fillable fields are asserted by tests; fixtures
 * may carry additional content (buttons, signatures, static text) that the
 * parser intentionally ignores.
 */
export const FIXTURES = {
  /** 23 text + 10 checkbox + 1 radio + 2 dropdown + 2 listbox, plus buttons and a signature that are filtered out. */
  allTypes: "form-all-types.pdf",
  /** No AcroForm at all — single-page static text. */
  flat: "flat.pdf",
  /** Small PNG used by overlay image tests. */
  overlayImage: "overlay-image.png",
  /** 5 text fields with dot-separated hierarchical names. */
  hierarchical: "hierarchical-fields.pdf",
  /** Password-protected AcroForm PDF used to exercise `allowEncrypted`. */
  encrypted: "encrypted.pdf",
  /** 100-page PDF with 1000 text fields used by performance benchmarks. */
  large: "large-form.pdf",
} as const;
