# H3C PDF file-size benchmark

Date: 2026-10-17

Baseline revision: `d31d942fe24250eb6dedd481a0a22c670dc291c3`

Candidate: final PyMuPDF serialization with `deflate=True`

## Root cause

The frontend browser capture was already a compact PNG. In the disposable
production 57-node run, the 5066×1350 RGBA request contained 729,172 decoded
PNG bytes. `Page.insert_image(stream=...)` decoded it into one reusable PDF
image XREF, but the final `Document.tobytes()` wrote that XREF as two raw,
unfiltered streams:

- RGB image: 20,517,300 bytes (`5066 × 1350 × 3`).
- Alpha soft mask: 6,839,100 bytes (`5066 × 1350 × 1`).
- Final PDF: 28,162,621 bytes.

Thus H3B's single-XREF reuse was correct; the remaining expansion happened at
final PDF stream serialization, not in pagination, base64, or duplicate image
embedding.

## End-to-end byte accounting

| Stage | Measured value | Notes |
|---|---:|---|
| Canvas CSS dimensions | not separately recorded | The captured bitmap and same-DOM manifest are authoritative; H3C does not alter capture scale or geometry. |
| Captured raster | 5066×1350 RGBA | Reported by the production request geometry manifest. |
| Raw pixel memory | 27,356,400 bytes | `width × height × 4`; this is the lower-bound decoded raster allocation, not peak process RSS. |
| Encoded PNG | 729,172 bytes | Decoded directly from the captured production request. |
| Base64 payload | 972,232 characters | 33.33% transport expansion over the PNG; no `data:` prefix. |
| Backend decoded image | 729,172 bytes | Input validation decodes the same payload once before serialization. |
| Baseline embedded image streams | 27,356,400 bytes | 20,517,300-byte RGB XObject + 6,839,100-byte alpha SMask, both raw. |
| Candidate embedded image streams | 460,610 bytes | 284,645-byte RGB XObject + 175,965-byte alpha SMask, both Flate-filtered. |
| Final PDF | 28,162,621 → 886,057 bytes | Pagination, text, geometry, and the single image XREF are unchanged. |
| Production-browser capture time | not separately instrumented | H3C makes no frontend change; serializer timing is isolated below. |
| Candidate re-serialization | 256.1 ms | Exact downloaded production artifact. |

The controlled benchmark records fresh-process native peak-RSS deltas and
synthetic PNG-generation time separately. It does not label that synthetic
generation time as a production-browser capture measurement.

## Exact production-browser artifact

The candidate was applied losslessly to the downloaded H3B.1 production PDF:

| Metric | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| PDF bytes | 28,162,621 | 886,057 | -96.85% (31.78× smaller) |
| Page count | 6 | 6 | 0 |
| Unique map image XREFs | 1 | 1 | 0 |
| RGB XObject bytes | 20,517,300 raw | 284,645 Flate | -98.61% |
| Rendered-page SHA-256 | reference | identical on all 6 pages | no visual delta |
| Extracted text | reference | identical | no content delta |
| Re-serialization time | — | 256.1 ms | bounded final pass |

PyMuPDF inspection found no blank/corrupt pages, no Map A text, correct Map B
title/content, and intact Vietnamese strings (`ă â ê ô ơ ư đ Á Ế Ổ Ờ Ữ`). The
overview, typical detail page, densest detail page, and both outline pages were
rendered at 1.5× and inspected. Thin connectors, region boxes, text, and
diacritics were unchanged.

The historical production artifact reported before H3C was 84,504,157 bytes
for a different 57-node/7-page map. That exact source artifact was not retained,
so this report does not invent a candidate byte count for it. The disposable
production fixture above is the reproducible before/after artifact gate.

## Controlled serializer benchmark

Every row uses the real production serializer in isolated subprocesses. The
baseline patches only the final `Document.tobytes` call to ignore `deflate`,
recreating pre-H3C behavior. PNGs are deterministic RGBA mind-map-like rasters;
page rendering is hashed before/after. Native RSS is sampled every 2 ms. Full
machine-readable results are in `h3c-pdf-size-benchmark.json`.

