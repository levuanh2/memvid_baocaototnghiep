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
        // Wave 1 (additive): the new forest/bronze roles from the Signature
        // Contract. NOT wired up as the default action/selection color yet —
        // `--accent`'s ~110 existing consumers mix genuine primary-action
        // uses with provenance/citation uses that must stay seal-red, so the
        // split happens per-component across Waves 2-7, not as one blind
        // repoint here (see docs/UI_IMPLEMENTATION_PLAN.md's revision note).
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
        // Existing `text-[Npx]` arbitrary values are migrated per-component,
        // by semantic role, across Waves 2-7 (not a single blind codemod —
        // see UI_IMPLEMENTATION_PLAN.md Task 20's revision note).
        display: ["clamp(2.6rem, 5vw, 4.4rem)", { lineHeight: "1.05" }],
        h1: ["2.25rem", { lineHeight: "1.15" }],
        h2: ["1.5rem", { lineHeight: "1.25" }],
        h3: ["1.2rem", { lineHeight: "1.3" }],
        body: ["1rem", { lineHeight: "1.7" }],
        label: ["0.8rem", { lineHeight: "1.4", letterSpacing: "0.06em" }],
        caption: ["0.72rem", { lineHeight: "1.4", letterSpacing: "0.06em" }],
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
        pulse: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        fadeUp: "fadeUp 450ms ease-out both",
        fadeIn: "fadeIn 180ms ease-out both",
        pulseSoft: "pulse 1.3s ease-in-out infinite",
      },
      boxShadow: {
        glow:         "0 0 0 2px rgba(178,58,46,0.18)",
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
