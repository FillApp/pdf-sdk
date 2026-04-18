/**
 * Generates flat.pdf — a minimal PDF with no AcroForm.
 * Run from the package root:  npx tsx test/fixtures/generate-flat.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));

const doc = await PDFDocument.create();
const page = doc.addPage([400, 300]);
const font = await doc.embedFont(StandardFonts.Helvetica);
page.drawText("Flat PDF, no AcroForm.", {
  x: 20,
  y: 260,
  size: 14,
  font,
  color: rgb(0, 0, 0),
});
const bytes = await doc.save();
writeFileSync(join(here, "flat.pdf"), bytes);
console.log(`wrote ${bytes.byteLength} bytes`);
