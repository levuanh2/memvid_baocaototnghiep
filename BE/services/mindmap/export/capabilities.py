"""Loads format_capabilities.json — the single source of truth for which
appearance/content controls apply to each export format and their default
values. See that file's own _comment for why it's mirrored (not imported
cross-language) into FE/src/utils/exportFormatCapabilities.json, and
BE/tests/test_mindmap_export_contract.py for the test that keeps the two
byte-identical."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

_PATH = Path(__file__).parent / "format_capabilities.json"
_cache: dict[str, Any] | None = None


def _load() -> dict[str, Any]:
    global _cache
    if _cache is None:
        _cache = json.loads(_PATH.read_text(encoding="utf-8"))
    return _cache


def get_format_capabilities(fmt: str) -> dict[str, Any]:
    data = _load()
    if fmt not in data:
        raise ValueError(f"unknown export format: {fmt!r}")
    return copy.deepcopy(data[fmt])


def default_options(fmt: str) -> dict[str, Any]:
    return get_format_capabilities(fmt)["defaults"]


def allowed_content_keys(fmt: str) -> set[str]:
    return set(get_format_capabilities(fmt)["controls"].get("content") or [])


FONT_VALUES = {"canvas", "sans", "serif"}
COLOR_MODE_VALUES = {"keep", "monochrome", "customPalette"}
MARGIN_VALUES = {"narrow", "normal", "wide"}

# format_capabilities.json's `controls` object marks EXISTENCE with a short
# boolean flag key ("branchColor", "headingColor", "headerStyle"), but the
# actual VALUE a request sets travels under a differently-spelled key
# ("branchColorMode", "headingColorMode", "headerStyleMode" — matching the
# same "*Mode" vocabulary FE's mindmapExportAppearance.js already uses for
# branchColorMode). This maps a request's value-key back to its flag-key for
# the "does this format even declare this control" membership check.
_VALUE_KEY_TO_FLAG_KEY = {
    "branchColorMode": "branchColor", "headingColorMode": "headingColor", "headerStyleMode": "headerStyle",
}


class UnsupportedOptionError(ValueError):
    """A request named a control this format doesn't declare, or gave a
    control a value outside its allowed set — a real rejection (400), never
    a silent drop. See this module's `normalize_options` for the SEPARATE,
    later step that fills in defaults for controls the request left unset."""


def _is_hex_color(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 7 and value[0] == "#" and all(c in "0123456789abcdefABCDEF" for c in value[1:])


def _flag_key_for(controls: dict, value_key: str) -> str:
    return _VALUE_KEY_TO_FLAG_KEY.get(value_key, value_key)


def validate_options(fmt: str, requested: dict[str, Any] | None) -> None:
    """Raises UnsupportedOptionError for any control not declared by this
    format, or any declared control given a value outside what it accepts.
    Call BEFORE normalize_options — this only rejects, it never fills."""
    caps = get_format_capabilities(fmt)
    controls = caps["controls"]
    requested = requested or {}

    for key, value in requested.items():
        if key == "content":
            if not isinstance(value, dict):
                raise UnsupportedOptionError("content must be an object")
            allowed_content = set(controls.get("content") or [])
            for ck in value:
                if ck not in allowed_content:
                    raise UnsupportedOptionError(f"{fmt} does not support content.{ck}")
            continue

        flag_key = _flag_key_for(controls, key)
        if flag_key not in controls:
            raise UnsupportedOptionError(f"{fmt} does not support the {key!r} control")

        if key == "font" and value not in FONT_VALUES:
            raise UnsupportedOptionError(f"invalid font: {value!r}")
        elif key in _VALUE_KEY_TO_FLAG_KEY and value not in COLOR_MODE_VALUES:
            raise UnsupportedOptionError(f"invalid {key}: {value!r}")
        elif key == "margins" and value not in MARGIN_VALUES:
            raise UnsupportedOptionError(f"invalid margins: {value!r}")
        elif key == "background":
            bg_spec = controls["background"]
            named_ok = value in ("white", "dark") or (bg_spec.get("transparent") and value == "transparent") or (value == "canvas")
            custom_ok = bg_spec.get("custom") and _is_hex_color(value)
            if not (named_ok or custom_ok):
                raise UnsupportedOptionError(f"invalid background for {fmt}: {value!r}")
        elif key == "pageSize" and value not in controls["pageSize"]:
            raise UnsupportedOptionError(f"invalid pageSize: {value!r}")
        elif key == "orientation" and value not in controls["orientation"]:
            raise UnsupportedOptionError(f"invalid orientation: {value!r}")
        elif key == "mode" and value not in controls["mode"]:
            raise UnsupportedOptionError(f"invalid mode: {value!r}")
        elif key == "singlePage" and not isinstance(value, bool):
            raise UnsupportedOptionError("singlePage must be a boolean")
        elif key == "spacing" and value not in ("compact", "normal", "spacious"):
            raise UnsupportedOptionError(f"invalid spacing: {value!r}")
        elif key == "connectorThickness" and value not in ("thin", "normal", "thick"):
            raise UnsupportedOptionError(f"invalid connectorThickness: {value!r}")


def normalize_options(fmt: str, requested: dict[str, Any] | None) -> dict[str, Any]:
    """Merges `requested` over this format's defaults, DROPPING any key the
    format's own controls don't declare (so a client can never smuggle a
    setting through that the UI never should have shown, and a hidden
    control's stale FE state can never silently reach the serializer). Call
    validate_options first if the request should be REJECTED for an unknown/
    invalid key rather than silently normalized — this function's own
    dropping is a defense-in-depth backstop, not the primary rejection path."""
    caps = get_format_capabilities(fmt)
    controls = caps["controls"]
    out = copy.deepcopy(caps["defaults"])
    requested = requested or {}

    for key, value in requested.items():
        if key == "content":
            allowed = set(controls.get("content") or [])
            content_req = value if isinstance(value, dict) else {}
            for ck, cv in content_req.items():
                if ck in allowed:
                    out.setdefault("content", {})[ck] = bool(cv)
            continue
        flag_key = _flag_key_for(controls, key)
        if flag_key not in controls:
            continue  # not a real control for this format — silently dropped, never applied
        out[key] = value

    return out
