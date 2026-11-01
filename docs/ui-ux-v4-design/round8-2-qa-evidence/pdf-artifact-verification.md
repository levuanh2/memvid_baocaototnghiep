# PDF artifacts and image export

Every row below used the real path:

- the real frontend build of `c02e2b9` (`:4173`);
- real Flask export routes (`:8080`);
- the disposable Postgres database.

Each PDF was downloaded and then opened and checked with PyMuPDF. Only the AI
provider is stubbed, and export does not use it.

## A. Spec `FE/e2e/real-backend-pdf-export.spec.js`

- Owner: Claude. Run 2026-11-01 16:22Z, in both open-auth and protected-auth runs.
- Map: 3 tiers, 5 nodes, long Vietnamese labels with full diacritics.
- Custom node fills and text colours; fixed connector colour `#E11D48`.
- Each request carries the Chromium capture and its geometry manifest. The
  spec asserts manifest node IDs equal the map's node IDs.
- Artifacts: `claude/real-backend-pdf/`, holding for each scenario `artifact.pdf`, `source.png`, `manifest.json`, `request.json` and `expectations.json`, plus `verification.json`.

| Scenario | Pages | Embedded map vs capture (mean / max pixel delta) | Text clipping | Contrast (root / branch) | Unicode outline | Result |
|---|---|---|---|---|---|---|
| map, A4 | 1 (842×595 pt) | 0.0 / 0 | none | 13.46 / 9.30 | — | PASS |
| map + outline, content-fit | 2 | 0.0 / 0 | none | 13.46 / 9.30 | verified | PASS |
| map, content-fit | 1 (1114.6×227.4 pt) | 0.0 / 0 | none | 13.46 / 9.30 | — | PASS |

## B. Independent 4-tier export through Export Studio

- Owner: Agy. Run 2026-11-01 about 17:00Z.
- Map: 11 nodes over 4 tiers (ROOT, then SEC, then IDEA, then LEAF), with long
  Vietnamese labels and custom appearance.
- Path: Export Studio, then a real backend job, polling, and the real download.
- Scripts: `agy/audit-task2.mjs`, `agy/verify_4tier_pdf.py`.
- Raw: `agy/pdf-artifacts/`.

| Scenario | Pages | Checks | Result |
|---|---|---|---|
| map + outline (A4) | 9: overview, 7 detail crops, outline | `%PDF` header. Outline text has **11/11 titles, 0 missing, 0 extra**. Embedded map matches the capture (delta 0.0). Root fill and connector colours present. All pages rendered to PNG | PASS |
| map only, content-fit | 1 | `%PDF` header, non-blank (636,479 ink pixels), matches the capture | PASS |
| branch / selected-node scope | — | Not run as a PDF. Scope membership is covered by the fixture suite (`export-studio` 25/25 and the masked-assertion re-run in `fixture-failures-triage.md`) | NOT VERIFIED as a PDF |

The map page embeds the Chromium capture as a raster image. Labels on that
page are therefore checked by pixel identity with the capture, not by text
extraction. Text extraction applies to the outline page.

## C. Image export (R8-003 regression)

| Check | Environment | Observed | Result |
|---|---|---|---|
| Valid PNG download (Agy) | Real app | 1 download (61,777 bytes), named after the intended map | PASS |
| Valid PNG download after an Alpha-to-Beta map switch (Claude, `claude/image-export/`) | Real app | Exactly 1 file within 4 s of settle, named for Beta and not Alpha | PASS |
| Escape or "Hủy" during an image export, as separate user inputs (Claude) | Real app | The dialog refuses to close; "Hủy" is disabled; the started export yields exactly 1 file | PASS |
| Agy's "dismiss mid-capture" row | Real app | Escape was pressed **before** Export was clicked, so it does not test mid-capture | Not counted |
| Synthetic same-task click and close (Claude) | Real app | Dialog closes and 1 file still downloads, because `close()` does not clear `attemptKeyRef` | **R82-P3-02** (P3 hardening, not reachable by human input) |
| Map switch mid-capture | Unit and component (`ExportStudioDialog.imageCommitBoundary`, 36/36) | stale capture gives 0 downloads; valid capture gives 1 | PASS. Unit level; the code is unchanged since Round 8.1 |
| Fixture `export-studio` | Fixture harness | 25/25 | PASS |

Source: Agy's real-app run, plus `codex2/regression.md` for the unit and fixture rows.

## Verdict

**PASS.** The PDFs are readable and well-formed:

- every expected label is present and no extra label appears;
- the embedded map is pixel-identical to the capture;
- colours are kept;
- there are no blank pages.

Branch and selected-node scopes were not produced as PDFs. Their node
membership is verified at the fixture and SVG level.
