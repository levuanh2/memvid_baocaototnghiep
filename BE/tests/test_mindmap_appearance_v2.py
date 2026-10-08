"""PR C2 — contract/resolver/sanitizer for the persisted canvas appearance
(LIVE_SAFE subset only). Mirrors FE/src/utils/mindMapAppearanceV2.test.js's
cases exactly so the two implementations stay behaviorally aligned."""
from __future__ import annotations

import pytest

from services.mindmap.appearance import (
    AppearanceSanitizeError,
    CANVAS_PRESETS_V2,
    default_appearance_v2,
    resolve_canvas_appearance,
    role_is_noop,
    sanitize_appearance_payload,
)


class TestResolvePrecedence:
    def test_no_saved_appearance_resolves_to_default_preset(self):
        resolved = resolve_canvas_appearance(None)
        assert resolved["node"]["root"]["shape"] == CANVAS_PRESETS_V2["default"]["node"]["root"]["shape"]
        assert resolved["connector"]["colorMode"] == "keep"

    def test_choosing_a_preset_changes_every_field_to_that_presets_values(self):
        resolved = resolve_canvas_appearance({"version": 2, "preset": "pastel", "overrides": {}})
        assert resolved["node"]["root"]["fill"] == CANVAS_PRESETS_V2["pastel"]["node"]["root"]["fill"]
        assert resolved["connector"]["style"] == "dashed"

    def test_saved_override_wins_over_preset_leaving_siblings_untouched(self):
        resolved = resolve_canvas_appearance({
            "version": 2, "preset": "pastel",
            "overrides": {"node": {"root": {"fill": "#112233"}, "branch": {}, "leaf": {}}, "canvas": {}, "connector": {}},
        })
        assert resolved["node"]["root"]["fill"] == "#112233"
        assert resolved["node"]["root"]["shape"] == CANVAS_PRESETS_V2["pastel"]["node"]["root"]["shape"]
        assert resolved["node"]["branch"]["fill"] == CANVAS_PRESETS_V2["pastel"]["node"]["branch"]["fill"]

    def test_preset_does_not_overwrite_explicit_saved_override(self):
        without_override = resolve_canvas_appearance({"version": 2, "preset": "study", "overrides": {}})
        with_override = resolve_canvas_appearance({
            "version": 2, "preset": "study",
            "overrides": {"connector": {"colorMode": "fixed", "fixedColor": "#FF0000"}},
        })
        assert without_override["connector"]["colorMode"] != "fixed"
        assert with_override["connector"]["colorMode"] == "fixed"
        assert with_override["connector"]["fixedColor"] == "#FF0000"

    def test_explicit_light_dark_background_override_resolves_to_real_hex(self):
        light = resolve_canvas_appearance({"version": 2, "preset": "default", "overrides": {"canvas": {"background": "light"}}})
        dark = resolve_canvas_appearance({"version": 2, "preset": "default", "overrides": {"canvas": {"background": "dark"}}})
        assert light["canvas"]["background"] == "#FFFFFF"
        assert dark["canvas"]["background"] == "#15171C"


class TestDefaultPresetIsATrueNoop:
    """Regression: shipping Appearance V2 must not restyle every existing
    map the moment it deploys — a map with no saved appearance (every map
    that existed before C2) must resolve to a true no-op, not a new
    decorative default (caught before merge — a side-agent review flagged
    that an earlier draft of the "default" preset forced radius/shape on
    every role)."""

    def test_every_role_and_canvas_resolve_to_the_noop_sentinel(self):
        resolved = resolve_canvas_appearance(None)
        for role in ("root", "branch", "leaf"):
            assert role_is_noop(resolved["node"][role])
        assert not resolved["canvas"]["background"]
        assert resolved["canvas"]["grid"] == "none"
        assert resolved["connector"]["colorMode"] == "keep"
        assert resolved["connector"]["thickness"] == "normal"
        assert resolved["connector"]["style"] == "solid"

    def test_legacy_record_with_no_appearance_key_resolves_identically_to_none(self):
        assert resolve_canvas_appearance(None) == resolve_canvas_appearance(default_appearance_v2())


