"""Pure PDF layout helpers for PR H — contain-fit orientation/rect math and
real-font-metric text wrapping, each independently unit-testable without
opening a fitz.Document. Extracted from pdf_serializer.py because that
module's own job (deciding WHAT to draw from a tree + options) must not be
tangled with HOW MUCH SPACE a given piece of text actually needs on a real
page — that confusion (a fixed LINE_HEIGHT charged per logical item instead
of per rendered line) was this PR's root cause for the "chồng chữ" bug.

Root causes this module exists to fix (confirmed with real exported PDFs,
read with PyMuPDF, before any of this was written — see
.playbook/known-issues.md):
  1. The map page's orientation was a raw pass-through of the client's
     `orientation` option, never compared against the real image's own
     aspect ratio — a wide map forced into a portrait page used ~17% of
     the usable area; the same image in landscape used over 2x that.
  2. Outline text used `page.insert_text()`, which has no wrap parameter
     at all — a long topic with no embedded newline silently ran off the
     page's right edge, past even the page boundary itself.
  3. The outline cursor advanced by one fixed LINE_HEIGHT per logical
     line, but `insert_text()` draws every `\n` in a string as its own
     internal line — a multi-paragraph note rendered 2+ real lines while
     the caller only reserved vertical space for 1, so the next item
     overlapped the note's own tail.

Also confirmed (real, isolated repro, nothing to do with this codebase):
PyMuPDF 1.27.2.3's `Page.insert_image(rect, keep_proportion=True)`
distorts a perfectly square (1:1) source image to fill `rect` exactly,
while every OTHER aspect ratio tested (4:1, 2:1, 1.5:1, 0.8:1, 0.667:1,
0.5:1) was fit correctly. `centered_fit_rect` below computes the exact
destination rect itself and hands PyMuPDF an already-correct rect, so
that library quirk can never surface regardless of image shape.
"""
from __future__ import annotations

from dataclasses import dataclass

import fitz

# How much of a wrapped line's available width the per-depth indent may
# consume at most -- a sufficiently deep outline branch must still keep
# real room for its own text, not be indented off the page.
MAX_INDENT_FRACTION_OF_WIDTH = 0.6


def contain_fit_scale(content_w: float, content_h: float, box_w: float, box_h: float) -> float:
    """The largest scale factor that fits content_w x content_h inside
    box_w x box_h without cropping either dimension. 0 for a degenerate
    (non-positive) content size or box."""
    if content_w <= 0 or content_h <= 0 or box_w <= 0 or box_h <= 0:
        return 0.0
    return min(box_w / content_w, box_h / content_h)


@dataclass(frozen=True)
class OrientationChoice:
    orientation: str  # "portrait" | "landscape"
    scale: float
    page_w: float
    page_h: float


def choose_map_orientation(image_w: float, image_h: float, portrait_page_pt: tuple[float, float], margin: float) -> OrientationChoice:
    """Compares the real image's contain-fit scale on an A4/A3 portrait
    page vs. the same page rotated to landscape, and returns whichever is
    larger -- PR H's approved contract for mode="map"/"map_and_outline"'s
    map page. A tie (including the degenerate 0-scale case) picks
    portrait, so the choice is always deterministic. `portrait_page_pt` is
    the page size's own (width, height) in PORTRAIT orientation, e.g.
    PAGE_SIZES_PT["A4"] -- never pre-rotated by the caller."""
    pw, ph = portrait_page_pt
    portrait_scale = contain_fit_scale(image_w, image_h, pw - 2 * margin, ph - 2 * margin)
    landscape_scale = contain_fit_scale(image_w, image_h, ph - 2 * margin, pw - 2 * margin)
    if landscape_scale > portrait_scale:
        return OrientationChoice("landscape", landscape_scale, ph, pw)
    return OrientationChoice("portrait", portrait_scale, pw, ph)


