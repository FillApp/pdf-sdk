// Generates test/fixtures/choices.pdf — a small supplementary fixture
// covering radio / dropdown / listbox, since the primary legal-form fixture
// (f1040.pdf) only contains text + checkbox fields.
//
// Fields:
//   - shipping : radio group with options standard / express / overnight
//   - country  : dropdown (single-select)
//   - fruits   : list box (multi-select)
//
// Run with: npx tsx test/fixtures/generate-choices.ts
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_W = 612;
const PAGE_H = 500;
const LABEL_X = 60;
const FIELD_X = 180;
const LABEL_SIZE = 10;
const ROW_GAP = 24;

async function main(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const form = doc.getForm();

  page.drawText("Choice-field fixture", {
    x: LABEL_X,
    y: PAGE_H - 50,
    size: 16,
    font: bold,
  });
  page.drawText("Radio, dropdown, and listbox (multi-select).", {
    x: LABEL_X,
    y: PAGE_H - 70,
    size: 10,
    font,
  });

  // Cursor is the TOP y of the next row. Each row consumes its own height
  // plus ROW_GAP from the cursor.
  let cursor = PAGE_H - 110;

  const row = (
    height: number,
    label: string,
    drawField: (fieldY: number) => void,
  ): void => {
    const fieldY = cursor - height;
    // Label sits on the top line of the field.
    page.drawText(label, {
      x: LABEL_X,
      y: cursor - LABEL_SIZE - 2,
      size: LABEL_SIZE,
      font,
    });
    drawField(fieldY);
    cursor = fieldY - ROW_GAP;
  };

  // Radio group — three options horizontally
  row(16, "Shipping:", (fieldY) => {
    const radio = form.createRadioGroup("shipping");
    const opts = ["standard", "express", "overnight"] as const;
    let rx = FIELD_X;
    for (const opt of opts) {
      radio.addOptionToPage(opt, page, {
        x: rx,
        y: fieldY,
        width: 16,
        height: 16,
      });
      page.drawText(opt, {
        x: rx + 22,
        y: fieldY + 3,
        size: LABEL_SIZE,
        font,
      });
      rx += 110;
    }
  });

  // Dropdown
  row(20, "Country:", (fieldY) => {
    const dd = form.createDropdown("country");
    dd.setOptions(["United States", "Canada", "Japan", "Armenia", "Germany"]);
    dd.addToPage(page, { x: FIELD_X, y: fieldY, width: 200, height: 20 });
  });

  // Listbox, multi-select
  row(90, "Fruits:", (fieldY) => {
    const lb = form.createOptionList("fruits");
    lb.setOptions(["Apple", "Banana", "Cherry", "Date", "Elderberry"]);
    lb.enableMultiselect();
    lb.addToPage(page, { x: FIELD_X, y: fieldY, width: 200, height: 90 });
  });

  const bytes = await doc.save();
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "choices.pdf");
  writeFileSync(out, bytes);
  console.log(`Wrote ${out} (${bytes.length} bytes)`);
}

void main();
