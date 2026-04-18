import { describe, it, expect } from "vitest";
import { PdfSdk } from "../src/index.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

function idFor(name: string): string {
  return `acro:${name}:0`;
}

async function loadFresh(): Promise<PdfSdk> {
  return PdfSdk.load(loadFixture(FIXTURES.allTypes));
}

describe("setFieldValue: text fields", () => {
  it("writes a string value and reflects it in the template", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("plain_text"), "Hello, world");
    const f = sdk.getField(idFor("plain_text"));
    if (f?.type !== "text") throw new Error();
    expect(f.value).toBe("Hello, world");
  });

  it("rejects a boolean", async () => {
    const sdk = await loadFresh();
    expect(() => sdk.setFieldValue(idFor("plain_text"), true)).toThrow(
      /string/i,
    );
  });

  it("rejects an array", async () => {
    const sdk = await loadFresh();
    expect(() => sdk.setFieldValue(idFor("plain_text"), ["a"])).toThrow(
      /string/i,
    );
  });

  it("truncates to maxLength and emits a diagnostic", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("maxlen_5"), "abcdefghij");
    const f = sdk.getField(idFor("maxlen_5"));
    if (f?.type !== "text") throw new Error();
    expect(f.value).toBe("abcde");
    expect(
      sdk.diagnostics.some(
        (d) => d.kind === "value-truncated" && d.fieldName === "maxlen_5",
      ),
    ).toBe(true);
  });

  it("accepts empty string", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("plain_text"), "");
    const f = sdk.getField(idFor("plain_text"));
    if (f?.type !== "text") throw new Error();
    expect(f.value).toBe("");
  });
});

describe("setFieldValue: checkbox fields", () => {
  it("accepts true to check", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("single_check"), true);
    const f = sdk.getField(idFor("single_check"));
    if (f?.type !== "checkbox") throw new Error();
    expect(f.value).toBe(true);
  });

  it("accepts false to uncheck", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("single_check"), true);
    sdk.setFieldValue(idFor("single_check"), false);
    const f = sdk.getField(idFor("single_check"));
    if (f?.type !== "checkbox") throw new Error();
    expect(f.value).toBe(false);
  });

  it("rejects a string", async () => {
    const sdk = await loadFresh();
    expect(() => sdk.setFieldValue(idFor("single_check"), "yes")).toThrow(
      /boolean/i,
    );
  });
});

describe("setFieldValue: radio fields", () => {
  it("accepts a valid option", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("shipping"), "express");
    const f = sdk.getField(idFor("shipping"));
    if (f?.type !== "radio") throw new Error();
    expect(f.value).toBe("express");
  });

  it("rejects an unknown option", async () => {
    const sdk = await loadFresh();
    expect(() => sdk.setFieldValue(idFor("shipping"), "teleport")).toThrow(
      /no option/i,
    );
  });

  it("rejects a boolean", async () => {
    const sdk = await loadFresh();
    expect(() => sdk.setFieldValue(idFor("shipping"), true)).toThrow(/string/i);
  });
});

describe("setFieldValue: dropdown fields", () => {
  it("accepts a single string", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("country"), "Armenia");
    const f = sdk.getField(idFor("country"));
    if (f?.type !== "dropdown") throw new Error();
    expect(f.value).toEqual(["Armenia"]);
  });

  it("rejects an unknown option", async () => {
    const sdk = await loadFresh();
    expect(() => sdk.setFieldValue(idFor("country"), "Atlantis")).toThrow(
      /no option/i,
    );
  });
});

describe("setFieldValue: listbox fields", () => {
  it("accepts a single string on a single-select listbox", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("fruit_single"), "Cherry");
    const f = sdk.getField(idFor("fruit_single"));
    if (f?.type !== "listbox") throw new Error();
    expect(f.value).toEqual(["Cherry"]);
  });

  it("rejects multiple values on a single-select listbox", async () => {
    const sdk = await loadFresh();
    expect(() =>
      sdk.setFieldValue(idFor("fruit_single"), ["Cherry", "Date"]),
    ).toThrow(/single-select/i);
  });

  it("accepts multiple values on a multi-select listbox", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("fruit_multi"), ["Apple", "Banana", "Cherry"]);
    const f = sdk.getField(idFor("fruit_multi"));
    if (f?.type !== "listbox") throw new Error();
    expect(f.value).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("rejects an unknown option in the array", async () => {
    const sdk = await loadFresh();
    expect(() =>
      sdk.setFieldValue(idFor("fruit_multi"), ["Apple", "Jackfruit"]),
    ).toThrow(/no option/i);
  });
});

describe("setFieldValue: unknown field", () => {
  it("throws on an id that does not exist", async () => {
    const sdk = await loadFresh();
    expect(() => sdk.setFieldValue("acro:does_not_exist:0", "x")).toThrow(
      /Unknown field id/i,
    );
  });
});

describe("generate: default preserves AcroForm", () => {
  it("returns bytes that reparse with the same field set", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("plain_text"), "round-trip");
    sdk.setFieldValue(idFor("single_check"), true);
    sdk.setFieldValue(idFor("shipping"), "overnight");
    sdk.setFieldValue(idFor("country"), "Japan");
    sdk.setFieldValue(idFor("fruit_multi"), ["Apple", "Grape"]);

    const bytes = await sdk.generate();
    const reparsed = await PdfSdk.load(bytes);
    const t = reparsed.toTemplate();
    expect(t.metadata.hasAcroForm).toBe(true);

    const get = (name: string) =>
      t.fields.find((f) => f.acroFieldName === name);

    const plain = get("plain_text");
    if (plain?.type !== "text") throw new Error();
    expect(plain.value).toBe("round-trip");

    const chk = get("single_check");
    if (chk?.type !== "checkbox") throw new Error();
    expect(chk.value).toBe(true);

    const ship = get("shipping");
    if (ship?.type !== "radio") throw new Error();
    expect(ship.value).toBe("overnight");

    const country = get("country");
    if (country?.type !== "dropdown") throw new Error();
    expect(country.value).toEqual(["Japan"]);

    const fruitMulti = get("fruit_multi");
    if (fruitMulti?.type !== "listbox") throw new Error();
    expect(fruitMulti.value.sort()).toEqual(["Apple", "Grape"].sort());
  });

  it("is deterministic: same Template produces same bytes", async () => {
    const run = async () => {
      const sdk = await loadFresh();
      sdk.setFieldValue(idFor("plain_text"), "deterministic");
      return sdk.generate();
    };
    const a = await run();
    const b = await run();
    expect(a.byteLength).toBe(b.byteLength);
    // Byte-equal at this level. If this becomes flaky upstream, switch to a
    // structural comparison on reparsed Template.
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("generate: flatten", () => {
  it("produces a PDF with no AcroForm", async () => {
    const sdk = await loadFresh();
    sdk.setFieldValue(idFor("plain_text"), "flattened");
    sdk.setFieldValue(idFor("single_check"), true);

    const bytes = await sdk.generate({ flatten: true });
    const reparsed = await PdfSdk.load(bytes);
    expect(reparsed.toTemplate().metadata.hasAcroForm).toBe(false);
  });

  it("emits a diagnostic for skipped signature fields", async () => {
    const sdk = await loadFresh();
    await sdk.generate({ flatten: true });
    expect(
      sdk.diagnostics.some(
        (d) =>
          d.kind === "signature-flatten-skipped" &&
          d.fieldName === "signature_field",
      ),
    ).toBe(true);
  });
});
