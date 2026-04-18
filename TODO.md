# TODO

Working task list. Read `CLAUDE.md` first for architecture and constraints.

The vision (from `CLAUDE.md` §8): an isomorphic pure-JS SDK that parses any AcroForm PDF into a canonical `Template` JSON, lets code on either side of the wire fill native fields and add overlay content (text / images / checkmarks / crosses), and generates a final PDF with the AcroForm preserved. Byte-for-byte deterministic across Node and browser.

---

## Done (v0.2.0)

### Fill + generate

- `PdfSdk.setFieldValue(id, value)` — variant-correct, rejects wrong types, rejects out-of-options values on choice fields, refuses >1 value on single-select listbox, truncates text to `maxLength` with a diagnostic.
- `PdfSdk.generate({ font? })` — preserves the AcroForm and sets `/NeedAppearances true` on the form dict so modern viewers regenerate widget appearances on open. Overlays are drawn onto page content. Sets a fixed ModDate for byte-identical reruns. Optional caller-supplied font for non-Latin scripts.

### Overlays

- `OverlayField` variant on `Template.fields` with `source: "overlay"`. Kinds: `text`, `image`, `checkmark`, `cross`.
- `addOverlay` / `updateOverlay` / `removeOverlay` on `PdfSdk`.
- `generate()` draws overlays onto target pages with the bundled or caller-supplied font. Checkmark + cross are vector strokes.

### Font

- Bundled Noto Sans Regular subset (~67 KB TTF, ~90 KB base64) covering Latin + Latin Extended + Cyrillic + general punctuation + currency symbols. Registered via `@pdf-lib/fontkit` at `generate()` time.

### Determinism + cross-runtime

- `generate()` output is byte-identical across runs for the same `Template`.
- Playwright determinism suite builds an ESM browser bundle of the SDK, runs the same fill+generate pipeline in chromium, and asserts `sha256(nodeBytes) === sha256(browserBytes)`.

### Radio multi-widget + hierarchical names

- `RadioField.widgets: RadioWidget[]` exposes every radio button with its own position + page.
- Hierarchical field names (`billing.address.line1`) round-trip correctly. Fixed a subtle bug: `useObjectStreams: false` silently dropped hierarchical values; removed.

### Encrypted PDFs

- Fixture + test for the default refuses / `allowEncrypted: true` opens paths.

### Visual regression

- `test/visual/` Playwright suite renders every generate path through `pdfjs-dist` and diffs against committed baselines. Baselines cover f1040 unfilled / filled page 1 / fully-filled page 1+2 with overlays, choices fixture unfilled / filled, and text+image+checkmark+cross overlays on the flat PDF.

### Performance

- 100-page / 1000-field benchmark fixture + test. Observed on macOS / Node 22: parse ~100 ms, fill × 100 ~160 ms, generate ~220 ms.

### 94 unit tests + 9 visual/determinism tests, all green.

## Done (v0.0.1)

### Load + parse

- Load from `Uint8Array`, `ArrayBuffer`, `Blob`, base64 string.
- Encrypted PDFs refused by default; `allowEncrypted: true` opt-in.
- Parse 100% of supported AcroForm types (text, checkbox, radio, dropdown, listbox) from a real 38-field fixture.
- Per-field metadata extracted: page index, position in PDF points, options, `maxLength`, `multiline`, `isMultiSelect`, `readOnly`.
- Non-fatal parse issues surfaced via `ParseDiagnostic[]`; no silent swallowing.
- Discriminated union on `type` — each variant carries its own value shape.
- Stable URL-safe field IDs (`acro:<sanitized-name>:<widget-index>`).
- O(1) page lookup via `Map<PDFRef, pageIdx>`.
- `PdfSdk` constructor is private; `load` is the only entry. Getters return copies.
- `parseToTemplate(doc, bytes)` exported for advanced consumers.

### Tooling & infra

- ESM + CJS + `.d.ts` via tsup. Subpath export `/utils` so coordinate helpers can be imported without pulling pdf-lib.
- ESLint 9 flat config with typescript-eslint.
- Prettier with `format` and `format:check` scripts.
- Vitest with V8 coverage (85/90/80/85 thresholds).
- GitHub Actions CI: lint, typecheck, format:check, test across Node 18/20/22, coverage, build, dist-artifact load verification.
- Dependabot for weekly npm + monthly actions updates.
- `README.md`, `LICENSE` (MIT), `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CLAUDE.md`.

---

## Next up (priority order)

### Crucial for first release — NOT DONE YET

