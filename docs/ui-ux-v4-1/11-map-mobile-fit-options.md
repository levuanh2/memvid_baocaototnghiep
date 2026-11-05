# Mobile Mind Map initial-fit options

Status: comparison evidence only. None of the layouts below is accepted. The
owner's real-phone check decides whether any option should become product code.

## Why this comparison exists

Main keeps phone maps at a minimum scale of `0.75` and centres the root. PR
#130 instead frames the root and first-level nodes, allowing scale down to
`0.50`. The latter increases initial branch coverage, but the fixture also
shows much smaller rendered labels and overlapping selection markers. This
document separates those tradeoffs instead of treating branch count alone as
the acceptance criterion.

All alternatives were browser-only prototypes against the fixture harness.
No prototype code remains in PR #130, and none is included in this docs PR.

## Measurement method

- Viewports: `320×844` and `390×844`; fixture server port `5241`.
- Scale: live Mind Elixir `scaleVal` after the one-shot initial placement.
- Rendered label px: minimum `computed font-size × scale` across rendered
  topics. This is a measurement, **not** a claim that 6px, 7px, or 9px is
  readable.
- Inside count: a node's complete screen box is inside `.map-container`.
- Marker overlaps: intersecting pairs across all selection-mode 40px marker
  hosts, plus the stricter count for their visible 20px dots.
- Touch targets: smallest measured marker host and smallest map/selection
  control. All variants preserve the existing 40×40px floor.
- Refit: whether selection, expand/collapse, or export triggers a later fit.
  Every compared layout is one-shot and reports `no`.

Raw measurements: [metrics.json](evidence/map-fit-options/metrics.json).

## Layouts compared

1. **Main — root centred at 0.75.** Existing behavior: fit once, apply the
   0.75 floor, then centre the root. It provides no explicit pan cue.
2. **PR #130 — root + first level at 0.50.** Current Draft behavior. It centres
   the depth≤1 bounding box and clamps scale to `[0.5, 1]`.
3. **Option A — readable root + pan hint.** Keeps main's 0.75/root-centred
   geometry and adds a visible “Kéo để xem các nhánh” cue. Branches remain
   reachable by panning.
4. **Option B — readable priority branch.** Keeps 0.75 and greedily frames the
   root plus first-level branches in source order when their complete boxes
   fit. At 320px no full root+branch pair fits; the prototype shifts toward
   the first branch only until the root reaches its safe edge, leaving an
   honest branch preview instead of shrinking.

## Results

### 320×844

| Layout | Scale | Min rendered label | Root inside | First level inside | Marker overlaps, host / visible dot | Touch targets, marker / min control | Later refit |
|---|---:|---:|:---:|---:|---:|---:|:---:|
| Main | 0.75 | 9px | yes | 0 / 5 | 28 / 0 | 40×40 / 40×40 | no |
| PR #130 current | 0.50 | 6px | yes | 1 / 5 | 41 / 17 | 40×40 / 40×40 | no |
| Option A | 0.75 | 9px | yes | 0 / 5 | 28 / 0 | 40×40 / 40×40 | no |
| Option B | 0.75 | 9px | yes | 0 / 5 full; first branch previewed | 28 / 0 | 40×40 / 40×40 | no |

### 390×844

| Layout | Scale | Min rendered label | Root inside | First level inside | Marker overlaps, host / visible dot | Touch targets, marker / min control | Later refit |
|---|---:|---:|:---:|---:|---:|---:|:---:|
| Main | 0.75 | 9px | yes | 0 / 5 | 28 / 0 | 40×40 / 40×40 | no |
| PR #130 current | 0.50 | 6px | yes | 5 / 5 | 41 / 17 | 40×40 / 40×40 | no |
| Option A | 0.75 | 9px | yes | 0 / 5 | 28 / 0 | 40×40 / 40×40 | no |
| Option B | 0.75 | 9px | yes | 2 / 5 visible (1 deliberately framed) | 28 / 0 | 40×40 / 40×40 | no |

The host-overlap count includes invisible parts of adjacent 40px hitboxes; the
visible-dot count is the stronger signal for visual ambiguity. The current
50% layout is the only comparison with visible-dot overlaps in this fixture.

## Screenshots

| Layout | 320px | 390px |
|---|---|---|
| Main | [main-320.png](evidence/map-fit-options/main-320.png) | [main-390.png](evidence/map-fit-options/main-390.png) |
| PR #130 current | [current-50-320.png](evidence/map-fit-options/current-50-320.png) | [current-50-390.png](evidence/map-fit-options/current-50-390.png) |
| Option A | [option-a-readable-pan-320.png](evidence/map-fit-options/option-a-readable-pan-320.png) | [option-a-readable-pan-390.png](evidence/map-fit-options/option-a-readable-pan-390.png) |
| Option B | [option-b-priority-branch-320.png](evidence/map-fit-options/option-b-priority-branch-320.png) | [option-b-priority-branch-390.png](evidence/map-fit-options/option-b-priority-branch-390.png) |

## Owner validation required

On real 320px and 390px phones, compare text recognition without pinch zoom,
whether the pan cue is noticed, whether the priority bias feels predictable,
and whether reaching omitted branches feels easier than reading the 50% full
overview. That real-device result—not these pixel measurements—chooses the
product behavior.