class TestPresetImmutability:
    def test_resolve_never_returns_the_same_object_as_the_preset_table(self):
        resolved = resolve_canvas_appearance(default_appearance_v2())
        assert resolved is not CANVAS_PRESETS_V2["default"]
        assert resolved["node"]["root"] is not CANVAS_PRESETS_V2["default"]["node"]["root"]
        resolved["node"]["root"]["fill"] = "#ABCDEF"
        resolved_again = resolve_canvas_appearance(default_appearance_v2())
        assert resolved_again["node"]["root"]["fill"] == CANVAS_PRESETS_V2["default"]["node"]["root"]["fill"]


class TestSanitize:
    def test_drops_unknown_fields_silently(self):
        out = sanitize_appearance_payload({
            "version": 2, "preset": "default",
            "overrides": {"node": {"root": {"fill": "#112233", "bogusField": "x"}, "branch": {}, "leaf": {}},
                          "canvas": {"bogus": 1}, "connector": {}, "bogusTop": True},
            "bogusRoot": "x",
        })
        assert out["overrides"]["node"]["root"]["fill"] == "#112233"
        assert "bogusField" not in out["overrides"]["node"]["root"]
        assert "bogusRoot" not in out
        assert "bogus" not in out["overrides"]["canvas"]

    def test_geometry_affecting_fields_never_survive(self):
        out = sanitize_appearance_payload({
            "version": 2, "preset": "default",
            "overrides": {
                "node": {"root": {"font": "serif", "fontSize": 20, "padding": 40, "borderWidth": 999}, "branch": {}, "leaf": {}},
                "canvas": {}, "connector": {},
                "typography": {"family": "serif", "scale": "large"},
                "layout": {"density": "spacious"},
            },
        })
        assert "font" not in out["overrides"]["node"]["root"]
        assert "fontSize" not in out["overrides"]["node"]["root"]
        assert "padding" not in out["overrides"]["node"]["root"]
        assert out["overrides"]["node"]["root"]["borderWidth"] == 3
        assert "typography" not in out
        assert "layout" not in out

    def test_rejects_non_hex_colors(self):
        out = sanitize_appearance_payload({
            "version": 2, "preset": "default",
            "overrides": {
                "node": {"root": {"fill": "url(javascript:alert(1))"}, "branch": {}, "leaf": {}},
                "canvas": {"background": "red"}, "connector": {"fixedColor": "<script>"},
            },
        })
        assert "fill" not in out["overrides"]["node"]["root"]
        assert "background" not in out["overrides"]["canvas"]
        assert "fixedColor" not in out["overrides"]["connector"]

    def test_rejects_enum_values_outside_allowed_set(self):
        out = sanitize_appearance_payload({
            "version": 2, "preset": "default",
            "overrides": {
                "node": {"root": {"shape": "triangle-of-doom"}, "branch": {}, "leaf": {}},
                "canvas": {"grid": "hexagon"}, "connector": {"style": "zigzag"},
            },
        })
        assert "shape" not in out["overrides"]["node"]["root"]
        assert "grid" not in out["overrides"]["canvas"]
        assert "style" not in out["overrides"]["connector"]

    def test_version_newer_than_supported_fails_safe_to_defaults(self):
        out = sanitize_appearance_payload({
            "version": 99, "preset": "study",
            "overrides": {"connector": {"colorMode": "fixed", "fixedColor": "#FF0000"}},
        })
        assert out == default_appearance_v2()

    def test_non_dict_payload_resolves_to_defaults(self):
        assert sanitize_appearance_payload(None) == default_appearance_v2()
        assert sanitize_appearance_payload([1, 2, 3]) == default_appearance_v2()
        assert sanitize_appearance_payload("not an object") == default_appearance_v2()

    def test_strict_mode_raises_on_non_dict_payload(self):
        with pytest.raises(AppearanceSanitizeError):
            sanitize_appearance_payload(None, strict=True)
        with pytest.raises(AppearanceSanitizeError):
            sanitize_appearance_payload("nope", strict=True)


class TestDefaultsForLegacyRecord:
    def test_none_behaves_identically_to_explicit_default_payload(self):
        from_none = resolve_canvas_appearance(None)
        from_default = resolve_canvas_appearance(default_appearance_v2())
        assert from_none == from_default