| Fixture | Scope | Nodes | Raster px | Image bytes | PDF before | PDF after | Ratio | Pages | Min effective font | Peak RSS before/after | Serialize before/after |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Small | full | 12 | 1400×900 | 105,737 | 4,728,679 | 482,727 | 9.80× | 2 | 16.33 pt | 14.8/14.8 MiB | 142/204 ms |
| Medium | full | 36 | 2600×1400 | 344,241 | 12,171,632 | 650,350 | 18.72× | 2 | 8.79 pt | 40.1/40.1 MiB | 342/446 ms |
| Large | full | 57 | 5066×1350 | 632,722 | 22,174,938 | 845,221 | 26.24× | 3 | 4.81 pt | 73.9/73.9 MiB | 636/796 ms |
| Very large | full | 110 | 6000×4000 | 1,675,592 | 75,814,093 | 1,571,825 | 48.23× | 4 | 3.56 pt | 258.0/258.0 MiB | 1,798/2,182 ms |
| Wide | full | 40 | 6000×1200 | 421,848 | 23,297,537 | 711,265 | 32.76× | 2 | 3.81 pt | 78.4/78.5 MiB | 534/714 ms |
| Tall | full | 40 | 1600×6000 | 456,505 | 30,797,534 | 737,160 | 41.78× | 2 | 3.81 pt | 103.6/103.5 MiB | 673/892 ms |
| Dense text | full | 80 | 4200×2400 | 821,658 | 32,306,935 | 975,492 | 33.12× | 3 | 3.99 pt | 109.3/108.6 MiB | 757/1,015 ms |
| Long Vietnamese | full | 35 | 3600×1800 | 364,479 | 21,046,429 | 666,685 | 31.57× | 2 | 6.35 pt | 70.2/70.2 MiB | 460/613 ms |
| Dark | full | 35 | 3600×1800 | 370,894 | 21,046,398 | 670,759 | 31.38× | 2 | 6.35 pt | 70.0/70.0 MiB | 453/608 ms |
| Single branch | current_branch | 14 | 2200×1400 | 144,930 | 10,416,693 | 511,346 | 20.37× | 2 | 10.39 pt | 34.0/34.0 MiB | 227/331 ms |
| Multiple branches | selected_branches | 28 | 3400×1600 | 292,998 | 17,794,881 | 616,664 | 28.86× | 2 | 6.72 pt | 59.2/59.2 MiB | 387/526 ms |

All 11 candidates retained one image XREF, identical page counts, zero blank
pages, and identical rendered-page hashes. The low overview font figures in
large synthetic rows describe overview-only fixtures without a geometry
manifest; they are measurement inputs, not a readability regression. H2/H3B
geometry-manifest pagination and its minimum-font gates are exercised by the
real production artifact and existing branch-aware suites.

## Strategy decision

- **Selected — backend Flate stream compression:** one serializer option,
  existing PyMuPDF dependency, no API/manifest/capture changes, lossless,
  9.8×–48.23× reduction, no material RSS change.
- **PNG re-encoding/palette/alpha removal:** rejected for now. The source PNG
  is already compact; changing alpha or palette adds frontend work and browser
  variability while addressing the wrong expansion point.
- **Adaptive downscaling:** rejected. It would reduce effective font size and
  require coordinate rescaling guarantees for the geometry manifest.
- **JPEG/WebP conversion:** rejected. Lossy text/connector artifacts and a
  decode/re-encode pass are unnecessary after lossless compression meets the
  objective.
- **Hybrid/vector rendering:** rejected as disproportionate scope and risk;
  it would replace the established browser-render fidelity contract.
- **Aggressive PDF garbage/object-stream options:** rejected. On the real
  artifact they saved only about 16 KB beyond plain `deflate=True`, with more
  compatibility surface and no meaningful benefit.
