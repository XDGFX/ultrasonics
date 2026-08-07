# Build process — cells and waves

**Read this when** you are about to build a unit of code, or dispatch a wave of them. Not needed for
planning, decision or documentation sessions — `AGENTS.md` covers those on its own.

`plans/map.md` covers what is still **undecided**; this covers how decided work gets **built**.

## The cell — the atom of work

One deliverable, run through one pipeline. Learn it once and a wave of ten is the cell ten times.

```
(ambiguous?) → /research ──▶ docs/specs/<feature>.md ──▶ /grill-with-docs (freeze the spec)
            ──▶ worktree ──▶ /tdd  or  /implement ──▶ /verify
            ──▶ /code-review ──▶ /improve-codebase-architecture (anti-slop gate)
            ──▶ land on revival (PR only if parallel — AGENTS.md § Branching)
            ──▶ docs/handoffs/ + docs/sessions/
```

- **/research** only when the spec would otherwise rest on a guess; skip when the contract is
  already unambiguous.
- **/grill-with-docs** is mandatory for any cell touching a checkpoint gate (`AGENTS.md`). Skip it
  only when a frozen spec already covers the cell — never because the cell "seems simple".
- **/tdd** is the default wherever correctness matters (fuzzymatch, the runner, plugin I/O, auth);
  **/implement** is for scaffolding and wiring. When in doubt, `/tdd`.
- **/verify** means the cell was seen *running*, not merely green in tests.

A cell is **done** when the full package suite is green, both anti-slop gates passed, `/verify`
observed the behaviour, and its spec's acceptance criteria are ticked.

**Sizing.** Split a cell when it would resolve two independent decisions — not merely when it looks
long. Context is rarely the binding constraint; *reviewability* is. Equally, don't split work sharing
one contract across three cells just to look parallel: the coordination costs more than the
concurrency wins.

## The wave — how a phase becomes parallel work

A batch of cells dispatched together. Slice the phase into independently reviewable cells, draw
dependency edges only where correctness demands them, then size to the **rate-limit budget, not the
dependency graph** — a phase can be embarrassingly parallel and still run only **N concurrent
cells**.

**N = 3** currently. Cal's to tune: raise it once a full wave runs without hitting limits, lower it
the first time one stalls. Dispatch is human-gated — Cal opens each wave deliberately, which is a
rate-limit decision as much as a control one, since automated fan-out would cheerfully blow the
ceiling. Each cell runs as a background job.

## Skill → gate

Quality is a step that must pass, not a hope.

| Gate | Skill | Fails the cell if… |
|---|---|---|
| Ambiguity resolved | `/research` | the spec would otherwise rest on a guess |
| Contract frozen | `/grill-with-docs` | a checkpoint-gate spec still has open questions |
| Correctness | `/tdd` | behaviour isn't pinned by tests written first |
| It actually runs | `/verify` | the change was never exercised end-to-end |
| No bugs | `/code-review` | review surfaces an unaddressed correctness issue |
| No slop | `/improve-codebase-architecture` | it passes tests but degrades the architecture |

## Scaffold conventions — operational detail

The decisions are ADR-0014; this is how they run. The one-liners every session needs are in
`AGENTS.md` § Conventions — what follows is only read when you are building or wiring CI.

### Scripts

| Script | What it runs | Where |
|---|---|---|
| `bun run check` | `biome check --write` + `tsc --noEmit` (+ `vue-tsc` once `packages/web` exists) | Local only; mutating |
| `bun run check:ci` | `lint:check` · `format:check` · `type-check` · `cycle-check` | CI; read-only, fails rather than repairs |
| `bun run test` | `bun test` for the package you touched | Both |

CI triggers on PRs **and** direct pushes to `revival`, since sequential work commits straight to the
branch (`AGENTS.md` § Branching).

### The two import-cycle gates

They have different scopes and neither replaces the other:

- **Inside a package** — Biome's `noImportCycles`, configured `ignoreTypes: true` because type-only
  imports vanish at runtime and cannot cycle.
- **Across packages** — a script walking the workspace dependency graph in each `package.json`.
  Biome's rule is documented as project-scoped and computationally expensive, so it is not trusted to
  catch `@ultrasonics/core` ↔ `@ultrasonics/server`. Package-level cycles are the ones that hurt
  most, and this check is instant.

**There is no rebaseline file.** Biome has no baseline mechanism, so a cycle that must stand is
suppressed at the site:

```ts
// biome-ignore lint/correctness/noImportCycles: <why this cycle is unavoidable>
```

The justification sits at the cycle and shows up in the diff, which is the point — an earlier draft
of the roadmap specified a `cycle-check:update` rebaseline hatch, and ADR-0014 retired it in favour
of this.

### Agent permission allowlist

`.claude/settings.json` exists to stop agent waves becoming prompt-storms. The **deny** list is the
half that earns its keep.

- **Allow** — `bun test`, `bun run build`, `bun run check`, the `:check` variants, `bun install`;
  `git status`/`diff`/`log`/`add`/`commit`/`branch`/`checkout`/`worktree`; `gh issue view`,
  `gh issue list`, `gh pr view`, `gh pr list`.
- **Deny** — `gh issue comment|close|edit|label`, `gh pr comment|merge`, `git push --force`, and any
  push to `master`.

The denials enforce `docs/agents/issue-tracker.md`'s rule that the 40+ real user issues on the public
repo are **read-only evidence, never a work queue** — previously prose, now a check. The scope is
deliberately tight while `revival` might never land: an agent touching a stranger's issue thread is
unrecoverable, a permission prompt is a keystroke. Expect to loosen it if `revival` becomes the trunk
and issues move to GitHub properly.

## Notes

**Why PRs are optional.** `revival` is a working branch, not production, so the ceremony that
protects a release branch is pure friction. PR-for-everything was rejected: it reads as rigour but
buys only queueing latency and a review backlog. The rule is in `AGENTS.md` § Branching.

**A live board, when it's earned.** Once several cells are genuinely in flight at once — Phase 2's
one-agent-per-plugin fan-out — add a board under `docs/plans/` tracking each cell's status. Don't
keep one before then: the repo carried an execution tracker with nothing executing, and it went
stale twice in a day while looking authoritative.
