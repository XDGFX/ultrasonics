# Reference — Plugin isolation on Bun

Research findings for ticket [003](../plans/tickets/003-plugin-isolation.md): how plugins are
isolated at run time, and what the chosen mechanism demands of the SDK boundary that ticket
[005](../plans/tickets/005-sdk-surface.md) freezes.

Durable facts, cited. Claims are marked **[measured]** where this document verified them by running
code, **[docs]** where a primary source states them, and **[uncertain]** where neither settles it.

## Summary

**Recommendation: design the SDK boundary Worker-shaped now, run in-process in Phase 1, and adopt
`WorkerExecutor` in Phase 2.** The ticket flags deferral as a legitimate answer; the evidence makes it
the *right* one, for a reason that was not anticipated — **Bun's docs still label `Worker`
experimental, explicitly "particularly for terminating workers"** **[docs]**, and Bun's own stability
tracking issue advises against the exact usage pattern a plugin runner wants.

**The crux question splits.** `terminate()` *does* reliably kill a worker wedged in a plain
`while(true)` loop — CPU drops from 993.9 ms/s to 3.6 ms/s and the thread is gone **[measured]** — and
a worker contains a `throw`, an unhandled rejection, `process.exit()` and an infinite loop, leaving
the host's event loop healthy **[measured]**. But `terminate()` does **not** kill a worker blocked in
`Bun.sleepSync` (thread survives until the sleep expires) or `Atomics.wait` (thread never dies; the
process never exits) **[measured]**, and the `node:worker_threads` flavour of `terminate()` returns a
Promise that never resolves in those cases **[measured]**. So: use the web `Worker` API, never
`await` terminate, and accept that a deliberately-blocking plugin can still leak a thread.

**Structured clone is a real constraint but a smaller one than the ticket assumes**, because
`RunContext` should never be cloned wholesale — only the wire payload must be serialisable, and the
worker-side harness rebuilds a live context around it, so `ctx.log.info()` stays an ordinary call.
The genuine hazard is that the sketched context fails *silently*: a `Logger` class instance clones
without error into a method-less plain object, so `ctx.log.info()` throws `TypeError` deep inside the
plugin rather than at the boundary **[measured]**. Designing that out is the main thing ticket 005
must do, and it costs nothing to do now.

Costs are otherwise unthreatening: ~1.4 ms to start a worker, ~4 MB RSS each, 76 ms to ship a
50,000-song dict, 0.011 ms per awaited RPC round trip **[measured]**. The one hole nothing in-runtime
closes is memory: Bun does not implement `worker_threads` `resourceLimits` **[docs]** and enforces no
heap cap **[measured]**, so only a subprocess under OS limits bounds a runaway allocation.

## How this was verified

Bun **1.3.13** (`1.3.13+bf2e2cecf`), macOS 24.5.0 (Darwin), arm64, Mac16,8. Every **[measured]** claim
comes from a throwaway script run on that machine; the scripts lived outside the repo and are not
committed. Numbers are from one machine and are indicative — the orders of magnitude are the
load-bearing part, not the digits. Linux/Docker, the actual deployment target, was not measured.

## 1. Bun `Worker` today

### Status: still experimental, and terminate is named as the weak spot

<https://bun.sh/docs/api/workers> opens with a warning callout, verbatim **[docs]**:

> The `Worker` API is still experimental (particularly for terminating workers). We are actively
> working on improving this.

