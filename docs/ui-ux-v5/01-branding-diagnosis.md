# StudyMap branding diagnosis: why the live site still looks like MemVidX

Date: 2026-11-10 · Main `d912419` · Live site `https://studymap.space/` (Render `studymap-web` behind Cloudflare).

## Verdict

**Not a deployment problem and not a cache problem.** Production serves the current main build. The old brand survives as **visual marks** that PR #134 (text-only rename) did not touch:

1. **Favicon** `/favicon.svg`: a red seal with a serif **"M"** and an **"X" badge**, i.e. the MemVidX logo from commit `f8c2250` ("add MemVidX custom brand seal favicon"). It shows on every browser tab, bookmark and history entry.
2. **Wordmark seal "M"** (the MemVid initial) beside "StudyMap" in:
   - the Landing header (`FE/src/pages/Landing.jsx:103-105`);
   - the app shell home link (`FE/src/components/Layout/MainLayout.jsx:613-623`).

   Below `lg` (<1024px) the app shell hides the "StudyMap" text (`hidden lg:block`), so tablets and phones show **only the "M" seal**.

There is **no user-visible "MemVid" text** anywhere on the live site.

## Verified facts

| Check | Result | Evidence |
|---|---|---|
| Production HTML | `<title>StudyMap — Đọc · Truy hồi · Dẫn chứng</title>`; `last-modified: Tue, 10 Nov 2026 15:52:39 UTC`, i.e. right after the #148 merge (15:45Z) | captured `prod-index.html` / headers (QA evidence store) |
| Cloudflare / HTTP cache | `cf-cache-status: DYNAMIC`; `Cache-Control: public, max-age=0, s-maxage=300` (the HTML is not edge-cached) | `prod-index.headers` |
| Service worker | `/sw.js` and `/service-worker.js` return 404; no registration in the source | curl |
| Live bundle is current main | The 34 production chunks contain #148 ("Xem lại câu chưa đúng", "Đúng một phần") and #150 (`max-width:300px`, `flex-shrink:0` on the arrow, the `max-width:359px` rule) | `chunks/` |
| "MemVid" in the production JS/CSS | Only internal identifiers: `memvid-token`, `memvid-theme`, `memvid.nguon_dang_xu_ly`, `memvidx.*` localStorage keys and `memvidx:open-*` event names. **0 user-visible strings.** | grep of `chunks/` |
| Rendered DOM, logged out (1440px and 390px) | 0 text nodes containing "memvid". Header text: "M / StudyMap / …" | `evidence/branding/before-landing-*.png` |
| Favicon | Identical to main's `FE/public/favicon.svg` (`cmp` differs only by CRLF line endings): "M" + "X" badge | `evidence/branding/before-favicon-memvidx.png` |
| `site.webmanifest` / `manifest.webmanifest` | Not real manifests: the 1824-byte responses are the SPA fallback `index.html` | curl |

Local and production build hashes differ (`index-DU8OKp1E.js` vs `index-BeXoyW5x.js`) because the production build embeds environment-specific values (for example `VITE_API_URL`). The feature-string check above is the authoritative "is current" proof.

## Not verified (hypotheses / limits)

- **Logged-in production UI:** not inspected, because no QA credentials were used. The source shows the same "M" seal in `MainLayout`.
- **Render dashboard deploy history:** not opened, because Render was not touched. The `last-modified` header and the live chunk contents already prove the deployed build is current.
- **A browser with an old favicon cached:** even after the favicon changes, Chrome keeps favicons per URL for a long time.

## Fix (V5-A, needs a Draft PR; no deploy without approval)

- **New StudyMap mark:** replace the "M"+"X" seal with a StudyMap mark, in both the favicon and the wordmark seal.
- **New favicon URL:** serve it under a **new URL**, for example `/studymap-mark.svg` (and update `index.html`), so browsers fetch it instead of reusing the cached `/favicon.svg`. Keep `/favicon.svg` with the new artwork for clients that request it directly.
- **Short screens:** keep a recognizable "StudyMap" identity below `lg`, not a lone initial.
- **Leave internal identifiers alone:** `memvid-*` / `memvidx.*` stay as they are, because renaming them would log users out and reset their preferences; that needs a separate compatibility plan.
- **Verify in a private window** after any approved deploy.
