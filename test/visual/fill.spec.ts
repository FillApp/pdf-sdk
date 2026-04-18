import { expect, test } from "@playwright/test";
import {
  bytesToBase64,
  freshSdk,
  loadFixtureBytes,
  renderInViewer,
} from "./helpers.js";

async function idOf(fixture: string, acroFieldName: string): Promise<string> {
  const sdk = await freshSdk(fixture);
  const f = sdk
    .getFields()
    .find((x) => x.source === "acroform" && x.acroFieldName === acroFieldName);
  if (!f) throw new Error(`No field with acroFieldName ${acroFieldName}`);
  return f.id;
}

// f1040 well-known field names.
const F1040_FIRST_NAME = "topmostSubform[0].Page1[0].f1_01[0]";
const F1040_LAST_NAME = "topmostSubform[0].Page1[0].f1_04[0]";
const F1040_CHECKBOX = "topmostSubform[0].Page1[0].c1_1[0]";

test.describe("visual: f1040 AcroForm fill", () => {
  test("unfilled page 1 renders the native form chrome", async ({ page }) => {
    const sdk = await freshSdk("f1040.pdf");
    const pdf = await sdk.generate();
    await renderInViewer(page, pdf);
    await expect(page.locator("#page-0")).toHaveScreenshot(
      "f1040-unfilled-page-0.png",
    );
  });

  test("filled page 1: text + checkbox survive via /NeedAppearances", async ({
    page,
  }) => {
    const sdk = await freshSdk("f1040.pdf");
    sdk.setFieldValue(await idOf("f1040.pdf", F1040_FIRST_NAME), "Jane");
    sdk.setFieldValue(await idOf("f1040.pdf", F1040_LAST_NAME), "Doe");
    sdk.setFieldValue(await idOf("f1040.pdf", F1040_CHECKBOX), true);
    const pdf = await sdk.generate();
    await renderInViewer(page, pdf);
    await expect(page.locator("#page-0")).toHaveScreenshot(
      "f1040-filled-page-0.png",
    );
  });
});

test.describe("visual: choices fixture (radio + dropdown + listbox)", () => {
  test("unfilled", async ({ page }) => {
    const sdk = await freshSdk("choices.pdf");
    const pdf = await sdk.generate();
    await renderInViewer(page, pdf);
    await expect(page.locator("#page-0")).toHaveScreenshot(
      "choices-unfilled.png",
    );
  });

  test("filled: every choice variant", async ({ page }) => {
    const sdk = await freshSdk("choices.pdf");
    sdk.setFieldValue(await idOf("choices.pdf", "shipping"), "express");
    sdk.setFieldValue(await idOf("choices.pdf", "country"), "Armenia");
    sdk.setFieldValue(await idOf("choices.pdf", "fruits"), ["Apple", "Cherry"]);
    const pdf = await sdk.generate();
    await renderInViewer(page, pdf);
    await expect(page.locator("#page-0")).toHaveScreenshot(
      "choices-filled.png",
    );
  });
});