Bun's stability tracking issue **#15964, `Worker` & `worker_threads` stability tracking issue** (open;
created Dec 2024, last updated May 2026) goes further
(<https://github.com/oven-sh/bun/issues/15964>) **[docs]**:

> When using `Worker` or `worker_threads` in Bun, I strongly suggest not calling `.terminate` or
> otherwise, ensuring they stay alive and reusing them instead of creating temporary ones and
> destructing them.
>
> `Worker` in Bun is still marked as experimental. There are many different issues related to this.

This is the most consequential finding in the document, because "spawn a temporary worker per plugin
run and `terminate()` it on timeout" is precisely the pattern being warned against. It does not make
Workers wrong — the measured behaviour is good — but it argues strongly for *not* betting Phase 1 on
them, and for a warm-worker design rather than worker-per-run when they do land (see
[Recommendation](#recommendation)).

Termination is also the most actively-churning area of the codebase: a search of
<https://github.com/oven-sh/bun/issues?q=is%3Aissue+worker+terminate> returns ~70 items, and roughly
25 open PRs from the preceding six weeks fix use-after-free and abort paths where `terminate()`
races in-flight native work — `fetch`, webcrypto, `Bun.password`, DNS, the bundler, `Bun.serve`,
redis (e.g. #35767, #35758, #35156, #35161, #33939, #36342). Open issues in the same area include
**#34690** (ASAN failure during worker terminate, reproduced by Bun's bot "roughly 1 in 5 runs") and
**#33936** (transpiler job racing terminate reads freed memory). **[docs]**

Attempting to reproduce this: 20 runs terminating a worker with 8 concurrent `fetch`es, a bcrypt hash
and hashing in flight were **clean 20/20 — no crash, no hang** **[measured]**. That is a light probe,
not a stress test, and does not contradict the open PRs; it does suggest the common case is not
crashing on 1.3.13.

### Module loading

A worker loads **TypeScript and ESM directly**, no build step **[measured]**. Docs confirm **[docs]**:

> Like the rest of Bun, `Worker` supports CommonJS, ES modules, TypeScript, JSX, and TSX with no
> extra build step.
>
> You can use `import` and `export` syntax in your worker code. Unlike in browsers, you don't need to
> pass `{type: "module"}` to use ES modules.

`{ type: "module" }` is a **no-op** in Bun — the shipped type definitions annotate
`WorkerOptions.type` with `/** In Bun, this does nothing. */` **[docs]**. The specifier is *"resolved
relative to the project root"* **[docs]**.

⚠️ **Relevant to `packages/cli`:** worker path resolution differs between `bun run` and
`bun build --compile`. Issue **#15981** (open, updated Jul 2026,
<https://github.com/oven-sh/bun/issues/15981>) reports `new Worker(new URL("./worker.ts",
import.meta.url).href)` working under `bun run` but failing under `--compile` with
`ModuleNotFound resolving "/$bunfs/root/..."`; Bun's bot confirmed the repro and a fix is in progress.
**[docs]** If the CLI runner is ever shipped as a compiled binary, verify this first.

### Capabilities inside a worker

All available **[measured]**: `node:fs`, `node:crypto`, `node:net`, `bun:sqlite` (opened `:memory:`
and queried), global `fetch`, and dynamic `import()` of local modules. Bun's docs describe a worker as
*"a new JavaScript instance running on a separate thread while sharing I/O resources with the main
thread"* **[docs]**.

**A Bun Worker is therefore not a sandbox.** Plugin code inside one has full filesystem and network
access. Workers buy *fault* isolation, not *privilege* isolation — relevant if third-party plugins
ever arrive.

### Startup latency and memory floor

**No Bun documentation states a worker startup time or memory floor.** The workers page carries only
`postMessage` micro-benchmarks. These numbers are therefore measured, not cited, and should not be
quoted elsewhere as Bun facts. **[measured]**

| Measure | Result |
|---|---|
| Worker construct → first message (n=30) | min 1.11 ms · **p50 1.40 ms** · p90 2.38 ms · max 2.69 ms |
| RSS per idle worker (20 live) | **~3.95 MB** each (35.5 MB → 114.5 MB) |
| RSS after terminating all 20 | 111.7 MB — **not promptly returned to the OS** |

The RSS retention deserves attention given the plan is a long-lived server. It is most likely
allocator retention rather than a leak, and Bun's general worker-leak issue #5709 was closed as
not-reproducible on 1.3.13 **[docs]** — but issue **#31771** (open) reports linear RSS growth from
module records retained across `bun test --isolate` global swaps, still present in 1.3.14 **[docs]**.
Unresolved; see [Confidence and gaps](#confidence-and-gaps).

The only documented memory lever is `{ smol: true }`, which *"sets `JSC::HeapSize` to be `Small`
instead of the default `Large`"* **[docs]**. No quantified saving is documented anywhere.

### The crux: does `terminate()` kill a hung worker?

**For a plain JS infinite loop, yes — decisively. [measured]**

The metric was validated for sensitivity first, so a null result would mean something:

```
[baseline]  1s idle, no worker spinning     -> user CPU    2.9 ms
[spinning]  1s while worker in while(true)  -> user CPU  993.9 ms   <- metric IS sensitive
[after term] 1s after terminate()           -> user CPU    3.6 ms   <- thread is dead
terminate() returned in 0.16 ms
```

A second test confirmed the thread genuinely dies rather than merely detaching: with no
`process.exit()` call, the process exited 1 ms after `terminate()` **[measured]**.

**For other blocking primitives, no.** Detector: call `terminate()`, then let the process exit
naturally — a live thread holds it open. **[measured]**

| Worker blocked in | `terminate()` outcome | Process exits? |
|---|---|---|
| `while(true){}` (plain JS) | **thread dies** | yes, +1 ms |
| `Bun.sleepSync(30000)` | thread **survives** until the sleep expires | yes, but only at +30 s |
| `Atomics.wait(...)` | thread **never dies** | **no — never** (watchdog killed at 40 s) |

Both gaps have open, unmerged PRs: **#35103** (`Bun.sleepSync`) and **#32802** (`Atomics.wait`);
**#36356** covers pure-Wasm loops, untested here. **[docs]** Bun's docs are silent on synchronous
loops; the closest admission is on the `"close"` event — *"the worker itself can take some time to
fully exit"* **[docs]**.

**Practical read:** the realistic accidental plugin bug — a runaway `while (nextPage)` pagination
loop — is killed cleanly. A plugin that blocks in `sleepSync` or `Atomics.wait`, whether by mistake
or malice, leaks a thread and can prevent clean shutdown. Since Workers are not a security boundary
anyway (above), this is a robustness caveat, not a new attack surface.

### Two `terminate()` APIs, and only one is safe to await

**[measured]**, reconciling a discrepancy that matters:

- Web `Worker.terminate()` returns **`undefined`** (matching WHATWG). The host stays responsive in
  every case tested.
- `node:worker_threads` `Worker.terminate()` returns a **Promise** — which resolved in 2 ms for a JS
  loop but **never resolved** (6 s cutoff) for both `Bun.sleepSync` and `Atomics.wait`.

**Rule for the runner: use the web `Worker` API and never `await` `terminate()`.** Awaiting the
`worker_threads` variant hangs the runner on exactly the plugins you most need to kill.

### Failure containment

Each mode ran inside a worker while the host ticked a 100 ms interval for 3 s (≈30 ticks if healthy).
**[measured]**

| Plugin does | Host survives? | Host observes |
|---|---|---|
| `throw new Error(...)` | **yes** — 29 ticks | `error` event, then `close` code 1 |
| Unhandled promise rejection | **yes** — 29 ticks | `error` event, then `close` code 0 |
| `process.exit(3)` | **yes** — 29 ticks | `close` code 3; **no `error` event** |
| `while(true){}` | **yes** — 29 ticks | nothing until the host calls `terminate()` |

Docs confirm the `process.exit()` case **[docs]**: *"A worker can terminate itself with
`process.exit()`. This does not terminate the main process… the exit code is passed to the `"close"`
event."* This is a significant win, because `process.exit()` is exactly what a try/catch cannot
survive in-process (§3).

Note the asymmetry: a crash announces itself, but **a hang is silent**. The runner must impose its own
wall-clock deadline per run — nothing surfaces automatically.

### Lifetime

`worker.unref()` / `ref()` and a `{ ref: false }` constructor option exist **[docs]**. There is a
**documented contradiction**: the docs say *"Workers are ref'd by default"*, while the shipped types
say `ref` defaults to `false` **[docs]**. Pass it explicitly rather than relying on the default.

### Memory: the gap nothing in-runtime closes

Bun's Node compatibility page states for `node:worker_threads` **[docs]**:

> 🟡 `Worker` doesn't support the following options: `stdin` `stdout` `stderr`
> `trackedUnmanagedFds` `resourceLimits`. Missing `markAsUntransferable` `moveMessagePortToContext`.

`resourceLimits` is Node's mechanism for capping a worker's heap, so **Bun workers cannot be
memory-capped**. Nor can the process: a bounded probe allocated to a self-imposed 3 GB ceiling with no
error and no cap encountered **[measured]**. `--smol` is documented as a GC-aggressiveness hint
(<https://bun.com/docs/runtime>) **[docs]**, not a limit, and no `--max-old-space-size` equivalent is
documented. An open report claims the flag is accepted but ineffective
(<https://github.com/oven-sh/bun/issues/34917>) **[uncertain]** — community-filed, unconfirmed.

**Consequence:** a memory-runaway plugin can OOM the host under Worker *and* in-process. Only a
subprocess under cgroups/`rlimit` closes this. Accepted residual risk — it is rarer than the
crash-and-hang cases and is the only one Workers do not fix.

## 2. Structured-clone constraints

### What the spec says

The WHATWG `StructuredSerializeInternal` algorithm
(<https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal>) **[docs]**
serialises: primitives including `BigInt`; `Boolean`/`Number`/`String` wrappers; `Date`; `RegExp`;
`ArrayBuffer`, `DataView` and TypedArrays; `Map`; `Set`; `Error` types; and `Array`/plain `Object` via
their enumerable own properties.

It throws `DataCloneError` for `Symbol` (step 5), **anything callable** — *"if IsCallable(value) is
true, then throw a "DataCloneError" DOMException"* (step 21) — and non-serialisable platform objects
(step 20).

Two details bite the SDK directly:

- **Error subtypes are flattened.** Step 17: *"If name is not one of "Error", "EvalError",
  "RangeError", "ReferenceError", "SyntaxError", "TypeError", or "URIError", then set name to
  "Error"."* A `class PluginAuthError extends Error` arrives as a plain `Error`, and **custom own
  properties on it do not survive** — the Error branch serialises only name, message and stack.
- **Prototypes are not walked.** MDN
  (<https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm>)
  **[docs]** lists as not surviving: *"The prototype chain — it is not walked or duplicated"* and
  *"Property descriptors, setters, getters, and similar metadata-like features"*.

Bun's workers page confirms it uses this algorithm **[docs]**, with two documented fast paths that
bypass it: a string fast path (*"no serialization overhead"*) and a simple-object fast path for plain
objects of primitives with no getters, indexed properties or prototype modifications **[docs]** —
which the song dict largely satisfies.

### What actually happens in Bun 1.3.13

**[measured]**, via `structuredClone()` and a real `postMessage`.

| Value | Result |
|---|---|
| Plain object / array / nested song dict | clones |
| `Date`, `RegExp`, `Map`, `Set`, `ArrayBuffer`, `Uint8Array`, `BigInt` | clone |
| `Error`, `TypeError` | clone; `name`, `message`, `stack` all preserved |
| Circular object | clones (references preserved) |
| `Symbol`, function, arrow function | **throws** `DataCloneError` |
| **Object with a function-valued own property** | **throws** `DataCloneError` |
| `Promise`, `WeakMap`, `Proxy`, `ReadableStream` | **throws** `DataCloneError` |
| **Class instance with methods** | **clones silently — methods gone, prototype `Object`** |
| Object with a getter | clones; getter flattened to a data property |
| `bun:sqlite` `Database` handle | **clones silently** into `{ filename }` — a useless husk |

### The silent-failure footgun

The `RunContext` sketched in `plugin-sdk-v2.md` was sent through a real worker `postMessage`. It
**did not throw**. It arrived degraded **[measured]**:

```
received keys: component, appletId, persistent, instance, credentials, songs, configDir, log, db
typeof ctx.log = object; ctx.log prototype = Object
typeof ctx.log.info = undefined
ctx.log.info() THREW: TypeError: ctx.log.info is not a function
typeof ctx.credentials.isExpired = undefined
ctx.credentials.token = tok            (plain data survived)
ctx.db keys after clone = ["filename"]; typeof ctx.db.query = undefined
ctx.songs...songs[0].title = Song A    (plain data survived)
ctx.configDir = /config
```

This is the worst possible failure shape. A `Logger` *class instance* clones without complaint because
its methods live on the dropped prototype, so the error surfaces deep inside a plugin at call time.
An object literal holding a function as an own property, by contrast, throws `DataCloneError`
immediately and loudly. The SDK should prefer the loud failure and, better, make the situation
unrepresentable.

### The resolution: don't clone `RunContext`

The ticket's framing — "a Worker's structured-clone constraint would reshape `RunContext` directly" —
overstates it, because **`RunContext` should never cross the wire**. What crosses is a plain-data
payload; the worker-side SDK harness constructs a live `RunContext` around it, with a real `Logger`
whose methods `postMessage` back. The plugin author still writes `ctx.log.info("…")` as an ordinary
call.

So the constraint is not "`RunContext` must be cloneable", but:

1. every **data** field must be plain-data cloneable, and
2. every **service** field must be a facade the harness reconstructs — never a live handle.

### Does `log()` have to become async?

**No, and it should not.** `ctx.log.info()` stays `void`-returning and fire-and-forget: it posts a
message and returns, at **0.0004 ms per call** **[measured]** — free at any realistic logging rate,
with ordering preserved by the message queue.

Where a plugin needs a host-side *answer* (a credential refresh), that call must be `async` — and an
awaited round trip costs **0.011 ms** (~87,500/sec) **[measured]**. RPC ergonomics are a non-issue;
the only real requirement is that such methods are **typed `Promise`-returning from day one**, since
making a sync method async later breaks every plugin.

`MessageChannel`, `MessagePort`, `MessageEvent` and `structuredClone` are all 🟢 fully implemented per
Bun's compatibility page **[docs]**, and transfers work: an `ArrayBuffer` transfer detached the source
(`byteLength` 0) and a `MessagePort` transfer succeeded **[measured]**. A Comlink-style RPC layer is
therefore viable; Comlink's historical Bun segfault (**#23194**, `MessagePort::postMessage` after
~3,700 proxied callbacks) was **closed** Apr 2026 **[docs]**, though that report also notes needing
`import * as Comlink from 'comlink/dist/esm/comlink.js'` to avoid Bun loading the CJS build
**[uncertain]** — untested here. Given the round-trip numbers, a small bespoke RPC shim is likely
preferable to the dependency.

### Song-dict transfer cost

The payload that crosses on every run. **[measured]**

| Songs | ~JSON size | `postMessage` round trip | Local `structuredClone` |
|---:|---:|---:|---:|
| 100 | 0.02 MB | 0.3 ms | 0.1 ms |
| 1,000 | 0.19 MB | 1.8 ms | 1.1 ms |
| 10,000 | 1.95 MB | 14.6 ms | 9.8 ms |
| 50,000 | 9.89 MB | 76.5 ms | 64.1 ms |

Negligible against a sync that spends seconds in service HTTP calls. Paid twice per modifier (in and
out), and the dict is **copied, not shared** — a 50,000-song dict transiently exists in both threads.

## 3. The alternatives, costed

### Subprocess (`Bun.spawn`)

**Isolation:** the strongest available — separate memory, OS-level `kill()`, and uniquely the option
of OS-enforced resource limits from outside Bun.

**Cost:** spawn → first IPC message measured at **17.5 ms** vs ~1.4 ms for a worker **[measured]** —
~12× worse, still small absolutely.

**IPC works.** `Bun.spawn` takes an `ipc` handler, with `subprocess.send()` parent→child and
`process.send()` / `process.on("message")` child→parent; docs state this is *"the same API used for
`child_process.fork()` in Node.js"* (<https://bun.sh/docs/api/spawn>) **[docs]**. Verified
**[measured]**.

**Same serialisation constraint, minus transferables.** Docs describe the default
`serialization: "advanced"` as using *"the JSC `serialize` API, which supports cloning everything
`structuredClone` supports"*, adding *"This does not support transferring ownership of objects."*
**[docs]** Measured: `Date`, `Map` and `Uint8Array` survived intact; sending a function threw
`DataCloneError` **[measured]**. **A subprocess boundary imposes exactly the same SDK constraints as a
Worker boundary** — which is what keeps the choice reversible.

**Credential passing is solvable, and the obvious routes are the leaky ones.** Measured on a spawned
child: `env` was readable as `process.env.PLUGIN_SECRET` and argv as `process.argv` **[measured]** —
both also exposed to other processes on the host (`ps` for argv, `/proc/<pid>/environ` for env on
Linux). The IPC channel avoids both: a secret sent via `proc.send({ secret })` arrived intact
**[measured]** without touching argv or the environment. Piped stdin is equally good **[docs]**. So:
**pass credentials over IPC or stdin, never argv or env** — Bun's docs make no security claim either
way, so this is sound inference rather than a documented recommendation **[uncertain]**.

**Resource limits: none from Bun.** The spawn docs offer `timeout`, `killSignal`, `signal` and
(`spawnSync` only) `maxBuffer`, but no memory or CPU option; `resourceUsage()` is observe-only,
post-exit **[docs]**. A memory cap requires cgroups or `rlimit` outside Bun — exactly the capability
Workers cannot have, and the only real argument for subprocesses here.

**Verdict:** buys one thing Workers do not — an enforceable memory ceiling — at 12× startup, a heavier
IPC path and materially more operational surface (process lifecycle, zombie reaping, stdio plumbing,
credential hygiene). Since the SDK constraints are identical, this stays revisitable without touching
plugin code.

### In-process

Free, and genuinely zero isolation. What a try/catch around `await plugin.run(ctx)` does and does not
save you from **[measured]**:

| Plugin does | try/catch saves you? | What happens |
|---|---|---|
| `throw new Error(...)` | **yes** | caught; runner continues |
| `async` fn that rejects (awaited) | **yes** | caught; runner continues |
| **Unhandled/floating rejection** | **no** | Bun prints the error; **process exits code 1** |
| **`process.exit(42)`** | **no** | process dies with code 42; `'exit'` handler runs, cannot veto |
| **Infinite loop** | **no** | event loop wedged; a `setTimeout` watchdog **cannot fire** |
| **Memory runaway** | **no** | no heap cap; allocates until the OS intervenes |

Three of six are unrecoverable, and none are exotic — a floating promise is among the commonest
mistakes in async JS.

Mitigations, both partial:

- A process-global `process.on("unhandledRejection")` handler **does** rescue the process
  **[measured]**; Bun has supported it since 1.1.8 (<https://bun.sh/blog/bun-v1.1.8>) **[docs]**. But
  it is process-global — it cannot reliably attribute a rejection to the plugin that caused it, so
  the runner cannot fail *that run* and continue. Node warns `uncaughtException` is *"a crude
  mechanism… It is not safe to resume normal operation"* (<https://nodejs.org/api/process.html>)
  **[docs]**.
- Nothing mitigates `process.exit()` — *"There is no way to prevent the exiting of the event loop at
  this point"* (<https://nodejs.org/api/process.html#processexitcode>) **[docs]**.
- Nothing mitigates the infinite loop: JS is run-to-completion — *"whenever a function runs, it cannot
  be preempted and will run entirely before any other code runs"*
  (<https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Execution_model>) **[docs]**,
  confirmed measured (a 500 ms watchdog never fired during a 3 s synchronous loop).

**Verdict:** acceptable *only* while every plugin is first-party and reviewed — exactly Phase 1's
situation. Not acceptable permanently; ADR-0001's goal ("one bad plugin cannot crash a sync") is not
met by it.

### `node:vm` and `isolated-vm`

**Bun implements `node:vm`,** listed 🟡 partial: *"Core functionality and ES modules are implemented,
including `vm.Script`, `vm.createContext`, `vm.runInContext`, `vm.runInNewContext`,
`vm.runInThisContext`, `vm.compileFunction`, `vm.isContext`, `vm.Module`, `vm.SourceTextModule`,
`vm.SyntheticModule`, and `importModuleDynamically` support. Options like `timeout` and
`breakOnSigint` are fully supported."* **[docs]** All importable **[measured]**.

**It is scoping, not isolation.** A fresh context has no ambient `process`, `require`, `Bun` or
`fetch` **[measured]** — but the classic constructor escape works immediately:

```js
vm.runInNewContext("this.constructor.constructor('return process.env.SUPER_SECRET')()", {})
// => "hunter2"   <- read the host's environment, from inside the "sandbox"
```

**[measured]** A sandboxed script read a host environment variable — the whole credential store. This
is not a Bun defect (Node documents `node:vm` as not a security mechanism) but it settles the
question: **no security boundary**.

One genuinely useful property: `runInNewContext(code, ctx, { timeout: 300 })` **did interrupt** a
synchronous `while(true)`, throwing `ERR_SCRIPT_EXECUTION_TIMEOUT` after 301 ms **[measured]** —
something `terminate()` cannot do for `sleepSync`/`Atomics.wait`. It solves neither `process.exit()`
nor memory, and shares the event loop. Note open issue **#31885** (instability with `breakOnSigint`,
contradicting the doc's "fully supported") and open PR **#35979**, which implies the timeout watchdog
is not currently scoped per-evaluation — so concurrent `vm` timeouts on one thread may interfere
**[uncertain]**. **[docs]**

**`isolated-vm` does not work under Bun. [docs]** Its prebuilt binary fails `dlopen` on a missing V8
C++ symbol (`v8::ValueSerializer::Delegate::IsHostObject`). The cause is architectural, not a bug:
`isolated-vm` is a V8-C++-API addon, whereas Bun implements Node-API
(<https://bun.sh/docs/api/node-api>); V8 C++ API support is partial and tracked by open issues
**#4290** and **#3110**. This removes the option entirely.

### Side-by-side

| | In-process | `node:vm` | **Worker** | Subprocess |
|---|---|---|---|---|
| Startup | 0 | ~0 | **1.4 ms** | 17.5 ms |
| Memory floor | 0 | ~0 | **~4 MB** | ~35 MB+ |
| Survives plugin `throw` | yes | yes | **yes** | yes |
| Survives floating rejection | **no** | no | **yes** | yes |
| Survives `process.exit()` | **no** | **no** | **yes** | yes |
| Survives JS infinite loop | **no** | yes (`timeout`) | **yes** (`terminate()`) | yes (`kill()`) |
| Survives `sleepSync`/`Atomics.wait` | **no** | **no** | **partial** (thread leaks) | yes |
| Survives memory runaway | **no** | **no** | **no** | yes (with OS limits) |
| Security boundary | no | **no** | no | partial |
| API maturity | n/a | 🟡 partial | **experimental** | stable |
| SDK must be clone-safe | no | no | **yes** | **yes** |

## 4. Can isolation be deferred behind an interface?

**Yes, and it is the recommended path.** Because Worker and subprocess boundaries impose *identical*
SDK constraints (§3), designing for either covers both. The runner gains a strategy seam:

```ts
interface PluginExecutor {
  run(plugin: RegisteredPlugin, payload: RunPayload, deadlineMs: number): Promise<RunResult>;
}
// Phase 1: InProcessExecutor — direct call, try/catch, no clone
// Phase 2: WorkerExecutor    — postMessage; terminate() on deadline breach
```

Switching later is invisible to plugins **only if** the SDK adopts these constraints from day one.
Each is listed with what breaks if skipped.

1. **Every `RunContext` data field is plain-data cloneable.** No class instances, no live handles, no
   `Proxy`. *Skip it and:* `credentials` as a class with `refresh()` silently loses its methods the
   day you switch — the exact silent failure measured in §2.
2. **Host services are async-typed from the start.** Any `RunContext` method reaching the host for an
   *answer* returns `Promise<T>`, even though Phase 1 answers synchronously. *Skip it and:* every
   plugin calling it synchronously breaks at once.
3. **Fire-and-forget stays `void`.** `ctx.log.info()` returns `void` in both worlds and is never
   awaited. *Skip it and:* an author may await a logger and depend on timing that later changes.
4. **No `instanceof` across the boundary, in the SDK or in plugins.** Errors carry a discriminating
   `code`, not a subclass. *Skip it and:* every `catch (e) { if (e instanceof PluginAuthError) }`
   silently stops matching, because the spec flattens the name to `"Error"` (§2).
5. **Plugin return values are plain data.** Already true of `SongDict`; state it so nobody returns a
   stream or live object. *Skip it and:* the return path throws `DataCloneError`.
6. **No shared mutable state between plugin and host** beyond `RunContext` — no module-level
   singletons the host also writes, no reliance on the host's `process.env` at run time. *Skip it
   and:* plugins that work in-process quietly stop seeing host state in a worker.
7. **Every plugin run has a wall-clock deadline in the contract from day one.** In-process it can only
   be reported after the fact; in a worker it triggers `terminate()`. *Skip it and:* adding a deadline
   later changes observable behaviour for long-running plugins.
8. **`configDir` stays a path string, not a handle.** Already correct in the proposal — worth pinning,
   since the temptation is to hand over an opened DB or fs handle.
9. **Plugins avoid `Bun.sleepSync` and `Atomics.wait`.** These are the two blocking forms
   `terminate()` cannot interrupt (§1). A lint rule banning them in `packages/plugins` is a cheap
   machine-checked invariant. *Skip it and:* one plugin can prevent clean shutdown.

**The honest cost of deferring:** constraints 1, 2, 4 and 7 cost something now — they make the Phase 1
SDK slightly less ergonomic than it could be (async signatures with no async work behind them; error
codes instead of a natural error hierarchy). That price is small, contained, and paid in the SDK
rather than in the plugins. The alternative — freezing an unconstrained surface under ADR-0004 and
breaking it later — is the expensive one.

**One caveat.** A `WorkerExecutor` cannot be introduced as a pure runner swap unless plugins are
loadable *by path* inside a worker. Under ADR-0004's explicit registry, plugins are imported modules
in an array; a worker needs a module specifier. Keep a resolvable module path (or a registry-key → path
map) alongside each registry entry from the start, or the swap also touches the registry shape that
ticket 005 freezes.

## Recommendation

**Freeze the SDK against a Worker-shaped boundary now; ship `InProcessExecutor` in Phase 1; adopt
`WorkerExecutor` in Phase 2 — or sooner if a first-party plugin hangs a sync in practice.**

Three reasons deferral wins over adopting Workers immediately:

1. **Bun says so.** `Worker` is documented as experimental "particularly for terminating workers", and
   Bun's tracking issue advises reusing workers rather than creating and terminating temporary ones —
   the pattern a per-run isolator wants. Termination is under heavy, largely-unlanded repair.
2. **Phase 1 does not need it.** Every Phase 1 plugin is first-party and reviewed; in-process failure
   modes are survivable in code review terms. Isolation earns its keep when unreviewed plugins arrive.
3. **It costs almost nothing to keep the option.** The nine constraints above are cheap now and
   ruinous later, and they buy the subprocess option as well.

**When `WorkerExecutor` lands**, three design rules follow directly from the measurements: use the
**web `Worker`** API and never `await terminate()`; prefer a **warm pool** with `terminate()` reserved
as the deadline escape hatch, rather than worker-per-run (per issue #15964); and treat memory as
unbounded — if a hard cap is ever needed, that is the subprocess conversation, not a Worker option.

### Amended `RunContext`

Changes from `docs/proposals/plugin-sdk-v2.md` are marked. What the plugin author writes barely
changes; what changes is that every field is now either plain data or an explicitly-reconstructed
facade.

```ts
/** Plain data only. This is what actually crosses the boundary (structured-cloneable). */
interface RunPayload<P, I> {
  component: "inputs" | "modifiers" | "outputs";
  appletId: string;
  runId: string;                     // NEW: correlates fire-and-forget log messages to this run
  persistent: P;                     // plain data (Zod-parsed) — unchanged
  instance: I;                       // plain data (Zod-parsed) — unchanged
  credentials: Credentials;          // CHANGED: a plain-data token bag, NOT a class instance.
                                     //   No refresh()/isExpired() methods on it.
  songs: SongDict;                   // plain data — unchanged
  configDir: string;                 // string path, never a handle — unchanged
  deadlineMs: number;                // NEW: wall-clock budget; runner terminates past this
}

/** What the plugin author receives. Built by the SDK harness on the plugin's side of the
 *  boundary from a RunPayload — never cloned, never sent. */
interface RunContext<P, I> extends RunPayload<P, I> {
  log: Logger;                       // CHANGED in nature, not in use: a facade whose methods post
                                     //   messages. Still called as ctx.log.info("...").
  auth: AuthGateway;                 // NEW: takes over the behaviour that would have sat on
                                     //   `credentials`.
}

/** Fire-and-forget. Every method returns void and must never be awaited. */
interface Logger {
  info(message: string, fields?: Record<string, JsonValue>): void;
  warn(message: string, fields?: Record<string, JsonValue>): void;
  error(message: string, fields?: Record<string, JsonValue>): void;
}

/** Anything needing a host-side ANSWER is async from day one, even though Phase 1's
 *  in-process implementation resolves immediately. */
interface AuthGateway {
  refresh(): Promise<Credentials>;
}

/** Errors cross as plain Errors — the spec flattens subclasses. Discriminate on `code`. */
type PluginErrorCode = "auth" | "rate-limit" | "not-found" | "service" | "config";
declare function pluginError(code: PluginErrorCode, message: string): Error; // sets e.code
```

The four substantive changes:

- **`credentials` becomes plain data**, with behaviour moved to the async `auth` facade. The single
  most important change: a `Credentials` class instance is the field most likely to be written with
  methods, and it fails *silently* (§2).
- **`log` is specified as a facade**, documented as reconstructed plugin-side and fire-and-forget. It
  does *not* become async; plugin ergonomics are unaffected.
- **`runId` and `deadlineMs` are added** — the first so fire-and-forget log lines can be attributed to
  a run, the second so the timeout contract exists before it is enforced.
- **Errors are discriminated by `code`, never `instanceof`.**

### What the conformance test should add

`runConformance(plugin)` gains a boundary check: push the plugin's payload and return value through
`structuredClone()` and fail on `DataCloneError`, **and** assert no field of the clone has lost
methods — reject any value whose prototype is not `Object.prototype`, `Array.prototype`, or a known
cloneable builtin. The second half catches the silent failure; the first half alone would have passed
the broken sketch in §2. Per the repo's machine-checked-invariants preference, pair it with a lint
rule banning `Bun.sleepSync` and `Atomics.wait` in `packages/plugins`.

## Confidence and gaps

**High confidence, measured on Bun 1.3.13:** `terminate()` kills a plain-JS spinning worker but leaks
a thread on `Bun.sleepSync` and `Atomics.wait`; the `worker_threads` terminate Promise never resolves
in those cases while the web `Worker` variant keeps the host responsive; workers contain throw /
floating rejection / `process.exit()` / infinite loop; startup ~1.4 ms p50 and ~4 MB RSS; the full
structured-clone table including the silent class-instance degradation and the `bun:sqlite` husk;
`Bun.spawn` IPC works and carries secrets off argv/env; the in-process failure matrix; `node:vm`
exists, is escapable to the host realm, and its `timeout` interrupts a sync loop; song-dict transfer
and RPC round-trip costs.

**High confidence, from primary docs:** `Worker` is still labelled experimental, with termination
called out; issue #15964's advice against terminate-and-recreate; no `resourceLimits` on Bun workers;
`Bun.spawn` `serialization: "advanced"` is structured clone without transferables and offers no
resource limits; `isolated-vm` cannot load under Bun; the WHATWG serialisation rules including
Error-name flattening; MDN on prototypes and descriptors; `process.exit()` being unvetoable; JS
run-to-completion.

**Gaps and how to close them:**

- **Terminate-vs-in-flight-native-work crashes.** ~25 open Bun PRs fix use-after-frees here, and
  plugins do `fetch` constantly — but 20 runs terminating mid-`fetch`/bcrypt were clean. That probe is
  far too light to be reassuring. Before `WorkerExecutor` ships, run a few thousand iterations under
  ASAN or at least in CI, and re-check #34690, #33936 and #32073.
- **RSS not returned after `terminate()`** (111.7 MB retained of 114.5 MB after killing 20 workers).
  Not chased down; likely allocator retention, but issue #31771 reports genuine linear growth in a
  related path. Close it by spawning/terminating ~1,000 workers sequentially and plotting RSS — if it
  grows without bound, worker-per-run is wrong and the warm pool is mandatory rather than preferred.
- **True unbounded OOM behaviour** deliberately not tested (machine safety); the probe stopped at a
  self-imposed 3 GB. "No heap cap" is safe; the failure *mode* (clean crash vs OS kill vs swap death)
  is unverified.
- **Wasm loops** (`terminate()` vs a pure-Wasm spin, open PR #36356) untested. Low priority unless a
  plugin ships Wasm.
- **`bun build --compile` + workers** (#15981) untested here and open upstream. Verify before shipping
  a compiled `packages/cli`.
- **Comlink on 1.3.13** untested (its primitives were verified); the CJS/ESM resolution workaround may
  or may not still be needed.
- **`ref` default** is contradicted between Bun's docs and its types; pass it explicitly.
- **Bun's default for unhandled rejections** is not documented explicitly **[uncertain]**; measured
  behaviour was exit code 1. If in-process hosting ships in Phase 1, pin it with
  `--unhandled-rejections=strict` rather than relying on a default.
- **All numbers are one machine, one run, macOS arm64.** Linux/Docker was not measured; re-measure
  worker startup and RSS inside the production container before quoting these as fact elsewhere.
