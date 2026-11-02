# ADR-0027 — The v2 logo

**Status:** Accepted
**Date:** 2026-11-01
**Builds on:** ADR-0025 (the v2 UI design direction)
**Evidence:** the prototypes on branch
[`prototype/v2-logo`](https://github.com/XDGFX/ultrasonics/tree/prototype/v2-logo/packages/web):
`prototype-v2-logo.html` (variants A–H) and `prototype-v2-logo-signal.html` (the signal mosaic)
**Ticket:** [The v2 logo](https://github.com/XDGFX/ultrasonics/issues/107)

## Context

ADR-0025 kept v1's chromatic wordmark until the logo was redesigned. The v1 SVGs carry a solid
`#111` halo behind every shape, so they break on any other background. Their ソニックス is about a
fifth of the wordmark's height and unreadable below about 240px wide, and the round icon is a smudge
at 16px. The prototype compared keeping v1, a clean re-cut, a monospace wordmark, v1's ring, a
katakana-led lockup, and pixel and ASCII-mosaic treatments.

## Decision

### 1. The lockup

The wordmark is lowercase "ultrasonics" in Montserrat Alternates 700 (v1's letterforms), white with
v1's chromatic split: teal offset down-left, magenta up-right. Beneath it, ソニックス runs the
wordmark's full width, one character per step, in magenta, quieter than the name. It is drawn
clean, with no halo, and has a light version (a `#111` face).

### 2. At full size, the logo is a signal

On the first-run screen, the logo is an ASCII mosaic on a full-screen character grid:

- **Mosaic.** A density ramp (` .:-=+*#%@`) fills a dense white face. Teal and magenta copies sit
  about a cell away, lower on the ramp. The katakana is about a quarter of the wordmark's font size,
  on its own finer grid.
- **Tune-in.** It loads by tuning in. The screen starts black. Each point has its own tuning,
  offset by a slow drifting noise field, so patches lock at different times. Static gathers round
  the logo and falls away with distance, and values climb the ramp from black. The tune-in takes
  about 6s and eases out.
- **Cursor.** The cursor is interference on the line, never a brush. It drops cells down the ramp,
  widens the misregistration, tears scanlines and swaps glyphs for junk, with faint static nearby.
  Cells resync in a staggered order.
- **Idle.** A faint analogue flicker runs underneath, and an occasional line glitch passes through.

The mosaic changes density only. It never uses transparency or moves glyphs. It is not used below
full size, where it stops reading.

### 3. Everywhere else, the logo is static

The nav rail, favicon and home-screen icon use the chroma-pixel ソ (prototype variant G). Other
places that are not the first-run hero use the static lockup in §1. Under `prefers-reduced-motion`,
the first-run screen shows the mosaic fully tuned and still.

### 4. The README gets a baked SVG

GitHub renders a README SVG as an image, with no script and no pointer, but with CSS animation and
media queries. The README logo is therefore generated from the same renderer as a precomputed SVG:

- the tune-in played once, then holding;
- a short loop of flicker and line tear;
- dark and light versions, chosen by `prefers-color-scheme`;
- a still frame under `prefers-reduced-motion`.

There is no cursor interaction. The mosaic is baked and shown at full size, never smaller: the
wordmark is about 880px across on a 10px grid, as on a full-size first-run screen. The README embeds
it at its natural width and lets only a narrow viewport shrink it.

## Considered options

- **Keep the v1 SVGs.** Rejected: the halo breaks on any other background, and the katakana and icon
  fail at small sizes.
- **A clean re-cut only** (variant B). Cheapest, but it fixes the breakage without adding anything.
- **A monospace wordmark** (variant C). It matches the UI's type but loses v1's letterforms.
- **v1's ring as the mark** (variant D). It reads at 16px, but it was not chosen over the
  katakana-led lockup.
- **A scattered, chromatic-blur load-in.** Prototyped and rejected as messy and abrupt. Tuning
  through space from black replaced it.

## Consequences

- The Vue UI spec builds the first-run mosaic and the static marks, and retires the v1 SVGs.
- The mosaic renderer must be deterministic enough to bake the README SVG offline. The README SVG is
  generated, not hand-drawn.
- Montserrat Alternates, Noto Sans JP and Roboto Mono are web fonts the UI loads.
