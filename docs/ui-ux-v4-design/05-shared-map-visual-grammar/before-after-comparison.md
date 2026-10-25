# 05.2 — Side-by-Side BEFORE / AFTER Comparison

**Author**: Independent Product & Architecture Reviewer (Antigravity / Agy)
**Sample Dataset**: Canonical Computer Science curriculum module (*"Hệ điều hành: Quản lý Tiến trình & Đa nhiệm"*).
**Engines Examined**: `MindElixirView.jsx` (mind-elixir) vs `StudyMapView.jsx` (react-d3-tree).

---

## 1. Canonical Benchmark Sample Data

To verify visual grammar parity without backend data skew, both engines are evaluated against the identical conceptual hierarchy:

- **Root (Level 0)**: `Hệ điều hành Hiện đại`
  - **Section (Level 1)**: `1. Quản lý Tiến trình (Process Management)`
    - **Concept (Level 2)**: `Khối điều khiển tiến trình (PCB)`
      - **Leaf (Level 3)**: `PID, Con trỏ lệnh PC, Trạng thái thanh ghi`
      - **Leaf (Level 3)**: `Bảng bộ nhớ & Danh sách tệp mở`
    - **Concept (Level 2)**: `Mô hình Đa luồng (Multithreading)`
      - **Leaf (Level 3)**: `User-level thread vs Kernel thread`
  - **Section (Level 1)**: `2. Lập lịch CPU (CPU Scheduling)`
    - **Concept (Level 2)**: `Thuật toán Lập lịch`
      - **Leaf (Level 3)**: `Round Robin (Quantum time = 20ms)`
      - **Leaf (Level 3)**: `Shortest Job First (SJF / SRTF)`

---

## 2. Side-by-Side Visual Comparison

### BEFORE Phase B: Visual Disconnection

```
──────────────────────────────────────────────────────────────────────────────────────────
MINDELIXIR (BEFORE Phase B in /app)
──────────────────────────────────────────────────────────────────────────────────────────
• Root: Blue box `#126CF2`, white text, 8px radius.
• Level 1: White card with 1px border.
• Level 2: Bare text floating in space, no background, colorful underline.
• Selection Ring: Muddy Forest Green `#1F4033` (leftover from Paper & Graphite theme).
• Canvas: Plain gray background without texture.
• Connectors: Vibrant curved lines cycling blue, orange, green, purple.
• Font: Sans-serif (Aptos/System UI).

Visual Impression: Rich, colorful dynamic mind-map, but selection ring clashes horribly
with blue UI; subtopics feel flimsy without container structure.

──────────────────────────────────────────────────────────────────────────────────────────
STUDYMAPVIEW (BEFORE Phase B in /app/study/map/:id)
──────────────────────────────────────────────────────────────────────────────────────────
• Root: 9px circle, solid blue fill.
• Level 1: 7px hollow circle with blue stroke.
• Level 2: 5px hollow circle with gray stroke.
• Selection: Circle outline gets thicker (stroke-width 3). Text has no selection cue.
• Canvas: Pure white card `.surface-card` inside a container.
• Connectors: Single monotone gray lines (`stroke: var(--border-strong)`), rigid 90° steps.
• Font: Serif (`Spectral, Georgia`), hard-truncated at 46 characters with `.slice(0, 46)`.

