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

### Current shape (v0.1.0-alpha)

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

- Non-fatal issues from parse **and** runtime (fill, generate) go to `ParseDiagnostic[]`, never silently swallowed.
- `PdfSdk.diagnostics` is typed `readonly` but is appended to in place as runtime diagnostics accumulate (text truncation, signature fields skipped during flatten, etc.).
- Current `kind` values: `"no-widgets" | "orphan-widget" | "value-extraction-failed" | "options-extraction-failed" | "value-truncated" | "signature-flatten-skipped"`. When adding a new kind, update the union in `src/types.ts`.
- `try { ... } catch {}` with empty body is forbidden. If you must catch, push a `ParseDiagnostic`.
- The type is still named `ParseDiagnostic` for continuity; rename to `Diagnostic` if it becomes confusing — just coordinate the change across exports and the README.

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
├── sdk.ts         # PdfSdk class: load, getFields, toTemplate, setFieldValue, generate
├── parse.ts       # PDF → Template (exports parseToTemplate + classifyField)
├── types.ts       # Template, AcroFormField variants, ParseDiagnostic
└── utils.ts       # pt/mm/px/flipY, base64 helpers, normalizeInput

test/
├── fixtures/
│   ├── form-all-types.pdf        # 38 fillable fields covering every type
│   ├── flat.pdf                  # No AcroForm at all
│   └── generate-flat.ts          # Script that produces flat.pdf
├── helpers/
│   └── fixtures.ts               # loadFixture() + FIXTURES registry
├── parse.test.ts                 # parse coverage
├── fill.test.ts                  # setFieldValue + generate round-trip
├── utils.test.ts                 # unit conversion + base64
└── visual/                       # Playwright visual regression
    ├── fill.spec.ts              # visual snapshots, one per fixture/page/variant
    ├── helpers.ts                # spec-side glue: freshSdk, bytesToBase64, renderInViewer
    ├── server.cjs                # tiny static server serving viewer + pdfjs assets
    ├── viewer/index.html         # pdfjs-dist renderer harness
    └── fill.spec.ts-snapshots/   # committed baseline PNGs (source of truth)

.github/
├── workflows/ci.yml              # lint + typecheck + format + test + coverage + build + dist verify
└── dependabot.yml                # weekly dep updates