def centered_fit_rect(image_w: float, image_h: float, page_w: float, page_h: float, margin: float) -> "fitz.Rect":
    """The exact destination rect for a contain-fit, centered placement of
    image_w x image_h within page_w x page_h's margin-bounded area. Pass
    this rect straight to `insert_image` -- never rely on its own
    `keep_proportion` (see module docstring)."""
    box_w, box_h = page_w - 2 * margin, page_h - 2 * margin
    scale = contain_fit_scale(image_w, image_h, box_w, box_h)
    w, h = image_w * scale, image_h * scale
    x0 = (page_w - w) / 2
    y0 = (page_h - h) / 2
    return fitz.Rect(x0, y0, x0 + w, y0 + h)


# ---------------------------------------------------------------------------
# Text wrapping -- real font metrics, never a guessed character-count width.
# ---------------------------------------------------------------------------

def _hard_break_token(token: str, font: "fitz.Font", fontsize: float, max_width: float) -> list[str]:
    """Breaks a single whitespace-free token that's wider than max_width
    into pieces that each fit -- the "long unbroken token" case. Always
    makes progress (at least one character per piece), so it can never
    infinite-loop even for a max_width smaller than one character."""
    pieces: list[str] = []
    buf = ""
    for ch in token:
        candidate = buf + ch
        if not buf or font.text_length(candidate, fontsize=fontsize) <= max_width:
            buf = candidate
        else:
            pieces.append(buf)
            buf = ch
    if buf:
        pieces.append(buf)
    return pieces


def wrap_paragraph(text: str, *, font: "fitz.Font", fontsize: float, max_width: float) -> list[str]:
    """Word-wraps ONE paragraph (no embedded newline) to max_width using
    the font's own real glyph metrics. An empty string wraps to exactly
    one empty line (a blank paragraph must still occupy its own line, not
    vanish and silently shift everything else up)."""
    if not text:
        return [""]
    words = text.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        if not word:
            continue
        candidate = f"{current} {word}" if current else word
        if font.text_length(candidate, fontsize=fontsize) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ""
        if font.text_length(word, fontsize=fontsize) <= max_width:
            current = word
        else:
            broken = _hard_break_token(word, font, fontsize, max_width)
            lines.extend(broken[:-1])
            current = broken[-1] if broken else ""
    if current or not lines:
        lines.append(current)
    return lines


def wrap_multiline(text: str, *, font: "fitz.Font", fontsize: float, max_width: float) -> list[str]:
    """Wraps `text`, preserving real paragraph breaks (`\\n`) -- each
    paragraph is wrapped independently against the same max_width. This is
    the fix for the multi-paragraph-note overlap bug: the caller now gets
    back the TRUE number of rendered lines up front, instead of assuming
    one."""
    out: list[str] = []
    for paragraph in text.split("\n"):
        out.extend(wrap_paragraph(paragraph, font=font, fontsize=fontsize, max_width=max_width))
    return out


def indent_for_depth(depth: float, available_width: float, indent_per_depth: float) -> float:
    """The actual indent to use for a given outline depth -- capped so a
    deep branch never eats so much width that its own text has nowhere
    left to wrap into."""
    raw = depth * indent_per_depth
    cap = available_width * MAX_INDENT_FRACTION_OF_WIDTH
    return min(raw, max(cap, 0.0))


@dataclass
class OutlineBlock:
    """One drawable unit on an outline page: already-wrapped physical
    lines sharing one x/fontsize/color. A single logical outline entry
    (a topic, a note, a citations line, ...) becomes exactly one block --
    multiple wrapped lines inside it all share the block's own height, so
    the page-break and cursor-advance logic downstream never has to care
    how many physical lines a logical entry turned into."""
    lines: list[str]
    x: float
    fontsize: float
    color: tuple[float, float, float]
    line_height: float

    @property
    def height(self) -> float:
        return len(self.lines) * self.line_height


def block_height(block: OutlineBlock) -> float:
    return block.height


def fits_on_page(cursor_y: float, block: OutlineBlock, page_h: float, margin: float) -> bool:
    """Whether `block` can be drawn starting at cursor_y without any of
    its lines crossing the bottom margin."""
    return cursor_y + block.height <= page_h - margin
