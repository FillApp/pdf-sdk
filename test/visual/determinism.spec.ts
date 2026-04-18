import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { bytesToBase64, freshSdk, loadFixtureBytes } from "./helpers.js";

const ID = (name: string) => `acro:${name}:0`;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

test.describe("determinism: byte-equality across runtimes", () => {
  test("Node and browser produce identical bytes for the same fill", async ({
    page,
  }) => {
    const textFills: Array<[string, string]> = [
      ["plain_text", "Cross-runtime determinism"],
      ["date_field", "2026-04-18"],
      ["phone_field", "+1 555 0100"],
    ];

    // Node generate
    const sdkNode = await freshSdk("form-all-types.pdf");
    for (const [name, value] of textFills) {
      sdkNode.setFieldValue(ID(name), value);
    }
    const nodeBytes = await sdkNode.generate();

    // Browser generate against the same fixture
    await page.goto("/generate");
    await page.waitForFunction(
      () => document.getElementById("status")?.textContent === "ready",
      null,
      { timeout: 10_000 },
    );
    const pdfBase64 = bytesToBase64(loadFixtureBytes("form-all-types.pdf"));
    const browserArray = await page.evaluate(
      async ({ pdfBase64, textFills, flatten }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (window as any).runBrowserGenerate({
          pdfBase64,
          textFillsByAcroName: textFills,
          flatten,
        });
      },
      { pdfBase64, textFills, flatten: false },
    );
    const browserBytes = new Uint8Array(browserArray);

    expect(browserBytes.byteLength).toBe(nodeBytes.byteLength);
    expect(sha256(browserBytes)).toBe(sha256(nodeBytes));
  });

  test("flattened output is also byte-identical across runtimes", async ({
    page,
  }) => {
    const textFills: Array<[string, string]> = [
      ["plain_text", "Flattened determinism"],
    ];

    const sdkNode = await freshSdk("form-all-types.pdf");
    for (const [name, value] of textFills) {
      sdkNode.setFieldValue(ID(name), value);
    }
    const nodeBytes = await sdkNode.generate({ flatten: true });

    await page.goto("/generate");
    await page.waitForFunction(
      () => document.getElementById("status")?.textContent === "ready",
      null,
      { timeout: 10_000 },
    );
    const pdfBase64 = bytesToBase64(loadFixtureBytes("form-all-types.pdf"));
    const browserArray = await page.evaluate(
      async ({ pdfBase64, textFills, flatten }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (window as any).runBrowserGenerate({
          pdfBase64,
          textFillsByAcroName: textFills,
          flatten,
        });
      },
      { pdfBase64, textFills, flatten: true },
    );
    const browserBytes = new Uint8Array(browserArray);

    expect(sha256(browserBytes)).toBe(sha256(nodeBytes));
  });
});
