# 003 — Plugin isolation mechanism

**Status:** Open · **Type:** research (AFK) · **Blocked by:** — · **Blocks:** 005 · **Claimed by:** —

## Question

How are plugins isolated at runtime — Bun `Worker`, subprocess, or in-process — and what does the
chosen mechanism demand of the SDK boundary?

ADR-0001 wants isolation so one bad plugin cannot crash a sync. `plugin-sdk-v2.md` lists this as an
open question. It is **not** an SDK detail: if plugins run in a Worker, everything crossing the
boundary must be structured-cloneable, which rules out passing a live `Logger`, an open database
handle, or a class instance in `RunContext` — and `RunContext` is exactly what 005 freezes. Decide
this *before* the surface, not after.

## What to establish

- What Bun's `Worker` support can actually do today: module loading, npm deps inside a worker,
  memory/lifetime cost per worker, and whether a hung worker can be terminated cleanly.
- Whether structured-clone constraints are tolerable for `RunContext` as sketched, or force an
  RPC-shaped boundary (`log()` becomes a message, not a function).
- The cost of the alternatives: subprocess (heavier, stronger isolation, harder credential passing)
  vs in-process (free, no isolation, one `throw` from a plugin author kills the run).
- Whether isolation can be deferred behind an interface that keeps 005 honest without paying for it
  in Phase 1 — a legitimate answer, if the boundary is designed for it now.

## Notes

This is an AFK ticket: resolve with a `/research` subagent against Bun's documentation and real
behaviour, and record cited findings. It needs no live conversation, which is why it sits on the
frontier alongside the HITL tickets — run it in parallel with them.