test.describe("visual: f1040 exhaustive — every field filled + overlays", () => {
  test("every text + checkbox set, signature overlays on page 2", async ({
    page,
  }) => {
    const sdk = await freshSdk("f1040.pdf");

    // Walk the full template, fill every AcroForm field.
    // Text: fill with a short marker value that respects maxLength.
    // Checkbox: tick each one.
    // Read-only fields are skipped to avoid fighting the PDF's own constraints.
    let textFilled = 0;
    let checkboxFilled = 0;
    for (const field of sdk.getFields()) {
      if (field.source !== "acroform") continue;
      if (field.readOnly) continue;
      if (field.type === "text") {
        const cap = field.maxLength ?? 9;
        const value = "12345".padEnd(cap, "X").slice(0, cap);
        sdk.setFieldValue(field.id, value);
        textFilled++;
      } else if (field.type === "checkbox") {
        sdk.setFieldValue(field.id, true);
        checkboxFilled++;
      }
    }
    // Sanity pin: f1040 is expected to have a lot of both types.
    expect(textFilled).toBeGreaterThan(100);
    expect(checkboxFilled).toBeGreaterThan(50);

    // Overlays on the Sign Here / Paid Preparer area of page 2 (page index 1).
    // Coordinates measured from parsed AcroForm widget rectangles on this
    // fixture (US Letter, 792pt tall; PDF y=0 is the bottom of the page):
    //   - Your signature row:       y=126, h=20, signature cell x≈130–322
    //   - Spouse's signature row:   y=96,  h=20
    //   - Paid Preparer's row:      y=60,  h=14, signature cell x≈225–325
    const signatureImg = loadFixtureBytes("overlay-image.png");

    // Image "stamp" inside Your signature cell.
    sdk.addOverlay({
      source: "overlay",
      kind: "image",
      page: 1,
      position: { xPt: 130, yPt: 128, widthPt: 160, heightPt: 16 },
      image: { bytes: signatureImg, mime: "image/png" },
    });
    // Printed spouse name inside the Spouse's signature cell (Unicode demo).
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 1,
      position: { xPt: 140, yPt: 100, widthPt: 160, heightPt: 10 },
      text: {
        value: "Jane Доу",
        fontSizePt: 8,
        color: { r: 0.1, g: 0.2, b: 0.5 },
      },
    });
    // Date written into the Date column of Your signature row.
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 1,
      position: { xPt: 282, yPt: 130, widthPt: 40, heightPt: 10 },
      text: { value: "2026-04-18", fontSizePt: 7 },
    });
    // Cross in Preparer's signature cell — shows it was left unsigned.
    sdk.addOverlay({
      source: "overlay",
      kind: "cross",
      page: 1,
      position: { xPt: 230, yPt: 58, widthPt: 90, heightPt: 14 },
      color: { r: 0.6, g: 0.6, b: 0.6 },
    });

    const pdf = await sdk.generate();
    await renderInViewer(page, pdf);

    await expect(page.locator("#page-0")).toHaveScreenshot(
      "f1040-fully-filled-page-0.png",
    );
    await expect(page.locator("#page-1")).toHaveScreenshot(
      "f1040-fully-filled-page-1.png",
    );
  });
});

test.describe("visual: overlays on a flat PDF", () => {
  test("text + image + checkmark + cross on the no-AcroForm fixture", async ({
    page,
  }) => {
    // flat.pdf is 400x300 pt. All overlay coordinates sit inside that box.
    const sdk = await freshSdk("flat.pdf");

    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 20, yPt: 250, widthPt: 360, heightPt: 22 },
      text: { value: "Overlay text at known coordinates", fontSizePt: 14 },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 20, yPt: 220, widthPt: 360, heightPt: 20 },
      text: {
        value: "Цвет — красный",
        fontSizePt: 12,
        color: { r: 0.8, g: 0.15, b: 0.15 },
      },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "image",
      page: 0,
      position: { xPt: 20, yPt: 120, widthPt: 70, heightPt: 70 },
      image: {
        bytes: loadFixtureBytes("overlay-image.png"),
        mime: "image/png",
      },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "checkmark",
      page: 0,
      position: { xPt: 120, yPt: 140, widthPt: 40, heightPt: 40 },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "cross",
      page: 0,
      position: { xPt: 180, yPt: 140, widthPt: 40, heightPt: 40 },
      color: { r: 0.85, g: 0.15, b: 0.15 },
    });

    const pdf = await sdk.generate();
    await renderInViewer(page, pdf);
    await expect(page.locator("#page-0")).toHaveScreenshot("overlays-flat.png");
  });
});

// Keep the helper imports used (avoid unused-var lint) even though this file
// does not directly call them — they're exported for other specs.
void bytesToBase64;
