# Mobile header proposal — “Công cụ học”

Owner decision A2 accepts the icon-only phone trigger in PR #126 only as an interim state. This proposal makes **Công cụ học** visibly discoverable at 320, 375, and 390px without increasing the 56px global header, clipping the account control, or introducing horizontal overflow.

## Recommendation

Adopt **Option A: move Usage into the Công cụ học menu**.

On phones, show the complete `Công cụ học` label in a 99 × 40px trigger; move the 40px UsageChip into the tools menu as a status/action row; and move the Library shortcut into that menu through 390px. Keep Home, the three workspace modes, and Account in the header. At 320px only, use the same tighter type and spacing measured by this prototype (11px label, 2px internal horizontal padding, zero outer gaps).

This is the strongest information architecture: AI allowance describes availability of the AI learning tools, while the account menu remains about identity, security, and sign-out. It also avoids hiding the Home control merely to preserve a low-priority status chip.

## Options evaluated

| Option | What moves where | Benefits | Costs / risks | Accessibility notes |
| --- | --- | --- | --- | --- |
| **A — Usage in Công cụ học (recommended)** | Usage moves from the header to a labelled `Mức sử dụng AI · 12%` row in the tools menu. Library joins the same menu at phone widths through 390px. | Preserves Home, modes, Account, and the full tools label; quota appears beside the tools it constrains; one coherent secondary surface. | Usage is one tap less visible. The production row should open the existing detailed usage popover/view and expose warning/exhausted state in text, not color alone. | Trigger remains 99 × 40px with its existing accessible name and menu semantics. Usage row needs a descriptive accessible name including plan state/percentage. Escape and focus restoration should follow the existing StudyToolsMenu contract. |
| **B — Usage in Account** | Usage moves to a `Mức sử dụng AI · 12%` account-menu row. Library moves into Công cụ học through 390px. | Preserves all essential header controls and gives quota a familiar billing/account-adjacent home. | Mixes product capability with identity/security; users looking for tool allowance may not inspect Account. AccountMenu and UsageChip currently own separate state, so implementation needs a single shared usage source rather than duplicate fetching. | Account trigger remains 44 × 44px. The added row needs menuitem semantics and text status; warning badges must not be color-only. Focus should return to Account on Escape/selection. |
| **C — Keep Usage in header** | Usage stays as a 40px header control. Home/brand and Library both move into Công cụ học on phones to make room for the full label. | Preserves immediate quota visibility and the existing UsageChip interaction. | Removes the only visible Home/brand affordance and overloads the tools menu with global navigation. The header loses orientation and hierarchy; this is not recommended. | All remaining controls pass geometry/hit tests, but hidden Home becomes one tap deeper. The moved Home row must be first-class navigation with an icon and accessible label. |

## Measurements

Measurements were captured from the real `MainLayout` using the fixture server on port 5228. Each option was temporarily prototyped in JSX/CSS, loaded with mocked authenticated/usage API responses, measured in Chromium, and then removed from product code.

| Option | Viewport | Header | Tools trigger | Account | Other persistent controls | Header overflow | Document overflow | Full label / center hit |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| A — tools menu | 320 | 56px | 99 × 40 | 44 × 44 | Home 40 × 40; modes 3 × 40 × 40 | 0px | 0px | Pass / Pass |
| A — tools menu | 375 | 56px | 99 × 40 | 44 × 44 | Home 40 × 40; modes 3 × 40 × 40 | 0px | 0px | Pass / Pass |
| A — tools menu | 390 | 56px | 99 × 40 | 44 × 44 | Home 40 × 40; modes 3 × 40 × 40 | 0px | 0px | Pass / Pass |
| B — account menu | 320 | 56px | 99 × 40 | 44 × 44 | Home 40 × 40; modes 3 × 40 × 40 | 0px | 0px | Pass / Pass |
| B — account menu | 375 | 56px | 99 × 40 | 44 × 44 | Home 40 × 40; modes 3 × 40 × 40 | 0px | 0px | Pass / Pass |
| B — account menu | 390 | 56px | 99 × 40 | 44 × 44 | Home 40 × 40; modes 3 × 40 × 40 | 0px | 0px | Pass / Pass |
| C — keep Usage | 320 | 56px | 99 × 40 | 44 × 44 | Usage 40 × 40; modes 3 × 40 × 40 | 0px | 0px | Pass / Pass |
| C — keep Usage | 375 | 56px | 99 × 40 | 44 × 44 | Usage 40 × 40; modes 3 × 40 × 40 | 0px | 0px | Pass / Pass |
| C — keep Usage | 390 | 56px | 99 × 40 | 44 × 44 | Usage 40 × 40; modes 3 × 40 × 40 | 0px | 0px | Pass / Pass |

“Center hit” means `document.elementFromPoint()` at the geometric center returned the control or one of its descendants. Every visible header control was also checked to be at least 40 × 40px. The label check verified that the visible text bounding box remained entirely inside the tools-trigger bounding box.

## Evidence

### Option A — Usage in Công cụ học

- [320px](evidence/mobile-header-proposal/tools-320.png)
- [375px](evidence/mobile-header-proposal/tools-375.png)
- [390px](evidence/mobile-header-proposal/tools-390.png)

### Option B — Usage in Account

- [320px](evidence/mobile-header-proposal/account-320.png)
- [375px](evidence/mobile-header-proposal/account-375.png)
- [390px](evidence/mobile-header-proposal/account-390.png)

### Option C — keep Usage in the header

- [320px](evidence/mobile-header-proposal/keep-usage-320.png)
- [375px](evidence/mobile-header-proposal/keep-usage-375.png)
- [390px](evidence/mobile-header-proposal/keep-usage-390.png)

## Implementation boundary for a follow-up product PR

This proposal does not change the header architecture. A follow-up implementation should:

1. Reuse one UsageChip data owner; do not introduce a second `/usage/me` fetch in a menu.
2. Render the current usage detail interaction from the selected secondary surface, including loading, retry, warning, and exhausted states.
3. Extend the existing phone-only Library relocation breakpoint from 340px to the measured composition boundary (390px), rather than relying on page-level overflow alone.
4. Add regression coverage at 320/375/390px for 56px height, all controls at least 40 × 40px, center hit ownership, no header/document overflow, and the complete visible `Công cụ học` label.
5. Retain the existing Escape/outside-click focus-restoration behavior and verify keyboard traversal of the new usage row.
