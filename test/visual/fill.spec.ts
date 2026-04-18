import { expect, test } from "@playwright/test";
import { freshSdk, renderInViewer } from "./helpers.js";

const ID = (name: string) => `acro:${name}:0`;

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
