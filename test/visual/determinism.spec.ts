import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { bytesToBase64, freshSdk, loadFixtureBytes } from "./helpers.js";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function idOf(fixture: string, acroFieldName: string): Promise<string> {
  const sdk = await freshSdk(fixture);
  const f = sdk
    .getFields()
    .find((x) => x.source === "acroform" && x.acroFieldName === acroFieldName);
  if (!f) throw new Error(`No field with acroFieldName ${acroFieldName}`);
  return f.id;
}

test.describe("determinism: byte-equality across runtimes", () => {
  test("Node and browser produce identical bytes for the same AcroForm fill", async ({
    page,
  }) => {
    const fixtureName = "f1040.pdf";
    const textFills: Array<[string, string]> = [
      ["topmostSubform[0].Page1[0].f1_01[0]", "Jane"],
      ["topmostSubform[0].Page1[0].f1_04[0]", "Doe"],
    ];

    // Resolve ids once against the parsed template (both runtimes parse the
    // same bytes and derive the same stable ids, so either side can do this).
    const byName: Record<string, string> = {};
    for (const [name] of textFills) {
      byName[name] = await idOf(fixtureName, name);
    }

    // Node generate.
    const sdkNode = await freshSdk(fixtureName);
    for (const [name, value] of textFills) {
      sdkNode.setFieldValue(byName[name], value);
    }
    const nodeBytes = await sdkNode.generate();

    // Browser generate.
    await page.goto("/generate");
    await page.waitForFunction(
      () => document.getElementById("status")?.textContent === "ready",
      null,
      { timeout: 10_000 },
    );
    const pdfBase64 = bytesToBase64(loadFixtureBytes(fixtureName));
    const browserArray = await page.evaluate(
      async ({ pdfBase64, textFills }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (window as any).runBrowserGenerate({
          pdfBase64,
          textFillsByAcroName: textFills,
        });
      },
      { pdfBase64, textFills },
    );
    const browserBytes = new Uint8Array(browserArray);

    expect(browserBytes.byteLength).toBe(nodeBytes.byteLength);
    expect(sha256(browserBytes)).toBe(sha256(nodeBytes));
  });
});
