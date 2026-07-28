# ADR-0004 — Typed plugin SDK with explicit registration

**Status:** Accepted
**Date:** 2026-07-28

## Context

v1 discovers plugins by walking directories and `importlib`-importing any `up_*.py`, then trusts
an untyped `handshake` dict and a `run(settings_dict, **kwargs)` signature. Failures surface at
runtime (e.g. issue #59, `'name'` KeyError), settings forms are hand-built as description dicts in
each plugin's `builder()`, and there is no compile-time contract. This is the single biggest
source of plugin fragility, and it is exactly the surface AI agents will be generating most.

## Decision

Plugins are **typed modules registered explicitly** against a shared SDK (`packages/plugin-sdk`),
not discovered by dynamic import. Each plugin is authored with `definePlugin({ ... })`, which
takes a typed handshake — name, description, component type(s), mode(s), version, declared auth
need (ADR-0005), and a **Zod settings schema**. One Zod schema drives three things at once:
runtime validation, the inferred TypeScript type, and the auto-generated settings form in the Vue
frontend — so v1's hand-written `builder()` UI-description blocks largely disappear.

`run()` receives a fully typed context (component, applet id, persistent + instance settings,
global settings, and — for modifiers/outputs — the incoming song dict) and returns a typed song
dict (inputs/modifiers) or nothing (outputs). An optional `test()` validates credentials.

A plugin passes the shared **conformance test** (`CONTEXT.md`) to be considered ported.

## Consequences

- Malformed plugins fail at compile/registration time, not mid-sync.
- Third-party plugins install by being added to the registry rather than dropped into a scanned
  folder; the drag-and-drop story is revisited as its own decision if needed.
- The SDK's public shape is a **checkpoint gate** (AGENTS.md): changing it ripples across every
  plugin, so it is frozen early (roadmap Phase 0) and changed only deliberately.
- The detailed SDK surface (exact `definePlugin` signature, context object, auth helper API) is
  specified in `docs/proposals/plugin-sdk-v2.md` before implementation.
