# Contributing

Thanks for your interest.

Correctness and a clean public API matter more than feature breadth.

## Ground rules

- Works unchanged in Node >=18 and modern browsers. No `fs`, `Buffer`, `path`, or other Node-only imports in `src/`.
- Every public method has unit tests covering the happy path and at least one failure mode.
- No `any` in `src/`. `as unknown as` casts only at clearly isolated pdf-lib boundary points with a comment explaining the risk.
- Parse errors surface through the `ParseDiagnostic` channel. Empty `catch {}` blocks are rejected in review.

## Local setup

```bash
npm install
npm run typecheck
npm run lint
npm test
```

## Before submitting a PR

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
```

All of the above run in CI.

## Adding a new fixture PDF

- Put it in `test/fixtures/`.
- Keep it small (ideally < 50 KB).
- Add an entry to `test/helpers/fixtures.ts`.
- Ensure the license allows redistribution. Government forms from `IRS.gov`, sample W-9s, and similar are typically fine.

## Scope

v0.x is focused on AcroForm parse, fill, and generation, plus overlay content (text, images, checkmarks). Out of scope for 1.0: XFA forms, digital signatures (PKI), JavaScript action execution, OCR, page split or merge.
