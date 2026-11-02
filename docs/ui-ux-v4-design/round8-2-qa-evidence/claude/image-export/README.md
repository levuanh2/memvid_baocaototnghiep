# R8-003 in the real app: image-export commit boundary

Owner: Claude. Run 2026-11-01 about 17:45Z.

| Item | Value |
|---|---|
| Tree | `c02e2b9` |
| Frontend | Production-equivalent build on `:4173` |
| Backend | Real Flask on `:8080` with `AUTH_PROTECT_APP_APIS=true` |
| Database | Disposable Postgres |
| Maps | Seeded through the real `/generate-mindmap`, using the stub AI graph, then `PUT /mindmaps` |
| Spec | `image-export-real-backend.spec.js` |
| Raw | `results.json` |

| Step | Expected | Observed | Result |
|---|---|---|---|
| Open map Alpha, then map Beta. Export PNG once | Exactly 1 file, named for Beta | `R82_Map_Beta_…-20261101.png`, a single download within 4 s of settle | PASS |
| Click "Xuất PNG", then press Escape and try "Hủy" as separate input events | The dialog cannot close mid-export. The started export yields exactly 1 file | Dialog still open after Escape; "Hủy" disabled; exactly one more file | PASS |
| Synthetic: `btn.click()` and an Escape keydown in **the same JS task**, before React renders `exporting=true` | — (recorded, not asserted) | Dialog closed, and **1 file was still downloaded after the close** | FINDING R82-P3-02 |

## R82-P3-02: closing the dialog does not invalidate an in-flight image attempt

| Field | Detail |
|---|---|
| Where | `FE/src/components/mindmap/ExportStudioDialog.jsx:228` |
| Code | `const close = () => { if (!exporting) { abortRef.current?.abort(); onClose?.(); } };` |

Mechanism:

1. `close()` reads the `exporting` state from the last render.
2. It aborts the controller, but it does not clear `attemptKeyRef`.
3. The image path (`runImage`, lines 279–283) checks only `attemptKeyRef`, not
   the abort signal.
4. When the dialog closes but stays mounted with `open=false`, the capture
   that is already in flight still reaches `commitDownload`.

What still invalidates the attempt correctly:

| Event | Code |
|---|---|
| Map switch | effect at line 230 |
| Unmount | effect at line 229 |
| Cancel | line 353 |

**Reachability.** A real pointer or keyboard user cannot hit this. Click is a
discrete event, so React commits `exporting=true` before the next input event
is handled. From then on, Escape is ignored and "Hủy" is disabled, as step 2
shows. Only script that dispatches close in the same task as the click can
trigger it.

**Severity.** P3 hardening; not a release blocker. Round 8.1's R8-003 cases
remain closed: map switch, unmount and newer attempt (unit tests, 36/36).

**Minimal fix** (not applied in this audit):

```js
const close = () => { if (!inFlightRef.current) { attemptKeyRef.current = null; abortRef.current?.abort(); onClose?.(); } };
```

Add a unit test that clicks Export, calls `onClose` in the same act, and
asserts `commitDownload` is called 0 times.
