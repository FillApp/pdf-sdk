import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PdfEngine } from "@embedpdf/models";
import { PdfSdk } from "../../src/index.js";
import { createNodeEngine } from "../../src/engine-node.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

export function loadFixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

let enginePromise: Promise<PdfEngine<Blob>> | null = null;
function getEngine(): Promise<PdfEngine<Blob>> {
  if (!enginePromise) enginePromise = createNodeEngine();
  return enginePromise;
}

export async function freshSdk(fixture: string): Promise<PdfSdk> {
  const engine = await getEngine();
  return PdfSdk.load(loadFixtureBytes(fixture), { engine });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return Buffer.from(s, "binary").toString("base64");
}

/** Load the viewer, push PDF bytes in, wait for PDF.js to render every page. */
export async function renderInViewer(
  page: Page,
  pdfBytes: Uint8Array,
): Promise<void> {
  await page.goto("/");
  const base64 = bytesToBase64(pdfBytes);
  await page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).renderPdf(b64);
  }, base64);
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__PDF_RENDERED__ === true,
    null,
    { timeout: 15_000 },
  );
}
