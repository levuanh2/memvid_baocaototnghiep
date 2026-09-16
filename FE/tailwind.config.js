/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  // ── Dark mode via .dark class on <html> ──────────
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // "brand" is now the seal red (son). Channel syntax so opacity
        // utilities (bg-brand/8, border-brand/40) work AND the value
        // flips automatically light↔dark via --brand-rgb.
        brand: {
          DEFAULT: "rgb(var(--brand-rgb) / <alpha-value>)",
          ink:     "rgb(var(--ink-rgb) / <alpha-value>)",
        },
        seal: "rgb(var(--brand-rgb) / <alpha-value>)",
        // Visual Identity Reset, blue decision: primary interactive is
        // `accent` (--accent/--accent-hover/--accent-subtle, blue). Exposed
        // as a Tailwind color so the ~50 JSX call sites that used to reach
        // for `text-forest`/`bg-forest`/`accent-forest` as "the" action
        // color can reach for `text-accent`/`accent-accent` etc. instead,
        // one JSX class swap per call site rather than a token-only fix —
        // deliberate, not a blind find-replace (see
        // docs/VISUAL_IDENTITY_WORKSPACE_REDESIGN.md for the per-file
        // categorization: interactive/selected/focus → accent,
        // success/ready/progress → stays forest).
        accent: {
          DEFAULT: "var(--accent)",
          hover:   "var(--accent-hover)",
          subtle:  "var(--accent-subtle)",
        },
        // forest keeps its Wave-1 value and role narrows to success/
        // ready-status/progress only (MindMap's own selection ring/hover
        // and `::selection` also read `--forest` directly and are
        // unaffected — its VALUE did not change, only which JSX call sites
        // reach for it as a Tailwind class).
        forest: "rgb(var(--forest-rgb) / <alpha-value>)",
        bronze: "rgb(var(--bronze-rgb) / <alpha-value>)",
        // Surface/text/border reference CSS variables so they flip
        // automatically when .dark is toggled on <html>.
        surface: {
          base:     "var(--bg-base)",
          sidebar:  "var(--bg-sidebar)",
          card:     "var(--bg-card)",
          elevated: "var(--bg-elevated)",
          panel:    "var(--bg-panel)",
          hover:    "var(--bg-hover)",
        },
        text: {
          primary:   "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted:     "var(--text-muted)",
          inverse:   "var(--text-inverse)",
        },
        slate: "var(--slate)",
        border: "var(--border-color)",
        "border-strong": "var(--border-strong)",
      },
      fontFamily: {
        // Three voices: scholarship (serif), instrument (sans), apparatus (mono).
        // Wave 1: `reading` was a duplicate alias of `display` (same Spectral
        // stack) — collapsed to one role per the Signature Contract; Spectral
        // stays (not swapped to Fraunces — see docs/UI_IMPLEMENTATION_PLAN.md).
        display: ["Spectral", "Georgia", "serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Wave 1: named scale (docs/DESIGN_TOKEN_AUDIT.md §1) — additive only.
        // Sprint G: extended into the FULL semantic scale (docs/SPRINT_F_
        // REPORT.md §9's "~495 arbitrary text-[Npx] instances" debt item) —
        // every role below exists ONCE; components consume it instead of a
        // new arbitrary pixel value. Sizes are the REAL values sampled from
        // the app's own existing usage (grep census, not invented), grouped
        // by the semantic role each cluster of nearby values actually plays.
        display: ["clamp(2.6rem, 5vw, 4.4rem)", { lineHeight: "1.05" }],
        h1: ["2.25rem", { lineHeight: "1.15" }],
        h2: ["1.5rem", { lineHeight: "1.25" }],
        h3: ["1.2rem", { lineHeight: "1.3" }],
        // Component/card/node title (e.g. a StudyCard's document name, a
        // KnowledgeInspector node header) — smaller than an H3 in-content
        // sub-head, bigger than body.
        title: ["1.0625rem", { lineHeight: "1.35", fontWeight: "600" }],
        // Secondary line directly under a title (dialog subtitle, breadcrumb
        // under a node title).
        subtitle: ["0.9375rem", { lineHeight: "1.45" }],
        // Comfortable long-form reading prose (Summary/Inspector notes).
        // This is what `body` meant before Sprint G — Markdown.jsx's MdProse
        // is repointed from `text-body` to `text-body-lg` in this same
        // sprint so its actual rendered size does not change; `body` itself
        // is freed up below to mean the smaller, much-more-common dense-UI
        // text size instead (14px was the single highest-count "normal
        // text" size in the app-wide grep census, not 16px).
        "body-lg": ["1rem", { lineHeight: "1.7" }],
        body: ["0.875rem", { lineHeight: "1.55" }],
        small: ["0.8125rem", { lineHeight: "1.5" }],
        label: ["0.8rem", { lineHeight: "1.4", letterSpacing: "0.06em" }],
        caption: ["0.71875rem", { lineHeight: "1.45" }],
        // Mono uppercase tracked micro-label (section eyebrows, "BẰNG CHỨNG",
        // node numbers) — was 3 different arbitrary sizes (10/10.5/11px) and
        // ~15 different tracking-[Nem] values across 40+ files, all playing
        // this exact one role. One token, one tracking value.
        metadata: ["0.65625rem", { lineHeight: "1.4", letterSpacing: "0.12em" }],
        // Inline mono figures at body-adjacent size (counts, IDs, timestamps
        // outside a metadata-label context) — tabular so digits line up.
        mono: ["0.8125rem", { lineHeight: "1.4" }],
      },
      spacing: {
        // Wave 1: named steps on top of Tailwind's default scale (which stays
        // available) — for the handful of magic px values worth naming
        // deliberately, not a replacement for the whole default scale.
        "4.5": "1.125rem",
        "6.5": "1.625rem",
        "18": "4.5rem",
      },
      borderRadius: {
        // Wave 1: interactive-control ceiling per the redesign spec — applied
        // to buttons/inputs/chips/badges/palette rows as each is touched in
        // Waves 2-7, never to panels/cards/containers (those go to 0/square).
        control: "3px",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Wave 2: Modal's open animation — opacity only, no translate, inside
        // the redesign's ~180ms motion ceiling (was fadeUp's 450ms/12px).
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        // Wave 8 cleanup: was named `pulse`, silently overriding Tailwind's
        // OWN built-in `pulse` keyframe (used by the plain `animate-pulse`
        // utility — real, active consumers: ChatArea's typing cursor,
        // DocumentList/KnowledgePanel's skeleton loaders). `extend.keyframes`
        // merges by key name, so every one of those was actually animating
        // with this 0.4-opacity custom curve instead of Tailwind's intended
        // default (0.5) the whole time — a real, if subtle, side effect
        // nobody asked for. Renamed to its own name; `animate-pulse` now
        // gets Tailwind's real default back, `animate-pulseSoft` keeps
        // behaving exactly as before (same curve, just no longer sharing a
        // name with something else).
        pulseSoft: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        fadeUp: "fadeUp 450ms ease-out both",
        fadeIn: "fadeIn 180ms ease-out both",
        pulseSoft: "pulseSoft 1.3s ease-in-out infinite",
      },
      boxShadow: {
        // Wave 3: `glow` (a hardcoded, non-dark-aware seal-red ring) removed —
        // its only consumer (SidebarLeft's source-card selection state) now
        // uses a single left accent bar + bg tint instead (see that file).
        card:         "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        header:       "0 1px 0 var(--border-color)",
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
