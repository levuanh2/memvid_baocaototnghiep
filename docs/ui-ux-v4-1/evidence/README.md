# Evidence

## How it was captured

The real frontend (`main` `ec4d1af`) ran on the Vite dev server. Every call to
the API origin (`localhost:8080` in dev) was answered by a Playwright route
handler with fixed test data: 6 documents, 1 collection, 1 mind map, 1
summary, 1 quiz, 1 graded attempt, 1 review plan, 1 practice quiz. No
production API, account or data was used. The Library flag-ON screens come
from a local dev server started with `VITE_LIBRARY_ACTION_MATRIX=true`; the
flag was never changed in production.

Scripts (in `capture/`; they are not part of any CI suite):

| Script | What it does |
|---|---|
| `audit-capture.spec.js` | 20 screen states × 5 widths × light/dark; writes `screens/*.jpg` and, at 390 and 1440 light, `inventory/*.json` (visible controls, region, accessible name, first Tab stops, horizontal overflow, headings) |
| `verify-cta.spec.js` | Clicks "Tạo tóm tắt" and "Tạo sơ đồ tư duy" with a source selected, Guided capability on and off; records non-GET requests and dialogs |
| `verify-summary-open.spec.js` | Existing summary + selected source in Summary mode; Library card "Tóm tắt" destination |

To re-run: copy a script to `FE/e2e-audit-tmp/`, create a config that extends
`FE/playwright.fixture.config.js` with `testDir: "./e2e-audit-tmp"`, and run
`npx playwright test -c <that config>` from `FE/`. For flag-ON screens set
`VITE_LIBRARY_ACTION_MATRIX=true AUDIT_FLAG=on`.

## File names

`screens/<screen>__<width>__<theme>[__flagon].jpg`, for example
`library__390__dark.jpg`. Screens: `landing`, `login`,
`workspace-chat-empty`, `workspace-chat`, `workspace-chat-active`,
`workspace-map`, `workspace-summary`, `workspace-tools-menu`,
`workspace-account-menu`, `workspace-map-export`, `library`,
`library-empty`, `library-doc-menu`, `studymap`, `quiz-setup`,
`quiz-taking`, `quiz-result`, `review-guide`, `practice`, `profile`.
`verify-*` files are the click-through checks.

Limits: `library-doc-menu` did not open the card menu (selector did not
match), so it equals `library`; `workspace-chat-active` fills the box but
does not send. Data shapes are fixtures; any finding that depends on real
server data is marked NOT VERIFIED in `03-ux-audit.md`.
