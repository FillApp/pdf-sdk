// Generates test/fixtures/hierarchical-fields.pdf — a small AcroForm PDF
// whose field names follow the PDF hierarchical-name convention
// (`parent.child.grandchild`). Used to pin parser behavior around name
// sanitization and id uniqueness.
//
// Run with: tsx test/fixtures/generate-hierarchical.ts
import { PDFDocument } from "@cantoo/pdf-lib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const form = doc.getForm();

  // Hierarchical names: dot-separated. pdf-lib honors these when creating
  // fields via the form API — each dotted segment implies a parent node.
  const fields = [
    "billing.name",
    "billing.address.line1",
    "billing.address.line2",
    "shipping.name",
    "shipping.address.line1",
  ];

  let y = 260;
  for (const name of fields) {
    const text = form.createTextField(name);
    text.addToPage(page, { x: 20, y, width: 360, height: 20 });
    y -= 30;
  }

  const bytes = await doc.save();
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "hierarchical-fields.pdf");
  writeFileSync(out, bytes);
  console.log(`Wrote ${out} (${bytes.length} bytes)`);
}

void main();
