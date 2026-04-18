# CLAUDE.md — context for AI agents continuing this project

This file is the project's source of truth for any AI agent picking up work after the current iteration. Read it fully before making changes.

---

## 1. What this project is

`@fillapp/pdf-sdk` is an **isomorphic JavaScript/TypeScript SDK** for PDF form filling. One package, one API, runs **identically** in Node.js and modern browsers. Pure JS — no native bindings.

The non-negotiable constraint: **the same code must produce the same output bytes in Node and in the browser given the same input.** This rules out Node-specific APIs (`fs`, `Buffer`, `path`, `crypto` node module) in `src/`. Consumers integrate this SDK on both sides — backend (AI agent does the filling) and frontend (user does the editing) — and neither side can diverge.

### Why this SDK exists (do not rebuild this motivation, accept it)

- **pdf-lib** is the only pure-JS engine that fills AcroForm fields, but it has no high-level API and is unmaintained (upstream last release Nov 2021).
- **pdfme** has a nice template model and a browser designer, but [explicitly does not support AcroForm](https://github.com/pdfme/pdfme/issues/1187) and never will. Its `generate()` converts pages to static XObjects, destroying any AcroForm data.
- **Joyfill** solves exactly the same shape (JoyDoc JSON covers native fields + overlays) but is closed-source and commercial.
- Other candidates (MuhammaraJS, pdf-fill-form, pdftk wrappers) are Node-only native bindings — they violate the isomorphic constraint.

**The gap this SDK fills:** a single pure-JS package that can both (a) fill 100% of native AcroForm field types preserving the AcroForm structure, and (b) draw overlay content (text, images, glyphs) on page content streams, expressed through one canonical JSON `Template` shape that both backend and frontend read and write without translation.

---

## 2. The canonical `Template`

This is THE contract. Every operation reads or writes it. Backend and frontend exchange it verbatim.

```ts
type Template = {
  basePdf: Uint8Array; // bytes of the original PDF
  metadata: {
    pageCount: number;
    pages: { widthPt: number; heightPt: number }[];
    hasAcroForm: boolean;
  };
  fields: Field[];
};
```

### Current shape (v0.0.1)

- `Field` is currently `AcroFormField` only.
- `AcroFormField` is a **discriminated union keyed on `type`**: `TextField | CheckboxField | RadioField | DropdownField | ListboxField`.
- Each variant has the value-type appropriate for its field type (no `string | string[] | boolean` at the leaf).
- `acroFieldName` is the original PDF field name, used for round-trip writeback.
- `id` is a stable, URL-safe identifier derived from the sanitized `acroFieldName` plus a widget-index discriminator. It is **not** derived from iteration order.

### Planned shape (v0.2.0, not yet implemented)

- `Field` becomes `AcroFormField | OverlayField`.
- `OverlayField` describes content drawn directly on page content stream (text, image, checkmark, cross). It does not live in any AcroForm structure.
- Every field has a `source: "acroform" | "overlay"` discriminator. Generation routes AcroForm sources to `pdf-lib`'s form API and Overlay sources to `page.drawText` / `page.drawImage`.

### Coordinates

- Always PDF points. Always bottom-left origin. Always exposed as `{ xPt, yPt, widthPt, heightPt }`.
- UI consumers convert at the edge via exported helpers (`ptToMm`, `mmToPt`, `pxToPt`, `ptToPx`, `flipY`).
- **Do not** let mm or top-left-origin leak into the `Template` or the SDK core. Unit conversion only at public boundaries.

### Diagnostics

- Non-fatal parse issues go to `ParseDiagnostic[]`, never silently swallowed.
- `PdfSdk.diagnostics` is a `readonly` array of them.
- `kind` values: `"no-widgets" | "orphan-widget" | "value-extraction-failed" | "options-extraction-failed"`. When adding a new kind, update the union in `src/types.ts`.
- `try { ... } catch {}` with empty body is forbidden. If you must catch, push a `ParseDiagnostic`.

---

## 3. Engine choice: `@cantoo/pdf-lib`

- Not upstream `Hopding/pdf-lib` — upstream is abandoned.
- Not `@pdfme/pdf-lib` — stale (last commit June 2025).
- `@cantoo/pdf-lib` v2.6.5+ is actively maintained (commits within the last month at time of writing), fixes SVG issues, and keeps the original API.

If a decision comes up about switching engines: the other serious option is vendoring the library directly. Do not switch to a non-isomorphic dependency — that breaks the core promise.

### Known pdf-lib bugs we accept and work around

- `form.flatten()` crashes on signature widgets lacking appearance streams (issue #1347). Plan for generation: skip problematic fields before calling `flatten`, or emit a diagnostic.
- Checkboxes / radios [may not render](https://github.com/Hopding/pdf-lib/issues/1549) after flatten. When implementing `generate({ flatten: true })`, validate the output visually against the test fixture.
- `updateFieldAppearances()` with the default font is WinAnsi-only — non-Latin strings throw. Embed a bundled Unicode font before calling it.

---

## 4. File layout

```
src/
├── index.ts       # Public exports
├── sdk.ts         # PdfSdk class: load, getFields, toTemplate, diagnostics
├── parse.ts       # PDF → Template (exports parseToTemplate too)
├── types.ts       # Template, AcroFormField variants, ParseDiagnostic
└── utils.ts       # pt/mm/px/flipY, base64 helpers, normalizeInput

test/
├── fixtures/
│   ├── form-all-types.pdf        # 38 fillable fields covering every type
│   ├── flat.pdf                  # No AcroForm at all
│   └── generate-flat.ts          # Script that produces flat.pdf
├── helpers/
│   └── fixtures.ts               # loadFixture() + FIXTURES registry
├── parse.test.ts                 # 37 tests
└── utils.test.ts                 # 14 tests

.github/
├── workflows/ci.yml              # lint + typecheck + format + test + coverage + build + dist verify
└── dependabot.yml                # weekly dep updates

eslint.config.mjs                 # ESLint 9 flat config, typescript-eslint
.prettierrc.json                  # prettier config
vitest.config.ts                  # v8 coverage, 85/90/80/85 thresholds
tsup.config.ts                    # ESM + CJS + d.ts, index + utils entries
tsconfig.json                     # strict mode
package.json                      # exports map for `.` and `./utils`
```

---

## 5. Public API (current and contracts)

### `PdfSdk`

```ts
class PdfSdk {
  static load(
    input: Uint8Array | ArrayBuffer | Blob | string,
    opts?: { allowEncrypted?: boolean },
  ): Promise<PdfSdk>;

  toTemplate(): Template;        // copy
  getFields(): Field[];          // copy
  getField(id: string): Field | null;  // copy
  getPdfDocument(): PDFDocument; // escape hatch — advanced use only

  readonly diagnostics: readonly ParseDiagnostic[];
}
```

Invariants, hold these:
- `getFields`, `getField`, `toTemplate` **always return fresh copies.** Consumers can mutate the result without affecting the SDK instance. Tests pin this.
- `load` **refuses encrypted PDFs by default.** Opt in with `{ allowEncrypted: true }`. This is a security contract — do not quietly relax it.
- `PdfSdk`'s constructor is `private`. External users must use `load`.

### `parseToTemplate(doc, bytes): ParseResult`

Exported for advanced consumers who already have a pdf-lib `PDFDocument`. Returns `{ template, diagnostics }`. Diagnostics are collected, never thrown.

### `utils`

Named exports AND namespace: both `import { ptToMm } from '@fillapp/pdf-sdk'` and `import { utils } from '@fillapp/pdf-sdk'` work. The `/utils` subpath is also exported so consumers can `import { ptToMm } from '@fillapp/pdf-sdk/utils'` without pulling the pdf-lib dependency.

`flipY(yPt, pageHeightPt, heightPt)` — `heightPt` is required. Omitting it would give a subtly wrong answer for widget rects.

---

## 6. Quality gates

CI enforces, do not weaken:

- `npm run typecheck` — `tsc --noEmit`, strict
- `npm run lint` — ESLint 9 flat config
- `npm run format:check` — Prettier
- `npm test` — 51 tests across Node 18, 20, 22
- `npm run test:coverage` — 85/90/80/85 thresholds (lines/functions/branches/statements)
- `npm run build` — ESM + CJS + `.d.ts`. CI then loads the dist artifacts to verify exports are actually present.

Local development:
```bash
npm install
npm run typecheck && npm run lint && npm test
```

`npm run prepublishOnly` runs the full gate before publish.

---

## 7. Hard rules for changes

1. **No Node-only imports in `src/`.** `fs`, `Buffer`, `path`, node `crypto`, `stream`, etc. are banned. If you need to read a fixture in a test, that's fine — tests can use `fs`, `src` cannot.
2. **No `any` in `src/`.** Narrow with `instanceof`. `as unknown as` casts are acceptable only at clearly isolated pdf-lib boundary points, and only with a comment flagging the stability risk.
3. **No silent catches.** Empty `catch {}` is forbidden. Push a `ParseDiagnostic`, or rethrow.
4. **Getters return copies.** Never return internal array/object references directly.
5. **Coordinates are PDF points.** Unit conversion only at public edges.
6. **Field IDs are stable.** Do not derive them from iteration order, timestamps, or anything that could reshuffle.
7. **The `Template` is serializable.** Everything it contains must survive `structuredClone` (plus a conventional base64 step for `basePdf`). No closures, no class instances, no `Date` objects unless they serialize to ISO strings.
8. **Symmetry is the goal.** Every operation that produces state on one side (parse, fill, overlay) must have a symmetric operation on the other side (reparse, round-trip). Tests must pin the round-trip.

---

## 8. Vision — what this SDK must eventually do

The vision has not changed since the requirements doc was written. Reiterating here so any agent picking up work sees the target clearly.

**v1.0.0 — legal-PDF form filling, end to end:**

1. Load a PDF (any supported input).
2. Parse it to a `Template` with 100% field type coverage. ← **done in v0.0.1**
3. Fill every native AcroForm field type through `setFieldValue(id, value)`. ← v0.1.0
4. Add overlay content via `addOverlay(field)`:
   - Text with font family, size, color (RGB), bold, italic.
   - Image (PNG or JPEG) from bytes.
   - Checkmark / cross glyphs at PDF coordinates for flat-form "tick the box" use cases.
   ← v0.2.0
5. `generate({ flatten?: boolean })` produces the final PDF bytes:
   - Default: AcroForm structure preserved — output opens in Acrobat as a fillable form with the AI's values pre-filled and the user's overlays baked in.
   - `flatten: true`: one-way flatten for submission PDFs that should not be further edited.
   ← v0.2.0

**Byte-for-byte determinism:** the same `Template` produces the same output bytes in Node and in the browser. Tests must hash the output and assert equality across runtimes.

**What the SDK does NOT do, now or ever:**

- XFA form support — flagged and left to the AcroForm fallback.
- True digital signatures (PKI certificates, timestamping, long-term validation).
- Executing PDF-embedded JavaScript actions (`/AA`, `/A`, `/JS`). Format/validation scripts are ignored; consumers apply validation at the JSON layer.
- OCR on scanned pages. Consumers run OCR externally and hand us coordinates.
- Page split / merge / reorder / compression / format conversion.
- Rendering / viewing. The SDK does not render PDFs — use `pdf.js` or `pdfme` on top.
- Multi-user collaboration, CRDTs, real-time sync. `Template` is plain JSON; consumers layer whatever collaboration model they want on top.

---

## 9. Process expectations

- **Every feature is verified against `test/fixtures/form-all-types.pdf` before being called done.** This fixture has 38 fillable fields covering every type the SDK claims to support. If a feature can't handle this fixture, it can't ship.
- **Each mutation API must have a round-trip test.** Fill → generate → reparse → assert values match what was filled.
- **TODO.md is the working task list.** Update it as you complete items. Keep it honest — don't claim progress that isn't reflected in code + tests + CI.
- **CLAUDE.md is the stable context.** Update it when architecture changes (e.g. when `OverlayField` lands, update §2). Do not update it for routine feature work.
- **User-facing text in the repo (README, CHANGELOG) describes what v0.0.x actually does.** No forward-dating.

---

## 10. Pointers for picking up

If you're starting fresh:
1. Read this file fully.
2. Read `TODO.md` — it contains the current work list ordered by priority.
3. Run `npm install && npm run typecheck && npm run lint && npm test` to confirm the baseline is green before making changes.
4. Pick the top unchecked item from TODO.md's "Next up" section.
5. Before writing new code, look at how `parse.ts` and `sdk.ts` are structured — match the style (discriminated unions, instanceof narrowing, diagnostics, copy-on-read).
6. Add tests first when reasonable. Every public method has happy-path + at least one failure-mode test.
7. Update TODO.md when the item is verified against `form-all-types.pdf` and CI is green.
