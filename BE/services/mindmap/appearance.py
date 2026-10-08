"""Appearance V2 (PR C2) — server-side mirror of FE's mindMapAppearanceV2.js.
Same contract, same LIVE_SAFE-only scope, same resolve order: defaults
-> immutable preset V2 -> saved overrides. This module NEVER touches
mindmap nodes/relations/title — it only ever reads/writes the record's own
top-level `appearance` field (see app/main.py's `patch_mindmap_appearance`
route). See FE/src/utils/mindMapAppearanceV2.js's header for why typography/
padding/density/real-border-width/title-wrap are excluded: the C2 closure
pass measured them moving the live canvas's map root 14-420px regardless of
whether linkDiv() is called — Mind Elixir centers the root against the
combined rendered height of both side columns via plain CSS flex layout.
"""
from __future__ import annotations

import re
from typing import Any, Optional

APPEARANCE_VERSION = 2

SHAPES = ("roundedRect", "pill", "card", "underline")
GRIDS = ("none", "dot", "line")
CONNECTOR_COLOR_MODES = ("keep", "monochrome", "fixed")
CONNECTOR_STYLES = ("solid", "dashed")
CONNECTOR_THICKNESS = ("thin", "normal", "thick")
NODE_ROLES = ("root", "branch", "leaf")
PRESET_NAMES = ("default", "minimal", "study", "pastel", "highContrast")

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _is_hex_color(v: Any) -> bool:
    return isinstance(v, str) and bool(_HEX_RE.match(v))


def _clamp_int(v: Any, lo: int, hi: int) -> int:
    return max(lo, min(hi, round(v)))


class AppearanceSanitizeError(ValueError):
    pass


def _role_base(fill=None, text_color=None, border_color=None, radius=None, shadow=False, shape=None):
    """Every field defaults to a no-op sentinel (None/0/False), not a
    concrete value — `shape=None` means "apply nothing", not "apply a
    rounded rectangle". Mirrors FE's mindMapAppearanceV2.js `roleBase` one
    to one; see that file's header for why this matters most for the
    "default" preset (every map with no saved appearance resolves to it)."""
    return {
        "shape": shape, "fill": fill, "textColor": text_color, "borderColor": border_color,
        "borderWidth": 1 if border_color else 0, "radius": radius, "shadow": shadow,
    }


def role_is_noop(role: dict[str, Any]) -> bool:
    return not role.get("shape") and not role.get("fill") and not role.get("textColor") and not role.get("borderColor") and not role.get("shadow") and role.get("radius") is None


def _empty_overrides() -> dict[str, Any]:
    return {"canvas": {}, "node": {"root": {}, "branch": {}, "leaf": {}}, "connector": {}}


def default_appearance_v2() -> dict[str, Any]:
    return {"version": APPEARANCE_VERSION, "preset": "default", "overrides": _empty_overrides()}


