// PR C2 — contract/resolver/sanitizer for the persisted canvas appearance
// (LIVE_SAFE subset only). See mindMapAppearanceV2.js's header for why
// typography/padding/density are excluded (REFLOW_REQUIRED per the closure
// pass — .playbook/known-issues.md has the measurement record).
import { describe, it, expect } from "vitest";
import {
  APPEARANCE_VERSION, CANVAS_PRESETS_V2, defaultAppearanceV2,
  resolveCanvasAppearance, sanitizeAppearancePayload, roleForDepth, roleIsNoop,
} from "./mindMapAppearanceV2";

describe("roleForDepth", () => {
  it("maps depth to root/branch/leaf exactly like mindElixirAdapter's kind mapping", () => {
    expect(roleForDepth(0)).toBe("root");
    expect(roleForDepth(1)).toBe("branch");
    expect(roleForDepth(2)).toBe("leaf");
    expect(roleForDepth(7)).toBe("leaf");
  });
});

describe("resolveCanvasAppearance — precedence: defaults(theme) -> preset -> saved overrides", () => {
  it("a record with no saved appearance resolves to the default preset, never an error", () => {
    const resolved = resolveCanvasAppearance({ savedAppearance: undefined });
    expect(resolved.node.root.shape).toBe(CANVAS_PRESETS_V2.default.node.root.shape);
    expect(resolved.connector.colorMode).toBe("keep");
  });

  it("choosing a preset changes every role/connector field to that preset's own values", () => {
    const resolved = resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "pastel", overrides: {} } });
    expect(resolved.node.root.fill).toBe(CANVAS_PRESETS_V2.pastel.node.root.fill);
    expect(resolved.connector.style).toBe("dashed");
  });

  it("a saved override wins over the preset's own value for that one field, leaving siblings untouched", () => {
    const resolved = resolveCanvasAppearance({
      savedAppearance: { version: 2, preset: "pastel", overrides: { node: { root: { fill: "#112233" }, branch: {}, leaf: {} }, canvas: {}, connector: {} } },
    });
    expect(resolved.node.root.fill).toBe("#112233");
    expect(resolved.node.root.shape).toBe(CANVAS_PRESETS_V2.pastel.node.root.shape); // untouched sibling field
    expect(resolved.node.branch.fill).toBe(CANVAS_PRESETS_V2.pastel.node.branch.fill); // untouched sibling role
  });

  it("preset does NOT silently overwrite an explicit saved override (precedence is preset THEN override, not the reverse)", () => {
    const withoutOverride = resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "study", overrides: {} } });
    const withOverride = resolveCanvasAppearance({
      savedAppearance: { version: 2, preset: "study", overrides: { connector: { colorMode: "fixed", fixedColor: "#FF0000" } } },
    });
    expect(withoutOverride.connector.colorMode).not.toBe("fixed");
    expect(withOverride.connector.colorMode).toBe("fixed");
    expect(withOverride.connector.fixedColor).toBe("#FF0000");
  });

  it("an explicit 'light'/'dark' background override resolves to a real hex, never the bare keyword", () => {
    const light = resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "default", overrides: { canvas: { background: "light" } } } });
    const dark = resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "default", overrides: { canvas: { background: "dark" } } } });
    expect(light.canvas.background).toBe("#FFFFFF");
    expect(dark.canvas.background).toBe("#15171C");
  });
});

describe("default preset is a true visual no-op (regression: shipping this feature must not restyle every existing map)", () => {
  it("every role and the canvas itself resolve to the no-op sentinel — null/0/false, never a concrete decorative value", () => {
    const resolved = resolveCanvasAppearance({ savedAppearance: undefined });
    for (const role of ["root", "branch", "leaf"]) {
      expect(roleIsNoop(resolved.node[role])).toBe(true);
    }
    expect(resolved.canvas.background).toBeFalsy();
    expect(resolved.canvas.grid).toBe("none");
    expect(resolved.connector.colorMode).toBe("keep");
    expect(resolved.connector.thickness).toBe("normal");
    expect(resolved.connector.style).toBe("solid");
  });

  it("a record saved before Appearance V2 existed (no `appearance` key at all) resolves to the exact same no-op shape", () => {
    expect(resolveCanvasAppearance({ savedAppearance: undefined })).toEqual(resolveCanvasAppearance({ savedAppearance: null }));
  });
});

