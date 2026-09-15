# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Product direction

- Selected visual: Product Design ideation option 2, “Learning Canvas”.
- Preserve the task-oriented study flow: learning goal, next action, grounded answer, and contextual evidence.
- Keep the cool-neutral blue visual system with Manrope UI text and Source Serif 4 editorial headings.
- This blue (`--blue`/`--blue-deep`/`--blue-soft` in `src/styles.css`: `#126cf2`/`#0c55cc`/`#eaf3ff`) is now also the real MemVidX/StudyMap app's primary interactive color (`--accent`/`--accent-hover`/`--accent-subtle` in `FE/src/index.css`) — confirmed matching exactly, no reconciliation needed. See `docs/VISUAL_IDENTITY_WORKSPACE_REDESIGN.md` for the real app's token architecture and the forest→blue decision record.
