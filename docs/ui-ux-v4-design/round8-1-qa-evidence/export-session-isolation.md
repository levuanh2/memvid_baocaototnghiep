# R8-003 — stale image export download

Original finding: `round8-qa-evidence/defects.md` § R8-003 "stale image export
may download after map/session invalidation" (P1).

## Invariant

An invalidated export attempt never initiates a browser download.

## Root cause

`exportMindmapImage()` called `result.download()` itself, before
`ExportStudioDialog` could check whether the attempt was still current. The
dialog's check only suppressed the success message; the irreversible side
effect had already happened.

## Fix (`883b616`)

- `mindmapImageExport.js` gains `outputMode: "prepared"`. It returns
  `{ filename, geometryManifest, commitDownload(), dispose() }` and does not
  download. `commitDownload()` runs once; after `dispose()` it rejects with
  `AbortError`.
- `ExportStudioDialog.runImage` captures with `outputMode: "prepared"`, then
  validates `attemptKeyRef.current === attemptKey`, then commits, and always
  disposes in `finally`.
- All three capture paths (single scope, current-branch, multi-branch
  offscreen) return through `_finishCapture`, so they share the boundary.
- `download` (default) and `base64` modes are unchanged, so PDF/DOCX map
  capture (`captureMapImageBase64`, `captureMapImageWithGeometry`) and their
  geometry manifests are unaffected. MIME types, filenames, exact-node
  membership, appearance, fonts, SnapDOM usage and offscreen cleanup are
  untouched.

## Download-count proof

`FE/src/components/mindmap/ExportStudioDialog.imageCommitBoundary.test.jsx`
uses deferred captures and asserts `commitDownload` call counts directly.

| Scenario | Stale attempt downloads | Valid attempt downloads |
|---|---|---|
| Map A capture resolves after switching to Map B | 0 (disposed 1×) | — |
| Dialog unmounts during capture | 0 (disposed 1×) | — |
| Valid active export | — | 1 (disposed 1× after commit) |
| Re-export, then map switch before the second capture resolves | second: 0 | first: 1 |
| Export clicked twice rapidly (`07fbf82`) | — | captures 1, downloads 1 |
| Stale Map A resolves after a newer Map B attempt began (`07fbf82`) | A: 0 (disposed 1×) | B: 1 |

Mutation check: removing the `inFlightRef` guard fails the double-click test;
removing the pre-commit `attemptKey` check fails 4 of 6 tests. The source was
restored from HEAD afterwards.

Format parity (`FE/src/utils/mindmapImageExport.test.js`, `07fbf82`): prepared
PNG, JPEG (`.jpg`), SVG and WebP artifacts commit the same `format` and
filename as the direct download path. The prepared artifact does not download
until committed and rejects commit after dispose.

Real-browser download behaviour of the shipped Export Studio is exercised by
`FE/e2e-fixture/export-studio.spec.js` (see `test-results.md`).