eslint.config.mjs                 # ESLint 9 flat config, typescript-eslint
.prettierrc.json                  # prettier config
vitest.config.ts                  # v8 coverage, 85/90/80/85 thresholds (test/visual excluded)
playwright.config.ts              # visual e2e config, chromium project, committed baselines
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

  setFieldValue(id: string, value: string | string[] | boolean): void;
  generate(opts?: { flatten?: boolean }): Promise<Uint8Array>;

  readonly diagnostics: readonly ParseDiagnostic[];
}
```

Invariants, hold these:
- `getFields`, `getField`, `toTemplate` **always return fresh copies.** Consumers can mutate the result without affecting the SDK instance. Tests pin this.
- `load` **refuses encrypted PDFs by default.** Opt in with `{ allowEncrypted: true }`. This is a security contract — do not quietly relax it.
- `PdfSdk`'s constructor is `private`. External users must use `load`.
- `setFieldValue` is **variant-correct**. A wrong-type value throws. A value not in a choice field's `options` throws. An over-long text value is truncated to `maxLength` and a `value-truncated` diagnostic is pushed (never throws — ergonomic choice, do not change without a migration note).
- `generate` **sets a fixed `ModDate`** so repeated runs with the same `Template` produce byte-identical output. Do not introduce any other runtime-varying state (timestamps, random ids, wall-clock dates).
- `generate({ flatten: true })` **pre-removes non-fillable fields** (signatures, plain buttons) before calling `form.flatten()` to dodge a pdf-lib crash. A `signature-flatten-skipped` diagnostic is pushed per removed field.

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
- `npm test` — unit suite across Node 18, 20, 22 (73 tests as of v0.1.0-alpha)
- `npm run test:coverage` — 85/90/80/85 thresholds (lines/functions/branches/statements)
- `npm run build` — ESM + CJS + `.d.ts`. CI then loads the dist artifacts to verify exports are actually present.

**Visual regression runs locally only** (see §6a). CI does not currently run Playwright because baselines are committed per-OS and the initial baselines are `darwin`. Add a linux-baseline generator + CI job before enforcing.

Local development:
```bash
npm install
npm run typecheck && npm run lint && npm test
# Optional, requires Playwright browsers:
npx playwright install chromium && npm run test:visual
```

`npm run prepublishOnly` runs the full gate before publish.

### Performance baseline (macOS, Node 22)

Measured on `test/fixtures/large-form.pdf` — 100 pages, 1000 text fields:

| Phase                 | Observed | Budget (test pins) |
| --------------------- | -------- | ------------------ |
| `PdfSdk.load` + parse | ~100 ms  | 3000 ms            |
| `setFieldValue` × 100 | ~160 ms  | 2000 ms            |
| `generate` (default)  | ~220 ms  | 5000 ms            |

`test/perf.test.ts` asserts against the generous budgets so CI doesn't flake on slow runners; tighten if you want early warning on regressions.

---

## 6a. Visual E2E testing — the contract

This is the project's visual correctness net. Anything that changes the rendered output of `generate()` must be verified here before it's considered done.

### How it works

1. A tiny Node static server (`test/visual/server.cjs`) serves the viewer HTML and exposes `pdfjs-dist`'s build + standard fonts + cmaps over HTTP.
2. Playwright (`playwright.config.ts`) spins that server up as a `webServer`, then launches chromium.
3. Each spec in `test/visual/*.spec.ts` imports the SDK from `../../src`, builds a PDF with `PdfSdk.load(...) → setFieldValue → generate()`, and hands the bytes to the browser via `page.evaluate`.
4. The viewer (`test/visual/viewer/index.html`) uses `pdfjs-dist` to render every page into a `<canvas id="page-N">`.
5. The spec calls `expect(page.locator('#page-N')).toHaveScreenshot('name-page-N.png')`. Playwright compares against the committed PNG baseline in `test/visual/fill.spec.ts-snapshots/`.

### Determinism

Rendering runs with `disableFontFace: false`, `useSystemFonts: false`, and pdfjs-dist's bundled `standard_fonts/` + `cmaps/`. This means the rendered output does **not** depend on the host's installed fonts — two developers on the same OS with the same chromium version produce identical pixels.

### Where baselines live

`test/visual/fill.spec.ts-snapshots/<spec-name>-<project>-<platform>.png`. Today that's all `chromium-darwin`. When a linux baseline job lands, those will also live in this directory (`...-chromium-linux.png`) — Playwright automatically picks the right one for the runtime.

### Workflow for changes

- **Intentional visual change** (new field type, layout tweak, font bundled): run `npm run test:visual:update`, eyeball the new PNGs, commit them alongside the code change.
- **Unintentional regression**: `npm run test:visual` fails with an HTML diff report. Investigate the diff before deciding whether to update the baseline.
- **New spec added**: first run needs `npm run test:visual:update` to write initial baselines. Tests fail on CI if a baseline is missing — the expectation is that the spec author verified the first render and committed the baseline.

### Scripts

```
npm run test:visual            # diff against committed baselines; fails on mismatch
npm run test:visual:update     # (re)write baselines after an intentional change
npm run test:visual:ui         # open Playwright UI mode for interactive debugging
```

### Platform caveat

PNG snapshots are inherently OS-specific (subpixel hinting, font rasterizer, chromium version). Committed darwin baselines will **not** pass on linux. Either run visual tests only on the same OS that produced the baselines, or generate linux baselines in CI and commit both. Do not rebaseline darwin files on linux — they'll diverge from the developer machines.

### When to add a new visual test

- Every new field type that renders differently.
- Every new overlay kind (`text`, `image`, `checkmark`, `cross` — coming in v0.2.0).
- Every flatten path where output structure changes.
- **Not** for pure template / JSON changes. Those are unit test territory.

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

1. Load a PDF (any supported input). ← **done in v0.0.1**
2. Parse it to a `Template` with 100% field type coverage. ← **done in v0.0.1**
3. Fill every native AcroForm field type through `setFieldValue(id, value)`. ← **done in v0.1.0-alpha**
4. `generate({ flatten?: boolean })` produces the final PDF bytes. ← **done in v0.1.0-alpha** (AcroForm preserved by default; flatten with safe signature handling)
5. Bundled Unicode font so non-Latin field values render. ← v0.1.0 finalization
6. Add overlay content via `addOverlay(field)`:
   - Text with font family, size, color (RGB), bold, italic.
   - Image (PNG or JPEG) from bytes.
   - Checkmark / cross glyphs at PDF coordinates for flat-form "tick the box" use cases.
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
