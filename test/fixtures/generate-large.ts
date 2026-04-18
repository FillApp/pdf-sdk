// Generates test/fixtures/large-form.pdf — a 100-page AcroForm PDF with
// 10 text fields per page (1000 total). Used for performance benchmarks.
//
// Run with: tsx test/fixtures/generate-large.ts
import { PDFDocument } from "@cantoo/pdf-lib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const doc = await PDFDocument.create();
  const form = doc.getForm();

  const PAGES = 100;
  const FIELDS_PER_PAGE = 10;

  for (let p = 0; p < PAGES; p++) {
    const page = doc.addPage([612, 792]);
    for (let f = 0; f < FIELDS_PER_PAGE; f++) {
      const field = form.createTextField(`page_${p}_field_${f}`);
      field.addToPage(page, {
        x: 72,
        y: 720 - f * 60,
        width: 400,
        height: 20,
      });
    }
  }

  const bytes = await doc.save();
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "large-form.pdf");
  writeFileSync(out, bytes);
  console.log(
    `Wrote ${out} (${bytes.length} bytes, ${PAGES} pages × ${FIELDS_PER_PAGE} fields)`,
  );
}

void main();
