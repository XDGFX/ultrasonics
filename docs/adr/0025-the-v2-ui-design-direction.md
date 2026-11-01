# ADR-0025 — The v2 UI design direction

**Status:** Proposed
**Date:** 2026-11-01
**Builds on:** ADR-0001 (Vue 3 + Vite), ADR-0011 (triggers are server configuration), ADR-0019
(settings forms from JSON Schema), ADR-0020 (outputs return a result), ADR-0021 (rejections)
**Settles:** the choice control left open by ADR-0019 §4, and the wizard renderer left open by
ADR-0013's consequences
**Evidence:** the prototype on branch
[`prototype/v2-ui`](https://github.com/XDGFX/ultrasonics/blob/prototype/v2-ui/packages/web/prototype-v2-ui.html),
variant D
**Ticket:** [The v2 UI: design direction and Phase 1 screens](https://github.com/XDGFX/ultrasonics/issues/105)

## Context

Phase 1 needs Vue screens to build and run one applet, in a v2 design rather than v1's. v1 gave no
feedback after a run, showed errors only in server logs, and could not edit a plugin once it was in
an applet. It did have an identity people liked. The prototype compared a sentence builder in the
IFTTT style, a dark pipeline layout, and a plain list–detail layout.

## Decision

### 1. A dark, dense pipeline layout that keeps v1's identity

The layout is a narrow nav rail, a breadcrumb bar, and a main area with a side panel for settings.
From v1 it keeps Roboto Mono throughout, teal `#1ce5b5` with magenta `#e234ce`, the static
texture on near-black, a lowercase voice, `key:` labels in magenta, ▶ ✎ × glyph actions, and the
chromatic wordmark. The chromatic effect is for the wordmark only, because headings set in it are
hard to read. Content is centred on the page.

### 2. The builder is fixed columns, not a node graph

An applet cannot branch: inputs merge, modifiers apply in order, and every output receives the same
songs. The builder therefore shows four fixed columns (**when**, **inputs**, **modifiers**,
**outputs**). Plugins are added to or removed from a column, with nothing to wire. Selecting one
opens its settings form in the side panel.

### 3. The applet reads as a sentence

Each applet is summarised as a sentence ("when every day at 07:00, take discover weekly from
spotify, deduplicate it, and put it in plex"). The sentence heads the builder and is each row's
summary in the applet list. It is generated from the applet, never typed. Each row also shows live
status while a run is in progress.

### 4. The run view shows the output result

A run shows its stages with song counts between them, the output result for each playlist
(written, skipped or failed, with its unmatched songs), its rejections, and the log.

### 5. A discriminator renders as radio cards

ADR-0019 §4 left the choice control open. It is **radio cards**: each card shows the variant's
`title` and `description`, so every option is explained before it is chosen. Phase 1's largest
union has three options. A fallback for long unions is decided when a plugin needs one.

### 6. The service-auth wizard is a shell around the shared renderer

The wizard owns the steps, any copyable value such as the OAuth redirect URI, and the action
(Connect for `oauth2*` flows, Test and save for `token` flows). The fields it collects are drawn by
ADR-0019's renderer from the declared `fields` and `requirements()`. No service gets a bespoke page.

## Considered options

- **A sentence builder with blanks to fill.** Rejected because it breaks down with several inputs
  or modifiers. The sentence survives as a summary (§3).
- **A free node canvas.** Rejected because it offers wiring the runner cannot execute.
- **A plain list–detail layout.** Rejected as the weakest identity.
- **A select, or a segmented control, for a discriminator.** A select hides every description but
  the chosen one. A segmented control needs short titles and does not fit the side panel.
- **A bespoke page per service.** It made Plex nicer through plex.tv server discovery. That
  discovery is a different flow, which would change ADR-0013's surface, and it is not needed for
  Phase 1.

## Consequences

- The Vue UI spec builds these screens: first run, applet list, builder, run view, settings and the
  service-auth wizard.
- The logo is redesigned in ADR-0027; the v1 SVGs are retired.
- Signing in through plex.tv is out of scope for Phase 1. It is a future auth flow, not a UI change.