# IMMUTABLE preset V2 definitions — never mutate a value read from here;
# `resolve_canvas_appearance` always deep-copies before merging overrides on
# top. A new visual variant is a NEW preset name, never an edit to an
# existing one.
CANVAS_PRESETS_V2: dict[str, dict[str, Any]] = {
    # True no-op: a map with no saved appearance (every map that existed
    # before C2, and every map nobody has opened the editor for) must look
    # EXACTLY as it did before this feature shipped — shape=None/radius=None
    # on every role, background=None on canvas, all skipped entirely by the
    # live-apply engine rather than written as a no-op-equivalent value.
    "default": {
        "canvas": {"background": None, "grid": "none"},
        "node": {"root": _role_base(), "branch": _role_base(), "leaf": _role_base()},
        "connector": {"colorMode": "keep", "fixedColor": None, "thickness": "normal", "style": "solid"},
    },
    "minimal": {
        "canvas": {"background": None, "grid": "none"},
        "node": {
            "root": _role_base(text_color="#2B2620", shape="underline", radius=0),
            "branch": _role_base(text_color="#2B2620", shape="underline", radius=0),
            "leaf": _role_base(text_color="#2B2620", shape="underline", radius=0),
        },
        "connector": {"colorMode": "monochrome", "fixedColor": "#2B2620", "thickness": "thin", "style": "solid"},
    },
    "study": {
        "canvas": {"background": None, "grid": "dot"},
        "node": {
            "root": _role_base(fill="#F4F1EA", text_color="#2B2620", shape="card", radius=10, shadow=True),
            "branch": _role_base(fill="#FFFFFF", text_color="#2B2620", border_color="#D8CFC0", shape="roundedRect", radius=8),
            "leaf": _role_base(text_color="#2B2620", shape="underline", radius=0),
        },
        "connector": {"colorMode": "keep", "fixedColor": None, "thickness": "normal", "style": "solid"},
    },
    "pastel": {
        "canvas": {"background": "#FBF7F2", "grid": "none"},
        "node": {
            "root": _role_base(fill="#E9D8F0", text_color="#4A3B56", shape="pill", radius=999),
            "branch": _role_base(fill="#D7E8F0", text_color="#30424B", shape="pill", radius=999),
            "leaf": _role_base(fill="#FDEBD3", text_color="#5A4420", shape="roundedRect", radius=10),
        },
        "connector": {"colorMode": "keep", "fixedColor": None, "thickness": "thin", "style": "dashed"},
    },
    "highContrast": {
        "canvas": {"background": "#15171C", "grid": "none"},
        "node": {
            "root": _role_base(fill="#FFFFFF", text_color="#000000", shape="roundedRect", radius=4),
            "branch": _role_base(fill="#FFE066", text_color="#000000", shape="roundedRect", radius=4),
            "leaf": _role_base(fill="#1A1D24", text_color="#FFFFFF", border_color="#FFFFFF", shape="roundedRect", radius=4),
        },
        "connector": {"colorMode": "fixed", "fixedColor": "#FFFFFF", "thickness": "thick", "style": "solid"},
    },
}


