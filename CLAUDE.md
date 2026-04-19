# CLAUDE.md

Source of truth for any AI agent continuing this project. Read fully before changing things. Update when architecture changes. Routine feature work belongs in `TODO.md`, not here.

## Vision

`@fillapp/pdf-sdk` is an isomorphic pure-JS SDK for PDF form filling. One package, one API, runs in Node and the browser. The same code must produce the same output bytes in Node and the browser given the same input.

End-to-end scope for 1.0:

1. Load a PDF.
2. Parse it to a canonical `Template` JSON covering all AcroForm field types.
3. Fill every native AcroForm field type via `setFieldValue`.
4. Generate bytes with the AcroForm preserved and the output rendering correctly in all viewers (including iOS Preview, print pipelines, rasterizers).
5. Add overlay content on pages: text, images, checkmarks, crosses.
6. Bundled Unicode font plus multi-font fallback for mixed-script documents.
7. Password-protected PDFs via `{ password }`.
8. `Template` serialization helpers so the whole template round-trips through JSON.
9. Byte-for-byte determinism across Node and browser, asserted in CI.

Current state: 0.2.0 is on npm. Parse + fill + overlay + generate + bundled Noto Sans work today. Appearance regeneration, password decryption, overlay styling, serialization helpers, and multi-font fallback are the big gaps. See `TODO.md`.

## Out of scope, forever

- XFA forms (flag and degrade to AcroForm fallback).
- True digital signatures (PKI, certificates, timestamping).
- Execution of PDF-embedded JavaScript (`/AA`, `/A`, `/JS`).
- OCR.
- Page split, merge, reorder, compression, or format conversion.
- Rendering or viewing PDFs. Consumers use `pdf.js` or similar on top.
- Real-time collaboration. `Template` is plain JSON; consumers layer their own sync model.

## The `Template` is THE contract

Backend and frontend exchange it verbatim, no translation layer.

```ts
type Template = {
  basePdf: Uint8Array;
  metadata: {
    pageCount: number;
    pages: { widthPt: number; heightPt: number }[];
    hasAcroForm: boolean;
  };
  fields: Field[]; // AcroFormField | OverlayField
};
```

- `Field` is a discriminated union. `source: "acroform" | "overlay"`. AcroForm fields further discriminate on `type` (`text | checkbox | radio | dropdown | listbox`). Overlay fields on `kind` (`text | image | checkmark | cross`). Each variant carries the value shape appropriate for it (no union leaves).
- `id` is stable and URL-safe. Derived from the sanitized `acroFieldName` plus widget-index for AcroForm fields, and from a monotonic counter for overlays. Never derived from iteration order.
- Coordinates are PDF points, bottom-left origin, exposed as `{ xPt, yPt, widthPt, heightPt }`. Unit conversion only at public edges (`ptToMm`, `mmToPt`, `pxToPt`, `ptToPx`, `flipY`).
- Must survive `structuredClone` plus a base64 step for `basePdf`. No closures, class instances, or `Date` objects that do not serialize to ISO strings.

## Hard rules for `src/`

1. No Node-only imports. `fs`, `Buffer`, `path`, node `crypto`, `stream` are banned. Tests can use `fs`; `src/` cannot.
2. No `any`. Narrow with `instanceof`. `as unknown as` casts only at clearly isolated pdf-lib boundary points, with a comment on the risk.
3. No silent catches. Empty `catch {}` is forbidden. Push a `ParseDiagnostic` or rethrow.
4. Getters return deep copies. Never hand back internal references.
5. Field IDs are stable. Never reshuffle them across runs.
6. Determinism. `generate()` sets a fixed `ModDate` so repeat runs produce identical bytes. Never introduce timestamps, random ids, or wall-clock state.
7. Every mutation API has a round-trip test. Fill / add overlay → generate → reparse → assert values match.

## Engine

`@cantoo/pdf-lib` v2.6.5+. Actively maintained fork. Do not switch to a non-isomorphic engine. If replacement is ever needed, vendoring is the fallback.

## Public API

```ts
class PdfSdk {
  static load(input, opts?: { allowEncrypted?: boolean }): Promise<PdfSdk>;
  toTemplate(): Template; // copy
  getFields(): Field[]; // copy
  getField(id: string): Field | null; // copy
  setFieldValue(id, value): void;
  addOverlay(field): string;
  updateOverlay(id, partial): void;
  removeOverlay(id): void;
  generate(opts?: { font? }): Promise<Uint8Array>;
  readonly diagnostics: readonly ParseDiagnostic[];
}
```

Invariants:

- Constructor is private. `load` is the only entry.
- `load` refuses encrypted PDFs unless `allowEncrypted: true`. Security contract, do not relax.
- `setFieldValue` is variant-correct. Wrong-type value throws. Out-of-options choice value throws. Text over `maxLength` is truncated and a `value-truncated` diagnostic is pushed (never throws).
- `generate` does not flatten. It sets `/NeedAppearances true`. Flatten stays out of scope.

## Diagnostics

Non-fatal issues from parse and runtime go to `ParseDiagnostic[]`. Never silently swallowed. Current kinds: `no-widgets | orphan-widget | value-extraction-failed | options-extraction-failed | value-truncated`. Update the union in `src/types.ts` when adding a new kind.

## Quality gates (CI enforces, do not weaken)

```bash
npm run typecheck           # tsc --noEmit, strict
npm run lint                # ESLint 9 flat config
npm run format:check        # Prettier
npm test                    # vitest across Node 18/20/22
npm run test:coverage       # 85/90/80/85 thresholds
npm run build               # ESM + CJS + .d.ts via tsup
```

`prepublishOnly` runs the full gate before publish.

Visual regression (`test/visual/`) runs locally only today. Playwright builds a browser bundle of the SDK, runs the fill+generate pipeline in chromium, renders through `pdfjs-dist`, and diffs PNG baselines. Also asserts `sha256(nodeBytes) === sha256(browserBytes)` for the cross-runtime determinism pin. Baselines are OS-specific; committed ones are `chromium-darwin`. When adding a visual test, run `npm run test:visual:update` and commit the PNGs.

## Process

- `TODO.md` is the working task list. Keep it honest. Items are done when verified against `test/fixtures/form-all-types.pdf` (38-field fixture) and CI is green.
- Every public method has happy-path and at least one failure-mode test.
- README and CHANGELOG describe what is actually shipped. No forward-dating.

## Releases

Package is on npm under `@fillapp/pdf-sdk`, MIT licensed. Release is tag-triggered via `.github/workflows/release.yml`. Auth is `NPM_TOKEN` (migration to OIDC Trusted Publishing pending).

```bash
git checkout main && git pull && git status    # must be clean
npm version patch|minor|major                  # edits package.json, creates commit + tag
git push && git push --tags                    # tag push fires the workflow
```

Rules: never push to `main` to publish (only tag pushes do), never amend or force-push a published tag, always confirm the bump level with the user first, update `CHANGELOG.md` before tagging.
