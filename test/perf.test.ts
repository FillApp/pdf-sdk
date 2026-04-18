import { describe, expect, it } from "vitest";
import { PdfSdk } from "../src/index.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

// CI machines vary. The budgets below are set generously to catch regressions
// without flaking on slow runners. Tighten once real numbers stabilize.
const PARSE_BUDGET_MS = 3000;
const FILL_BUDGET_MS = 2000;
const GENERATE_BUDGET_MS = 5000;

describe("performance: 100-page / 1000-field fixture", () => {
  it("parses under the budget", async () => {
    const bytes = loadFixture(FIXTURES.large);
    const t0 = performance.now();
    const sdk = await PdfSdk.load(bytes);
    const elapsed = performance.now() - t0;
    const t = sdk.toTemplate();
    expect(t.metadata.pageCount).toBe(100);
    expect(t.fields.length).toBe(1000);
    console.log(`parse: ${elapsed.toFixed(1)} ms (budget ${PARSE_BUDGET_MS})`);
    expect(elapsed).toBeLessThan(PARSE_BUDGET_MS);
  });

  it("fills 100 fields under the budget", async () => {
    const sdk = await PdfSdk.load(loadFixture(FIXTURES.large));
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      sdk.setFieldValue(`acro:page_${i}_field_0:0`, `value ${i}`);
    }
    const elapsed = performance.now() - t0;
    console.log(
      `fill×100: ${elapsed.toFixed(1)} ms (budget ${FILL_BUDGET_MS})`,
    );
    expect(elapsed).toBeLessThan(FILL_BUDGET_MS);
  });

  it("generates under the budget", async () => {
    const sdk = await PdfSdk.load(loadFixture(FIXTURES.large));
    for (let i = 0; i < 100; i++) {
      sdk.setFieldValue(`acro:page_${i}_field_0:0`, `value ${i}`);
    }
    const t0 = performance.now();
    const bytes = await sdk.generate();
    const elapsed = performance.now() - t0;
    console.log(
      `generate: ${elapsed.toFixed(1)} ms, ${bytes.byteLength} bytes (budget ${GENERATE_BUDGET_MS})`,
    );
    expect(elapsed).toBeLessThan(GENERATE_BUDGET_MS);
  });
});
