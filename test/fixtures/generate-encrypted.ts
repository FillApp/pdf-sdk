// Generates test/fixtures/encrypted.pdf — a minimal AcroForm PDF protected
// with an owner+user password. Used to exercise the `allowEncrypted` path
// of PdfSdk.load.
//
// Run with: tsx test/fixtures/generate-encrypted.ts
import { PDFDocument } from "@cantoo/pdf-lib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const form = doc.getForm();
  const field = form.createTextField("secret_field");
  field.setText("classified");
  field.addToPage(page, { x: 20, y: 250, width: 360, height: 20 });

  doc.encrypt({
    ownerPassword: "owner-secret",
    userPassword: "user-secret",
    permissions: {
      printing: "lowResolution",
      modifying: false,
      copying: false,
      annotating: false,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: false,
    },
  });

  const bytes = await doc.save();
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "encrypted.pdf");
  writeFileSync(out, bytes);
  console.log(`Wrote ${out} (${bytes.length} bytes)`);
}

void main();