describe("preset immutability", () => {
  it("CANVAS_PRESETS_V2 entries are frozen — a mutation attempt throws or no-ops, never silently changes the shared object", () => {
    expect(Object.isFrozen(CANVAS_PRESETS_V2.default)).toBe(true);
    expect(Object.isFrozen(CANVAS_PRESETS_V2.study)).toBe(true);
  });

  it("resolveCanvasAppearance never returns the SAME object reference as the preset table (always a clone, safe to mutate by the caller)", () => {
    const resolved = resolveCanvasAppearance({ savedAppearance: defaultAppearanceV2() });
    expect(resolved).not.toBe(CANVAS_PRESETS_V2.default);
    expect(resolved.node.root).not.toBe(CANVAS_PRESETS_V2.default.node.root);
    resolved.node.root.fill = "#ABCDEF"; // mutate the returned clone
    const resolvedAgain = resolveCanvasAppearance({ savedAppearance: defaultAppearanceV2() });
    expect(resolvedAgain.node.root.fill).toBe(CANVAS_PRESETS_V2.default.node.root.fill); // preset itself untouched
  });
});

describe("sanitizeAppearancePayload — malformed/geometry-affecting fields never reach the result", () => {
  it("drops unknown top-level and nested fields silently, never throws", () => {
    const out = sanitizeAppearancePayload({
      version: 2, preset: "default",
      overrides: { node: { root: { fill: "#112233", bogusField: "x" }, branch: {}, leaf: {} }, canvas: { bogus: 1 }, connector: {}, bogusTop: true },
      bogusRoot: "x",
    });
    expect(out.overrides.node.root.fill).toBe("#112233");
    expect(out.overrides.node.root.bogusField).toBeUndefined();
    expect(out.bogusRoot).toBeUndefined();
    expect(out.overrides.canvas.bogus).toBeUndefined();
  });

  it("geometry-affecting fields (typography/padding/density/real border-width/title-wrap) never survive sanitization even if present", () => {
    const out = sanitizeAppearancePayload({
      version: 2, preset: "default",
      overrides: {
        node: { root: { font: "serif", fontSize: 20, padding: 40, borderWidth: 999 }, branch: {}, leaf: {} },
        canvas: {}, connector: {},
        typography: { family: "serif", scale: "large" },
        layout: { density: "spacious" },
      },
    });
    expect(out.overrides.node.root.font).toBeUndefined();
    expect(out.overrides.node.root.fontSize).toBeUndefined();
    expect(out.overrides.node.root.padding).toBeUndefined();
    expect(out.overrides.node.root.borderWidth).toBe(3); // clamped, not geometry-real — this is the INSET emphasis width, max 3
    expect(out.typography).toBeUndefined();
    expect(out.layout).toBeUndefined();
  });

  it("rejects non-hex color strings (no arbitrary CSS, no url(), no javascript:)", () => {
    const out = sanitizeAppearancePayload({
      version: 2, preset: "default",
      overrides: { node: { root: { fill: "url(javascript:alert(1))" }, branch: {}, leaf: {} }, canvas: { background: "red" }, connector: { fixedColor: "<script>" } },
    });
    expect(out.overrides.node.root.fill).toBeUndefined();
    expect(out.overrides.canvas.background).toBeUndefined();
    expect(out.overrides.connector.fixedColor).toBeUndefined();
  });

  it("rejects an enum value outside the allowed set instead of passing it through", () => {
    const out = sanitizeAppearancePayload({
      version: 2, preset: "default",
      overrides: { node: { root: { shape: "triangle-of-doom" }, branch: {}, leaf: {} }, canvas: { grid: "hexagon" }, connector: { style: "zigzag" } },
    });
    expect(out.overrides.node.root.shape).toBeUndefined();
    expect(out.overrides.canvas.grid).toBeUndefined();
    expect(out.overrides.connector.style).toBeUndefined();
  });

  it("version newer than supported fails safe to pure defaults, not an error, not a partial resolve", () => {
    const out = sanitizeAppearancePayload({ version: 99, preset: "study", overrides: { connector: { colorMode: "fixed", fixedColor: "#FF0000" } } });
    expect(out).toEqual(defaultAppearanceV2());
  });

  it("a non-object payload (null, array, string) resolves to defaults rather than throwing", () => {
    expect(sanitizeAppearancePayload(null)).toEqual(defaultAppearanceV2());
    expect(sanitizeAppearancePayload([1, 2, 3])).toEqual(defaultAppearanceV2());
    expect(sanitizeAppearancePayload("not an object")).toEqual(defaultAppearanceV2());
  });

  it("strict mode throws on a non-object payload (used by the PATCH route to reject the request outright)", () => {
    expect(() => sanitizeAppearancePayload(null, { strict: true })).toThrow();
    expect(() => sanitizeAppearancePayload("nope", { strict: true })).toThrow();
  });
});

describe("defaults for a pre-Appearance-V2 record", () => {
  it("resolveCanvasAppearance with no savedAppearance at all behaves identically to an explicit default payload", () => {
    const fromUndefined = resolveCanvasAppearance({ savedAppearance: undefined, theme: "light" });
    const fromDefault = resolveCanvasAppearance({ savedAppearance: defaultAppearanceV2(), theme: "light" });
    expect(fromUndefined).toEqual(fromDefault);
  });
});
