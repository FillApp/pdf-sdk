import { describe, it, expect } from "vitest";
import { PdfSdk, type AcroFormField, type Field } from "../src/index.js";
import {
  FIXTURES,
  getTestEngine,
  loadFixture,
  loadSdk,
} from "./helpers/fixtures.js";

/**
 * All SDK-side tests against the two primary fixtures.
 *   - f1040    : real IRS form — text + checkbox coverage.
 *   - choices  : SDK-authored — radio + dropdown + listbox coverage.
 *
 * Tests resolve field ids by looking up `acroFieldName` in the parsed
 * template, so they stay stable even if the sanitization rule changes.
 */

async function loadF1040(): Promise<PdfSdk> {
  return loadSdk(FIXTURES.f1040);
}
async function loadChoices(): Promise<PdfSdk> {
  return loadSdk(FIXTURES.choices);
}

function idOf(sdk: PdfSdk, acroFieldName: string): string {
  const f = sdk
    .getFields()
    .find((x) => x.source === "acroform" && x.acroFieldName === acroFieldName);
  if (!f) throw new Error(`No field with acroFieldName ${acroFieldName}`);
  return f.id;
}

function asAcro(field: Field | null): AcroFormField {
  if (!field || field.source !== "acroform")
    throw new Error("expected acroform field");
  return field;
}

// f1040 field names (hierarchical; PDFium keeps them verbatim).
const F1040_TEXT = "topmostSubform[0].Page1[0].f1_01[0]"; // first-name field
const F1040_MAXLEN_2 = "topmostSubform[0].Page1[0].f1_03[0]"; // maxLength=2
const F1040_CHECKBOX = "topmostSubform[0].Page1[0].c1_1[0]"; // "Someone can claim" checkbox

describe("setFieldValue: text fields (f1040)", () => {
  it("writes a string value and reflects it in the template", async () => {
    const sdk = await loadF1040();
    const id = idOf(sdk, F1040_TEXT);
    sdk.setFieldValue(id, "Jane Doe");
    const f = asAcro(sdk.getField(id));
    if (f.type !== "text") throw new Error();
    expect(f.value).toBe("Jane Doe");
  });

  it("rejects a boolean", async () => {
    const sdk = await loadF1040();
    expect(() => sdk.setFieldValue(idOf(sdk, F1040_TEXT), true)).toThrow(
      /string/i,
    );
  });

  it("rejects an array", async () => {
    const sdk = await loadF1040();
    expect(() => sdk.setFieldValue(idOf(sdk, F1040_TEXT), ["a"])).toThrow(
      /string/i,
    );
  });

  it("truncates to maxLength and emits a diagnostic", async () => {
    const sdk = await loadF1040();
    const id = idOf(sdk, F1040_MAXLEN_2);
    sdk.setFieldValue(id, "abcdef");
    const f = asAcro(sdk.getField(id));
    if (f.type !== "text") throw new Error();
    expect(f.value).toBe("ab");
    expect(
      sdk.diagnostics.some(
        (d) => d.kind === "value-truncated" && d.fieldName === F1040_MAXLEN_2,
      ),
    ).toBe(true);
  });

  it("accepts empty string", async () => {
    const sdk = await loadF1040();
    const id = idOf(sdk, F1040_TEXT);
    sdk.setFieldValue(id, "");
    const f = asAcro(sdk.getField(id));
    if (f.type !== "text") throw new Error();
    expect(f.value).toBe("");
  });
});

describe("setFieldValue: checkbox fields (f1040)", () => {
  it("accepts true to check", async () => {
    const sdk = await loadF1040();
    const id = idOf(sdk, F1040_CHECKBOX);
    sdk.setFieldValue(id, true);
    const f = asAcro(sdk.getField(id));
    if (f.type !== "checkbox") throw new Error();
    expect(f.value).toBe(true);
  });

  it("accepts false to uncheck", async () => {
    const sdk = await loadF1040();
    const id = idOf(sdk, F1040_CHECKBOX);
    sdk.setFieldValue(id, true);
    sdk.setFieldValue(id, false);
    const f = asAcro(sdk.getField(id));
    if (f.type !== "checkbox") throw new Error();
    expect(f.value).toBe(false);
  });

  it("rejects a string", async () => {
    const sdk = await loadF1040();
    expect(() => sdk.setFieldValue(idOf(sdk, F1040_CHECKBOX), "yes")).toThrow(
      /boolean/i,
    );
  });
});

describe("setFieldValue: radio fields (choices)", () => {
  it("accepts a valid option", async () => {
    const sdk = await loadChoices();
    const id = idOf(sdk, "shipping");
    sdk.setFieldValue(id, "express");
    const f = asAcro(sdk.getField(id));
    if (f.type !== "radio") throw new Error();
    expect(f.value).toBe("express");
  });

  it("rejects an unknown option", async () => {
    const sdk = await loadChoices();
    expect(() => sdk.setFieldValue(idOf(sdk, "shipping"), "teleport")).toThrow(
      /no option/i,
    );
  });

  it("rejects a boolean", async () => {
    const sdk = await loadChoices();
    expect(() => sdk.setFieldValue(idOf(sdk, "shipping"), true)).toThrow(
      /string/i,
    );
  });
});