1. **Reliable rendering across viewers** — today `generate()` only sets `/NeedAppearances true`. That's honored by Acrobat, Chrome, Firefox, and pdf.js. It is **not** honored by iOS Preview, some print pipelines, and PDF-to-image rasterizers, which will show filled fields as blank. Fix: regenerate appearance streams for text + checkbox (the safe subset) during `generate()` using the bundled Noto Sans font, leave radios / dropdowns / listboxes on the flag path. Pin with a visual test that rasterizes the generated PDF through a second engine (e.g. pdfjs `renderTextLayer` off, or headless Chrome print).
2. **`setFieldValues(values: Record<string, string | string[] | boolean>)` batch** — "apply template of values" in one call. Small wrapper over `setFieldValue`. Pushes a diagnostic (not throws) for unknown ids so a partial fill isn't aborted.
3. **Template serialization helpers** — `templateToJSON(template): string` and `templateFromJSON(json): Template`. Wraps `basePdf: Uint8Array` in base64 so the whole `Template` survives a JSON round-trip. Consumers need this to persist forms on a server and rehydrate on the browser side.
4. **Docs + package verification** — verify every committed visual baseline renders correctly; strip all remaining `flatten` mentions; run `npm run prepublishOnly` which gates lint + typecheck + test + build.
5. **CI visual job** — current CI doesn't run Playwright. Add a job that installs chromium, runs `npm run test:visual`, and uploads the HTML report on failure. Decide between (a) committing linux baselines alongside darwin ones or (b) running visual tests only on darwin-self-hosted runners.
6. **`npm publish`** — ship `0.2.0`.

### Deferred to v0.3.0 / v1.0.0 — NOT DONE YET

7. **Overlay text styling** — font family, bold, italic, alignment (left/center/right), rotation, multiline wrapping. Needed for legal forms that expect centered names or rotated margin notes.
8. **Overlay image extras** — opacity, aspect-fit, rotation. Signature stamps typically want aspect-preserve.
9. **Per-AcroForm text-field font-size override** — only matters if a fixture's Default Appearance has a fixed size that's too large for the value. The template's DA covers this today; add `setFieldValue(id, value, { fontSizePt? })` if a real customer hits overflow.
10. **Multi-font / fallback chain** — `fonts: Uint8Array[]` on `GenerateOptions` for mixed-script documents (CJK + Arabic + Latin in the same form). Today a consumer can ship one custom font via `opts.font`; fallback ordering isn't wired.
11. **Real password-protected PDFs** — `allowEncrypted: true` opens the file structurally via pdf-lib's `ignoreEncryption`, which leaves the actual field streams unreadable. A proper `{ password: string }` decryption path is a v0.3 item; until then, update README to state the limitation explicitly.
12. **PDF metadata on `generate()`** — optional `{ title, author, producer, pdfVersion }`. Useful for compliance output but no v1 caller needs it yet.
13. **`clearFieldValue` / `resetForm`** — ergonomics; defer until a consumer actually asks.
14. **Cloudflare Workers smoke test** — README claims Workers compatibility. Add a minimal Workers-running test in CI.
15. **Docs: overlay visual examples** — once npm publish is done, embed sample screenshots in README (the committed baselines are already the right assets).
16. **`getPdfDocument()` escape hatch** — untested. Either cover it with a test or remove it if nothing in the ecosystem reaches for it.
17. **Symbol set review** — if "circle a word" or strikethrough show up in target legal forms (W-9, I-9, W-4, 1040, leases), add as overlay kinds. If not, keep scope tight.

---

## Explicitly out of scope

Do not add these. If a consumer asks for them, tell them to do it outside the SDK.

- XFA forms — flag and degrade to AcroForm fallback only.
- True digital signatures (PKI, certificates, timestamping).
- PDF JavaScript action execution.
- OCR.
- Page split / merge / reorder / compression / format conversion.
- Real-time collaboration, CRDTs.
- Rendering / viewing PDFs (use `pdf.js` or `pdfme` on top).

---

## Technical debt / loose ends

- Coverage for the `catch` arms in `extractValue` / `extractOptions` relies on future malformed-input fixtures.
- `getPdfDocument()` escape hatch — see v1.0.0 #6.
- `package.json` repo URL is set to `github.com/FillApp/pdf-sdk`. Update if the org casing ever changes.
- `CODE_OF_CONDUCT.md`, issue/PR templates — low priority; add before v1.0.0.
- CI doesn't yet run the visual or determinism suites.