Visual Impression: Looks like an academic network graph from 2012; feels like an entirely
different software application from the Mind Map in /app.
──────────────────────────────────────────────────────────────────────────────────────────
```

---

### AFTER Phase B: Shared Visual Grammar

```
──────────────────────────────────────────────────────────────────────────────────────────
MINDELIXIR (AFTER Phase B in /app)
──────────────────────────────────────────────────────────────────────────────────────────
• Root:
  ┌──────────────────────────────────────────────────┐
  │  📘 Hệ điều hành Hiện đại                         │  [Fill: #126CF2, Color: #FFFFFF]
  └──────────────────────────┬───────────────────────┘
                             │
• Level 1 (Section):         ▼
  ┌──────────────────────────────────────────────────┐
  │  1. Quản lý Tiến trình (Process Management)      │  [Fill: #FFFFFF, Border: #9BB5D1]
  └─────────────┬──────────────────────┬─────────────┘
                │                      │
• Level 2:      ▼                      ▼
  ┌──────────────────────────┐   ┌──────────────────────────┐
  │  Khối ĐK tiến trình (PCB)│   │  Mô hình Đa luồng        │  [Soft Concept Pill, 4px r]
  └─────────────┬────────────┘   └──────────────────────────┘
                │
• Level 3:      ▼
  • PID, Con trỏ lệnh PC, Trạng thái thanh ghi                  [Muted secondary text]
  • Bảng bộ nhớ & Danh sách tệp mở

• Selection Ring: 2px solid `#126CF2` + 3px halo `#EAF3FF` (Forest green eliminated).
• Canvas: `#F4F8FC` with subtle 24px dot lattice pattern.
• Typography: Modern Sans-serif (`Aptos / Segoe UI / Inter`).

──────────────────────────────────────────────────────────────────────────────────────────
STUDYMAPVIEW (AFTER Phase B in /app/study/map/:id)
──────────────────────────────────────────────────────────────────────────────────────────
• Root:
  ┌──────────────────────────────────────────────────┐
  │  📘 Hệ điều hành Hiện đại                         │  [Accent Badge / Card Anchor]
  └──────────────────────────┬───────────────────────┘
                             │ 2.0px Bezier / Soft Step Connector
• Level 1 (Section):         ▼
  ○ 1. Quản lý Tiến trình (Process Management)           [r: 7px, Stroke: #126CF2, Text: 14px bold]
     │
     ├──── ○ Khối ĐK tiến trình (PCB)                    [r: 5px, Stroke: #587095, Text: 13px med]
     │        │
     │        ├─ • PID, Con trỏ lệnh PC...               [r: 3.5px, Text: 12px secondary]
     │        └─ • Bảng bộ nhớ & tệp mở
     │
     └──── ○ Mô hình Đa luồng                            [r: 5px, Stroke: #587095, Text: 13px med]
              │
              └─ • User thread vs Kernel thread

• Selection Ring: Selected node receives outer aura ring in `#EAF3FF` with `#126CF2` stroke.
• Canvas: `#F4F8FC` with matching 24px dot lattice pattern.
• Typography: Unified Sans-serif (`Aptos / Segoe UI / Inter`), multiline wrapping (no .slice(0, 46)).
• Connectors: Increased stroke-width (1.5px), smooth curve options, consistent token colors.
──────────────────────────────────────────────────────────────────────────────────────────
```

---

## 3. Concrete Technical Code & DOM Comparison

### Component Comparison Table

| Dimension | `MindElixirView.jsx` (BEFORE) | `MindElixirView.jsx` (AFTER) | `StudyMapView.jsx` (BEFORE) | `StudyMapView.jsx` (AFTER) |
| :--- | :--- | :--- | :--- | :--- |
| **Selection Token** | `var(--forest)` (`#1F4033`) | `var(--accent)` (`#126CF2`) | Circle stroke only | Outer aura ring + accent stroke |
| **Typography Family**| System sans-serif | `Aptos, Segoe UI, sans-serif` | `"Spectral, Georgia, serif"` | `Aptos, Segoe UI, sans-serif` |
| **Text Slicing** | Multiline wrap (`max-w: 260px`) | Multiline wrap (`max-w: 260px`) | `name.slice(0, 46)` | Multiline `<tspan>` + tooltip |
| **Root Geometry** | Solid accent rounded rect | Solid accent rounded rect | Pure 9px circle | Stylized badge / accent anchor |
| **Level 2 Subtopics**| Bare floating text | Soft bordered concept pill | 5px hollow circle | Standardized concept node |
| **Connector Stroke**| 2.0px dynamic palette | 2.0px safe branch palette | 1.2px static gray | 1.5px stroke with hierarchy |
| **Canvas Background**| Gray base or plain canvas | `var(--bg-base)` + dot grid | White card (`surface-card`) | `var(--bg-base)` + dot grid |
| **Lineage Focus** | Node highlight only | Lineage trace supported | Ancestor/descendant dim (0.22)| Ancestor/descendant dim (0.22)|

### Code Implementation Comparison

#### A. Selection Ring Fix in `mindElixirTheme.js`

```diff
  cssVar: {
-   "--selected": "var(--forest)",
-   "--accent-color": "var(--forest)",
+   "--selected": "var(--accent)",
+   "--accent-color": "var(--accent)",
  }
```

#### B. Typography & Text Halo in `StudyMapView.jsx`

```diff
  <text
    x={m.r + 7}
    y={-9}
    style={{
      fontSize: m.text,
      fontWeight: m.weight,
      fill: "var(--text-primary)",
-     fontFamily: "Spectral, Georgia, serif",
+     fontFamily: "Aptos, -apple-system, Segoe UI, sans-serif",
      paintOrder: "stroke",
      stroke: "var(--bg-card)",
      strokeWidth: 3.5,
      strokeLinejoin: "round",
    }}
  >
-   {String(nodeDatum.name).slice(0, 46)}
+   {/* Multiline tspan or calibrated clamp with full title tooltip */}
+   {renderWrappedSvgText(nodeDatum.name, m)}
  </text>
```

#### C. Canvas Lattice Unification in `index.css` & `StudyMapView.jsx`

```diff
- <div ref={canvasRef} className="surface-card !p-0 overflow-hidden w-full relative">
+ <div ref={canvasRef} className="shared-map-canvas border border-border rounded-xl overflow-hidden w-full relative">
```

```css
/* Unified canvas texture */
.shared-map-canvas {
  background-color: var(--bg-base);
  background-image: radial-gradient(circle, var(--border-color) 1px, transparent 1px);
  background-size: 24px 24px;
}
```

---

## 4. Verification of Visual Harmonization

When testing both views side by side:
1. **Visual Tone**: Both surfaces immediately declare membership in the MemVidX "Learning Canvas" product identity.
2. **Predictable Semantics**: In both maps, solid blue is always Root; white bordered boxes/circles are Sections; medium weight items are Concepts; lighter items are Leaf details.
3. **No Collision with Provenance**: Neither engine uses seal red (`#B23A2E`) for branch connections, keeping citations distinct.
4. **No Collision with Errors**: Neither engine uses bright red (`#F1333A`) for branch lines.
