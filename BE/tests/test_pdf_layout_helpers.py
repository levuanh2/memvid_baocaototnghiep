"""Pure unit tests for services.mindmap.export.pdf_layout's helpers,
imported directly (no fitz.Document round-trip). Ships together with
pdf_layout.py itself in the fix commit -- never in the red-test commit,
since importing a module that doesn't exist yet would fail collection
with an ImportError instead of a real assertion.
"""
from __future__ import annotations

from services.mindmap.export.pdf_layout import choose_map_orientation


def test_equal_fit_scale_ties_resolve_to_portrait():
    # A perfectly square image: portrait and landscape contain-fit scales
    # are numerically different in general (A4 isn't square), but a truly
    # square USABLE box (square page, or a size where both orientations
    # give the identical scale) must deterministically land on portrait.
    square_page = (600.0, 600.0)  # a square "page" makes portrait == landscape usable box
    choice = choose_map_orientation(100.0, 100.0, square_page, margin=40.0)
    assert choice.orientation == "portrait"