def _sanitize_node_role_override(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    if raw.get("shape") in SHAPES:
        out["shape"] = raw["shape"]
    if _is_hex_color(raw.get("fill")):
        out["fill"] = raw["fill"]
    if _is_hex_color(raw.get("textColor")):
        out["textColor"] = raw["textColor"]
    if _is_hex_color(raw.get("borderColor")):
        out["borderColor"] = raw["borderColor"]
    if isinstance(raw.get("borderWidth"), (int, float)) and not isinstance(raw.get("borderWidth"), bool):
        out["borderWidth"] = _clamp_int(raw["borderWidth"], 0, 3)
    if isinstance(raw.get("radius"), (int, float)) and not isinstance(raw.get("radius"), bool):
        out["radius"] = _clamp_int(raw["radius"], 0, 999)
    if isinstance(raw.get("shadow"), bool):
        out["shadow"] = raw["shadow"]
    return out


def _sanitize_canvas_override(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    bg = raw.get("background")
    if _is_hex_color(bg) or bg in ("light", "dark"):
        out["background"] = bg
    if raw.get("grid") in GRIDS:
        out["grid"] = raw["grid"]
    return out


def _sanitize_connector_override(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    if raw.get("colorMode") in CONNECTOR_COLOR_MODES:
        out["colorMode"] = raw["colorMode"]
    if _is_hex_color(raw.get("fixedColor")):
        out["fixedColor"] = raw["fixedColor"]
    if raw.get("thickness") in CONNECTOR_THICKNESS:
        out["thickness"] = raw["thickness"]
    if raw.get("style") in CONNECTOR_STYLES:
        out["style"] = raw["style"]
    return out


def validate_appearance_envelope(raw: Any) -> None:
    """Raises AppearanceSanitizeError for a malformed ENVELOPE — not a dict,
    an explicitly too-new version, or an unknown preset name. Used by the
    PATCH route to reject the request outright with a clear error. This is
    deliberately separate from `sanitize_appearance_payload`'s own
    philosophy for everything INSIDE `overrides`: an invalid/geometry-
    affecting nested field (padding, font, an out-of-range color) is meant
    to vanish quietly, not fail the whole request — only the envelope
    itself (is this even an appearance payload, is the version one we
    support, is the preset name real) is a hard reject."""
    if not isinstance(raw, dict):
        raise AppearanceSanitizeError("appearance payload must be an object")
    version = raw.get("version", APPEARANCE_VERSION)
    if not isinstance(version, int) or isinstance(version, bool):
        raise AppearanceSanitizeError("version must be an integer")
    if version > APPEARANCE_VERSION:
        raise AppearanceSanitizeError(f"unsupported appearance version: {version}")
    preset = raw.get("preset", "default")
    if preset not in PRESET_NAMES:
        raise AppearanceSanitizeError(f"unknown preset: {preset}")


def sanitize_appearance_payload(raw: Any, *, strict: bool = False) -> dict[str, Any]:
    """Drops every unrecognized or geometry-affecting field and validates
    every remaining value — never raises on a malformed payload (an invalid
    field is simply absent), UNLESS `strict=True` and the payload itself
    isn't even a dict (used by the PATCH route to reject a request body
    that isn't shaped like an appearance payload at all)."""
    if not isinstance(raw, dict):
        if strict:
            raise AppearanceSanitizeError("appearance payload must be an object")
        return default_appearance_v2()

    version = raw.get("version")
    version = version if isinstance(version, int) and not isinstance(version, bool) else APPEARANCE_VERSION
    if version > APPEARANCE_VERSION:
        return default_appearance_v2()

    preset = raw.get("preset") if raw.get("preset") in PRESET_NAMES else "default"
    raw_overrides = raw.get("overrides") if isinstance(raw.get("overrides"), dict) else {}
    raw_node = raw_overrides.get("node") if isinstance(raw_overrides.get("node"), dict) else {}

    return {
        "version": APPEARANCE_VERSION,
        "preset": preset,
        "overrides": {
            "canvas": _sanitize_canvas_override(raw_overrides.get("canvas")),
            "node": {
                "root": _sanitize_node_role_override(raw_node.get("root")),
                "branch": _sanitize_node_role_override(raw_node.get("branch")),
                "leaf": _sanitize_node_role_override(raw_node.get("leaf")),
            },
            "connector": _sanitize_connector_override(raw_overrides.get("connector")),
        },
    }


def _clone_preset(preset: dict[str, Any]) -> dict[str, Any]:
    return {
        "canvas": dict(preset["canvas"]),
        "node": {role: dict(preset["node"][role]) for role in NODE_ROLES},
        "connector": dict(preset["connector"]),
    }


def resolve_canvas_appearance(saved_appearance: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """defaults -> immutable preset V2 -> saved LIVE_SAFE overrides.
    `saved_appearance` may be None (a record predating Appearance V2) or a
    malformed/future-versioned payload — both resolve to the "default"
    preset with no overrides. Pure — never writes anything back.
    `background: None` (the "default" preset's own value) means "don't
    touch it, leave native/theme CSS in control" — not "pick a color for
    the current theme"; only an explicit "light"/"dark" preset choice
    resolves to a concrete hex."""
    sanitized = sanitize_appearance_payload(saved_appearance)
    preset_name = sanitized["preset"] if sanitized["preset"] in CANVAS_PRESETS_V2 else "default"
    resolved = _clone_preset(CANVAS_PRESETS_V2[preset_name])

    ov = sanitized["overrides"]
    resolved["canvas"].update(ov["canvas"])
    for role in NODE_ROLES:
        resolved["node"][role].update(ov["node"][role])
    resolved["connector"].update(ov["connector"])

    bg = resolved["canvas"].get("background")
    if bg == "light":
        resolved["canvas"]["background"] = "#FFFFFF"
    elif bg == "dark":
        resolved["canvas"]["background"] = "#15171C"
    return resolved