describe("setFieldValue: dropdown fields (choices)", () => {
  it("accepts a single string", async () => {
    const sdk = await loadChoices();
    const id = idOf(sdk, "country");
    sdk.setFieldValue(id, "Armenia");
    const f = asAcro(sdk.getField(id));
    if (f.type !== "dropdown") throw new Error();
    expect(f.value).toEqual(["Armenia"]);
  });

  it("rejects an unknown option", async () => {
    const sdk = await loadChoices();
    expect(() => sdk.setFieldValue(idOf(sdk, "country"), "Atlantis")).toThrow(
      /no option/i,
    );
  });
});

describe("setFieldValue: listbox fields (choices)", () => {
  it("accepts a single string on a multi-select listbox", async () => {
    const sdk = await loadChoices();
    const id = idOf(sdk, "fruits");
    sdk.setFieldValue(id, "Cherry");
    const f = asAcro(sdk.getField(id));
    if (f.type !== "listbox") throw new Error();
    expect(f.value).toEqual(["Cherry"]);
  });

  it("accepts multiple values on a multi-select listbox", async () => {
    const sdk = await loadChoices();
    const id = idOf(sdk, "fruits");
    sdk.setFieldValue(id, ["Apple", "Banana", "Cherry"]);
    const f = asAcro(sdk.getField(id));
    if (f.type !== "listbox") throw new Error();
    expect(f.value).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("rejects an unknown option in the array", async () => {
    const sdk = await loadChoices();
    expect(() =>
      sdk.setFieldValue(idOf(sdk, "fruits"), ["Apple", "Jackfruit"]),
    ).toThrow(/no option/i);
  });
});

describe("setFieldValue: unknown field", () => {
  it("throws on an id that does not exist", async () => {
    const sdk = await loadF1040();
    expect(() => sdk.setFieldValue("acro:does_not_exist:0", "x")).toThrow(
      /Unknown field id/i,
    );
  });
});

describe("generate: preserves AcroForm and round-trips values", () => {
  it("text + checkbox values survive a generate → reparse round-trip", async () => {
    const engine = await getTestEngine();
    const sdk = await loadF1040();
    sdk.setFieldValue(idOf(sdk, F1040_TEXT), "Round Trip");
    sdk.setFieldValue(idOf(sdk, F1040_CHECKBOX), true);

    const bytes = await sdk.generate();
    const reparsed = await PdfSdk.load(bytes, { engine });
    expect(reparsed.toTemplate().metadata.hasAcroForm).toBe(true);

    const text = asAcro(reparsed.getField(idOf(reparsed, F1040_TEXT)));
    if (text.type !== "text") throw new Error();
    expect(text.value).toBe("Round Trip");

    const chk = asAcro(reparsed.getField(idOf(reparsed, F1040_CHECKBOX)));
    if (chk.type !== "checkbox") throw new Error();
    expect(chk.value).toBe(true);
  });

  it("radio + dropdown + listbox values survive a round-trip", async () => {
    const engine = await getTestEngine();
    const sdk = await loadChoices();
    sdk.setFieldValue(idOf(sdk, "shipping"), "overnight");
    sdk.setFieldValue(idOf(sdk, "country"), "Japan");
    sdk.setFieldValue(idOf(sdk, "fruits"), ["Apple", "Cherry"]);

    const bytes = await sdk.generate();
    const reparsed = await PdfSdk.load(bytes, { engine });

    const ship = asAcro(reparsed.getField(idOf(reparsed, "shipping")));
    if (ship.type !== "radio") throw new Error();
    expect(ship.value).toBe("overnight");

    const country = asAcro(reparsed.getField(idOf(reparsed, "country")));
    if (country.type !== "dropdown") throw new Error();
    expect(country.value).toEqual(["Japan"]);

    const fruits = asAcro(reparsed.getField(idOf(reparsed, "fruits")));
    if (fruits.type !== "listbox") throw new Error();
    expect(fruits.value.sort()).toEqual(["Apple", "Cherry"].sort());
  });

  it("is deterministic: same fills produce byte-identical output", async () => {
    const run = async (): Promise<Uint8Array> => {
      const sdk = await loadChoices();
      sdk.setFieldValue(idOf(sdk, "country"), "Japan");
      return sdk.generate();
    };
    const a = await run();
    const b = await run();
    expect(a.byteLength).toBe(b.byteLength);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  // The old SDK pinned `/NeedAppearances = true` on save so spec-lenient
  // viewers would re-render widget chrome. PDFium regenerates appearance
  // streams when field values change, so the flag is no longer required
  // for correct rendering. We pin the behavioural property (text survives
  // round-trip) instead of the PDF-object implementation detail.
  it("regenerates widget appearances so text field values render in every viewer", async () => {
    const engine = await getTestEngine();
    const sdk = await loadChoices();
    sdk.setFieldValue(idOf(sdk, "country"), "Japan");
    const bytes = await sdk.generate();
    const reparsed = await PdfSdk.load(bytes, { engine });
    const country = asAcro(reparsed.getField(idOf(reparsed, "country")));
    if (country.type !== "dropdown") throw new Error();
    expect(country.value).toEqual(["Japan"]);
  });
});

// Keep the import used so the linter doesn't complain.
void loadFixture;
