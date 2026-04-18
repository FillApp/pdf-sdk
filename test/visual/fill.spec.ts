import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freshSdk, renderInViewer } from "./helpers.js";

const ID = (name: string) => `acro:${name}:0`;
const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

test.describe("visual: fill + generate (AcroForm preserved)", () => {
  test("all-types fixture, every variant filled", async ({ page }) => {
    const sdk = await freshSdk("form-all-types.pdf");

    sdk.setFieldValue(ID("plain_text"), "Jane Doe");
    sdk.setFieldValue(ID("date_field"), "2026-04-18");
    sdk.setFieldValue(ID("phone_field"), "+1 555 0100");
    sdk.setFieldValue(ID("zip_field"), "94102");
    sdk.setFieldValue(ID("multiline_field"), "Line one\nLine two\nLine three");

    sdk.setFieldValue(ID("single_check"), true);
    sdk.setFieldValue(ID("topping_cheese"), true);
    sdk.setFieldValue(ID("topping_olives"), true);

    sdk.setFieldValue(ID("shipping"), "express");
    sdk.setFieldValue(ID("country"), "Armenia");
    sdk.setFieldValue(ID("city"), "Yerevan");
    sdk.setFieldValue(ID("fruit_single"), "Cherry");
    sdk.setFieldValue(ID("fruit_multi"), ["Apple", "Cherry", "Grape"]);

    const pdf = await sdk.generate();
    await renderInViewer(page, pdf);

    const template = sdk.toTemplate();
    for (let i = 0; i < template.metadata.pageCount; i++) {
      await expect(page.locator(`#page-${i}`)).toHaveScreenshot(
        `all-types-filled-page-${i}.png`,
      );
    }
  });
});

test.describe("visual: fill + generate (flattened)", () => {
  test("all-types fixture flattened", async ({ page }) => {
    const sdk = await freshSdk("form-all-types.pdf");

    sdk.setFieldValue(ID("plain_text"), "Flattened Form");
    sdk.setFieldValue(ID("single_check"), true);
    sdk.setFieldValue(ID("shipping"), "overnight");
    sdk.setFieldValue(ID("country"), "Japan");

    const pdf = await sdk.generate({ flatten: true });
    await renderInViewer(page, pdf);

    const template = sdk.toTemplate();
    for (let i = 0; i < template.metadata.pageCount; i++) {
      await expect(page.locator(`#page-${i}`)).toHaveScreenshot(
        `all-types-flattened-page-${i}.png`,
      );
    }
  });
});

test.describe("visual: overlays", () => {
  test("text + image + checkmark + cross over a flat PDF", async ({ page }) => {
    // flat.pdf is 400x300 pt. All coordinates below sit inside that box.
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
      image: { bytes: fixture("overlay-image.png"), mime: "image/png" },
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

    await expect(page.locator("#page-0")).toHaveScreenshot(
      "overlays-flat-page-0.png",
    );
  });

  test("overlays + AcroForm fill baked together (flatten)", async ({
    page,
  }) => {
    const sdk = await freshSdk("form-all-types.pdf");
    sdk.setFieldValue(ID("plain_text"), "Mixed doc");
    sdk.setFieldValue(ID("single_check"), true);

    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 400, yPt: 40, widthPt: 160, heightPt: 16 },
      text: {
        value: "Generated 2026-04-18",
        fontSizePt: 10,
        color: { r: 0.35, g: 0.35, b: 0.35 },
      },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "checkmark",
      page: 0,
      position: { xPt: 560, yPt: 40, widthPt: 16, heightPt: 16 },
      color: { r: 0.15, g: 0.55, b: 0.2 },
    });

    const pdf = await sdk.generate({ flatten: true });
    await renderInViewer(page, pdf);

    await expect(page.locator("#page-0")).toHaveScreenshot(
      "overlays-mixed-flattened-page-0.png",
    );
  });
});

test.describe("visual: unicode rendering", () => {
  test("Cyrillic + accented Latin renders via bundled Noto Sans", async ({
    page,
  }) => {
    const sdk = await freshSdk("form-all-types.pdf");
    sdk.setFieldValue(ID("plain_text"), "Привет, мир — café");
    sdk.setFieldValue(ID("phone_field"), "Ереван №42");
    sdk.setFieldValue(ID("country"), "Armenia");

    const pdf = await sdk.generate();
    await renderInViewer(page, pdf);

    await expect(page.locator("#page-0")).toHaveScreenshot(
      "all-types-unicode-page-0.png",
    );
  });
});

test.describe("visual: unfilled baseline", () => {
  test("all-types fixture with no fills", async ({ page }) => {
    const sdk = await freshSdk("form-all-types.pdf");
    const pdf = await sdk.generate();
    await renderInViewer(page, pdf);

    const template = sdk.toTemplate();
    for (let i = 0; i < template.metadata.pageCount; i++) {
      await expect(page.locator(`#page-${i}`)).toHaveScreenshot(
        `all-types-unfilled-page-${i}.png`,
      );
    }
  });

  test("flat fixture (no AcroForm)", async ({ page }) => {
    const sdk = await freshSdk("flat.pdf");
    const pdf = await sdk.generate();
    await renderInViewer(page, pdf);
    await expect(page.locator("#page-0")).toHaveScreenshot("flat-page-0.png");
  });
});
