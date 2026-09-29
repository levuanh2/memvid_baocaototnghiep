"""Section 3 contract tests: the same option has the same meaning across
Export Studio state, preview, API request, backend validation, serializer
output. See services/mindmap/export/capabilities.py + format_capabilities.json.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.mindmap.export.capabilities import (
    get_format_capabilities, normalize_options, default_options, allowed_content_keys,
    validate_options, UnsupportedOptionError,
)

BE_JSON = Path(__file__).parent.parent / "services" / "mindmap" / "export" / "format_capabilities.json"
FE_JSON = Path(__file__).parent.parent.parent / "FE" / "src" / "utils" / "exportFormatCapabilities.json"


def test_fe_and_be_capability_files_are_byte_identical():
    assert FE_JSON.is_file(), f"missing FE mirror: {FE_JSON}"
    assert BE_JSON.read_bytes() == FE_JSON.read_bytes(), (
        "FE/src/utils/exportFormatCapabilities.json has drifted from "
        "BE/services/mindmap/export/format_capabilities.json — these must be "
        "kept byte-identical (see either file's own _comment)."
    )


def test_every_format_declares_controls_and_defaults():
    for fmt in ("image", "pdf", "docx", "xlsx"):
        caps = get_format_capabilities(fmt)
        assert "controls" in caps and "defaults" in caps


def test_unknown_format_raises():
    with pytest.raises(ValueError):
        get_format_capabilities("csv")


# ---- image: has background.transparent, docx/xlsx must not -----------------

def test_image_supports_transparent_background_docx_and_xlsx_do_not():
    assert get_format_capabilities("image")["controls"]["background"]["transparent"] is True
    assert get_format_capabilities("pdf")["controls"]["background"]["transparent"] is False
    assert "background" not in get_format_capabilities("docx")["controls"]
    assert "background" not in get_format_capabilities("xlsx")["controls"]


def test_xlsx_has_no_connector_orientation_or_spacing_controls():
    xlsx_controls = get_format_capabilities("xlsx")["controls"]
    for forbidden in ("connectorThickness", "orientation", "pageSize", "spacing", "mapImage", "singlePage", "mode"):
        assert forbidden not in xlsx_controls


def test_pdf_content_includes_every_required_toggle():
    assert allowed_content_keys("pdf") == {"notes", "citations", "sourceNames", "relations", "legend", "branding"}


def test_docx_content_has_no_legend_toggle():
    assert "legend" not in allowed_content_keys("docx")


# ---- normalize_options: drop-unknown, merge-over-defaults -------------------

def test_normalize_options_merges_over_defaults():
    out = normalize_options("pdf", {"pageSize": "A3"})
    assert out["pageSize"] == "A3"
    assert out["orientation"] == "portrait"  # untouched default


def test_normalize_options_drops_keys_not_in_this_formats_controls():
    # "spacing" is an image-only control — requesting it for pdf must be a no-op.
    out = normalize_options("pdf", {"spacing": "compact"})
    assert "spacing" not in out


def test_normalize_options_content_drops_unknown_content_keys():
    out = normalize_options("xlsx", {"content": {"legend": True, "citations": False}})
    assert "legend" not in out["content"]  # xlsx has no legend control
    assert out["content"]["citations"] is False


def test_normalize_options_is_idempotent_for_retry_parity():
    """Section 3: retrying a job must use the SAME normalized options."""
    once = normalize_options("docx", {"headingColor": "monochrome", "content": {"notes": False}})
    twice = normalize_options("docx", once)
    assert once == twice


# ---- validate_options: real rejection, not silent drop ---------------------

def test_validate_options_rejects_control_not_declared_by_format():
    with pytest.raises(UnsupportedOptionError):
        validate_options("pdf", {"spacing": "compact"})  # image-only control
    with pytest.raises(UnsupportedOptionError):
        validate_options("xlsx", {"orientation": "landscape"})  # xlsx has no orientation control
    with pytest.raises(UnsupportedOptionError):
        validate_options("docx", {"background": "white"})  # docx has no background control


def test_validate_options_rejects_content_key_not_declared_by_format():
    with pytest.raises(UnsupportedOptionError):
        validate_options("xlsx", {"content": {"legend": True}})
    with pytest.raises(UnsupportedOptionError):
        validate_options("docx", {"content": {"legend": True}})


def test_validate_options_rejects_out_of_range_enum_values():
    with pytest.raises(UnsupportedOptionError):
        validate_options("pdf", {"pageSize": "A5"})
    with pytest.raises(UnsupportedOptionError):
        validate_options("pdf", {"orientation": "diagonal"})
    with pytest.raises(UnsupportedOptionError):
        validate_options("pdf", {"mode": "3d"})
    with pytest.raises(UnsupportedOptionError):
        validate_options("docx", {"headingColorMode": "rainbow"})
    with pytest.raises(UnsupportedOptionError):
        validate_options("image", {"font": "comic-sans"})


def test_validate_options_accepts_every_declared_control_at_a_valid_value():
    validate_options("pdf", {
        "font": "serif", "background": "#FF00AA", "branchColorMode": "monochrome",
        "margins": "wide", "pageSize": "A3", "orientation": "landscape",
        "singlePage": True, "mode": "map_and_outline",
        "content": {"notes": True, "citations": False, "sourceNames": True, "relations": True, "legend": True, "branding": True},
    })  # must not raise


def test_validate_options_rejects_custom_background_when_format_disallows_transparent_but_allows_custom():
    validate_options("pdf", {"background": "#123456"})  # must not raise — pdf allows custom
    with pytest.raises(UnsupportedOptionError):
        validate_options("pdf", {"background": "transparent"})  # pdf disallows transparent specifically


def test_every_mode_suffixed_default_key_has_a_flag_in_controls():
    """Guards against the exact bug this module's own dev history hit once:
    a defaults key like "headingColorMode" silently not matching its flag
    key "headingColor" in controls, making validate_options/normalize_options
    reject or ignore every request for that control."""
    from services.mindmap.export.capabilities import _VALUE_KEY_TO_FLAG_KEY
    for fmt in ("image", "pdf", "docx", "xlsx"):
        caps = get_format_capabilities(fmt)
        for key in caps["defaults"]:
            if key.endswith("Mode"):
                flag_key = _VALUE_KEY_TO_FLAG_KEY.get(key)
                assert flag_key is not None, f"{fmt}.{key}: no flag-key mapping registered"
                assert flag_key in caps["controls"], f"{fmt}.{key}: flag key {flag_key!r} missing from controls"


def test_defaults_are_stable_and_match_declared_content_keys():
    for fmt in ("image", "pdf", "docx", "xlsx"):
        defaults = default_options(fmt)
        allowed = allowed_content_keys(fmt)
        assert set(defaults.get("content", {}).keys()) == allowed, (
            f"{fmt}: default content keys must exactly match this format's allowed content controls"
        )
