import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

/**
 * Registered test PDFs.
 *   - f1040    : real IRS Form 1040 (2025). 2 pages, 126 text + 73 checkbox
 *                fields. Contains XFA data which pdf-lib strips on load —
 *                the AcroForm fallback is what we parse.
 *   - choices  : SDK-authored single-page fixture carrying the three field
 *                types f1040 does not use (radio, dropdown, listbox).
 *   - flat     : No AcroForm at all — pins the "parse degrades cleanly"
 *                contract.
 *   - encrypted: Password-protected AcroForm PDF used to exercise
 *                `allowEncrypted`.
 */
export const FIXTURES = {
  f1040: "f1040.pdf",
  choices: "choices.pdf",
  flat: "flat.pdf",
  encrypted: "encrypted.pdf",
  /** Small PNG used by overlay image tests. */
  overlayImage: "overlay-image.png",
} as const;
