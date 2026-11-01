# Research: the HTTP layer for `packages/server`

**Date:** 2026-11-01
**Informs:** the server spec (Phase 1)
**Builds on:** ADR-0001 (Bun, WebSocket run logs), ADR-0007 (sessions), ADR-0018 (the inbound
webhook), ADR-0019 (settings forms from JSON Schema)
**Versions checked:** Bun 1.4.4 (2026-10-22), Hono 4.13.14 (2026-10-25) and 5.0.0-rc.1
(2026-10-10), Elysia 1.4.30 (latest tag) and 2.0.0-rc.1 (2026-10-28), `@hono/bun` 1.0.1

Primary sources only: bun.com, hono.dev and elysiajs.com docs, the GitHub repos, and the npm
registry (`npm view`). Counts come from `gh api` on 2026-11-01. Where a doc page did not say
something, I say so instead of filling the gap from memory.

## 1. Question

Should `packages/server` sit on plain `Bun.serve` (with its `routes` API), Hono or Elysia?

## 2. Summary

**Use Hono, with the Bun adapter from `@hono/bun` and Zod v4 through `@hono/zod-validator` or
`@hono/standard-validator`. Start on Hono 5 if it is stable when the server ticket is claimed;
otherwise start on 4.13 and use `@hono/bun`, which supports both.**

- **Zod is first-class in Hono and second-class in Elysia.** Hono's validators take a Zod v4
  schema for `json`, `form`, `query`, `param`, `header` and `cookie`, and type `c.req.valid()`
  from it. Elysia's native schema language is TypeBox. Zod comes in through Standard Schema,
  which arrived in 1.4 (13 Sep 2025), and OpenAPI generation needs a hand-written
  `mapJsonSchema: { zod: z.toJSONSchema }`. That sits awkwardly with ADR-0001 and `AGENTS.md`,
  which make Zod the validation library, because TypeBox ships alongside it either way.
- **Elysia has the worse bus factor and is mid-rewrite.** Elysia 2.0 is "a complete rewrite",
  currently at 2.0.0-rc.1. SaltyAom wrote 223 of its 340 commits in the last 12 months (66%).
  Open issues already report 2.0 regressions (#1958) and codemod misses (#1961).
- **Hono is also mid-major, but the change is mechanical.** Hono 5 (rc.1) is ESM-only, moves
  adapters into separate packages (`hono/bun` becomes `@hono/bun`), and tightens a few types:
  `c.req.query()` values become `string | undefined`, and `c.req.json()` returns `unknown`. Its
  lead (yusukebe, a Cloudflare developer advocate) wrote 45% of the last year's commits, and a
  second maintainer (usualoma) wrote another 10%.
- **Hono keeps Bun's native WebSocket.** `upgradeWebSocket` calls `server.upgrade()`, and
  `ws.raw` is Bun's `ServerWebSocket`, so Bun's pub/sub topics stay available. The handler
  factory receives the Hono context, so the session that middleware resolved is in scope at
  upgrade time.
- **Plain `Bun.serve` is viable but means hand-rolling.** Routes, method maps, typed params,
  cookies with automatic `Set-Cookie`, and upgrade-in-route are all built in. Missing are a
  middleware chain, validation, an in-process test harness and OpenAPI. Each of those becomes
  code that `packages/server` owns.
- **Hono has the least lock-in.** Its app is a `fetch(Request) => Response` function. Moving to
  Node or Deno means swapping the adapter. Moving to bare `Bun.serve` means writing the
  middleware Hono provided.

## 3. Zod v4 validation and OpenAPI

| | Validation of params/query/body | Zod v4 | OpenAPI from Zod v4 |
|---|---|---|---|
| `Bun.serve` | None. Call `schema.safeParse()` by hand | Whatever you write | Nothing built in |
| Hono | `zValidator(target, schema)` or `sValidator(target, schema)` middleware; `c.req.valid(target)` is typed | `@hono/zod-validator` 0.9.1 peers `zod ^3.25 \|\| ^4`; `@hono/standard-validator` 0.4.1 uses Standard Schema | `@hono/zod-openapi` 1.6.3 (peer `zod ^4`, built on `@asteasolutions/zod-to-openapi` 9.1.0); or the third-party `hono-openapi` 1.5.0 (Standard Schema) |
| Elysia | Route `body`/`query`/`params`/`headers`/`cookie` schemas; TypeBox (`t`) by default | Standard Schema since 1.4; the docs show Zod for `params` and `body` | `@elysiajs/openapi` with a user-supplied `mapJsonSchema: { zod: z.toJSONSchema }` |

- Hono lists the targets as "`json`, `query`, `header`, `param` and `cookie`" besides `form`,
  and `@hono/standard-validator` works with "any Standard Schema-compatible library"
  ([validation guide](https://hono.dev/docs/guides/validation)). Peer ranges are from
  `npm view` for [@hono/zod-validator](https://www.npmjs.com/package/@hono/zod-validator) and
  [@hono/standard-validator](https://www.npmjs.com/package/@hono/standard-validator).
- `@hono/zod-openapi` depends on `@hono/zod-validator` and `@asteasolutions/zod-to-openapi`
  ([npm](https://www.npmjs.com/package/@hono/zod-openapi)). Its OpenAPI output comes from that
  library, not from `z.toJSONSchema`. So the settings-form JSON Schema (ADR-0019) and the
  OpenAPI document could differ in edge cases, such as `io: "input"` versus output shapes. I
  have not verified whether they do. `hono-openapi` is maintained outside the `honojs` org
  ([rhinobase/hono-openapi](https://github.com/rhinobase/hono-openapi)).
- Hono's JSON validator needs `Content-Type: application/json`. Without it, "the request body
  will not be parsed" and the callback receives `{}`
  ([validation guide](https://hono.dev/docs/guides/validation)). Tests have to set the header.
- Elysia 1.4 added Standard Schema support on 13 Sep 2025. The release post says JSON Schema
  generation for Standard Schema is "not implemented yet" and points to `mapJsonSchema`
  ([Elysia 1.4](https://elysiajs.com/blog/elysia-14.html)). The current OpenAPI pattern for
  Zod 4 is `mapJsonSchema: { zod: z.toJSONSchema }`
  ([patterns: OpenAPI](https://elysiajs.com/patterns/openapi.html)).
- Elysia's TypeBox-specific features are documented for TypeBox only: coercion, `error`
  properties, `model` references and automatic file content-type checks. The docs say that
  with Standard Schema "Elysia will not be able to validate content type automatically"
  ([validation](https://elysiajs.com/essential/validation.html)). Elysia 1.4.30 has
  `@sinclair/typebox` as a peer dependency, and 2.0.0-rc.1 has `typebox >= 1.3.0`
  (`npm view`). TypeBox therefore installs even if every route uses Zod. In 2.0, Zod reaches
  the fast path through `t.Accelerate`, which is "flag under alpha"
  ([Elysia 2.0](https://elysiajs.com/blog/elysia-20.html)).
- Open Elysia issues show friction with non-TypeBox validators: response validation failing to
  serialise Dates from Zod and Effect
  ([#1670](https://github.com/elysiajs/elysia/issues/1670)), and ArkType breaking OpenAPI
  generation ([#1844](https://github.com/elysiajs/elysia/issues/1844)).

## 4. WebSocket run logs, and SSE

**Bun.serve.** `server.upgrade(req, { data, headers })` attaches per-connection `ws.data`.
`ws.subscribe(topic)`, `ws.publish()` and `server.publish()` give pub/sub, and Bun unsubscribes
closed sockets automatically. To type `ws.data`, add a `data` property to the `websocket`
handler object; "the older `Bun.serve<MyData>` generic pattern was removed". Idle sockets close
after 120 s by default, and `ws.send()` returns `-1` when it applies backpressure
([websockets](https://bun.com/docs/runtime/http/websockets)). The docs only show upgrades from
`fetch`. The type definitions, however, let a `routes` handler return `undefined | void` when a
`websocket` handler is configured (`RoutesWithUpgrade`), and route handlers receive `server` as
their second argument ([serve.d.ts](https://github.com/oven-sh/bun/blob/main/packages/bun-types/serve.d.ts)).
So upgrading inside a route is typed, but it is not shown in the prose docs.

**Hono.** `app.get('/ws', upgradeWebSocket((c) => ({ onOpen, onMessage, onClose })))`, and the
app is exported as `{ fetch: app.fetch, websocket }`
([WebSocket helper](https://hono.dev/docs/helpers/websocket)). The current docs import from
`@hono/bun`. In 4.13.14, `hono/bun`'s exports are marked "`@deprecated` `hono/bun` will be
removed in v5", and `createBunWebSocket` is deprecated in favour of importing `upgradeWebSocket`
and `websocket` directly ([source](https://github.com/honojs/hono/blob/v4.13.14/src/adapter/bun/websocket.ts)).
That source shows how the adapter works:

- It calls Bun's `server.upgrade()` and fills `ws.data` with its own `{ events, url, protocol }`.
  Per-request data such as the session therefore travels by closure from `c.get('session')`,
  not through `data`.
- `WSContext.raw` is Bun's `ServerWebSocket`, so `ws.raw.subscribe(topic)` is available. To
  publish from outside a socket (the runner emitting a log line), keep the `Server` that
  `Bun.serve` returns. Neither of these is documented on hono.dev; both come from the source.
- It throws "env has to include the 2nd argument of fetch" when it has no server. Upgrade tests
  therefore need a real server.

`@hono/bun` 1.0.1 (first published 2026-09-28) peers `hono >=4.13.9 || ^5.0.0-0`, and lives in
the Hono monorepo under `adapters/bun` (`npm view`). Adopting it on 4.13 now avoids the v5
import change.

**Elysia.** `.ws(path, { open, message, close, body, query, ... })`. It "uses uWebSocket which
Bun uses under the hood with the same API". `beforeHandle` runs "before upgrading the HTTP
connection to WebSocket", and messages can be schema-validated
([WebSocket](https://elysiajs.com/patterns/websocket.html)). The page does not document
pub/sub. It also does not say whether `derive`/`resolve` values reach `ws.data`; I could not
verify either. In 2.0, "WebSocket is now an opt-in feature", and handlers `yield` messages
instead of calling `ws.send` ([Elysia 2.0](https://elysiajs.com/blog/elysia-20.html)).

**SSE, if the transport changes.**

- **Bun.** An `async function*` passed to `new Response()` streams events. The default 10 s
  `idleTimeout` "closes the connection mid-response" if a stream goes quiet, and
  `server.timeout(req, 0)` disables that per request
  ([server](https://bun.com/docs/runtime/http/server)). This applies under every framework on
  Bun, so log streams need heartbeats or the per-request override.
- **Hono.** `streamSSE(c, async (stream) => stream.writeSSE({ data, event, id }))`. If the
  callback throws, "the `onError` event of Hono will not be triggered"; use the third-argument
  error handler ([streaming](https://hono.dev/docs/helpers/streaming)).
- **Elysia.** Generator handlers with `yield` and an `sse()` helper
  ([handler](https://elysiajs.com/essential/handler.html)).

## 5. Sessions: middleware, typed context, cookies, client IP

ADR-0007 needs one middleware that always resolves a Session from the cookie, the bootstrapped
account, or a trusted-proxy header. The proxy check needs the client IP.

| | Middleware | Typed context | Cookies | Client IP |
|---|---|---|---|---|
| `Bun.serve` | None; wrap each handler by hand | Whatever the wrapper passes | `req.cookies` (`CookieMap`) in `routes`; `cookies.set()` is applied to the response automatically | `server.requestIP(req)` |
| Hono | `app.use()`, `createMiddleware<Env>()` | `new Hono<{ Variables: { session: Session } }>()`; `c.set`/`c.var` | `getCookie`/`setCookie` from `hono/cookie` | `getConnInfo(c)` from `@hono/bun` |
| Elysia | lifecycle hooks, `derive`/`resolve` | inferred from what `derive` returns | `cookie.name.value`, `httpOnly` etc. as properties; signing built in | `server?.requestIP(request)` |

- **Bun.** Routes take `BunRequest`, which has `params` and `readonly cookies: CookieMap`
  ([routing](https://bun.com/docs/runtime/http/routing)). With `routes`, `Bun.serve()`
  "automatically tracks calls to request.cookies.set and applies them to the response"
  ([cookies](https://bun.com/docs/runtime/http/cookies)). The page does not document
  `sameSite` or the `CookieMap` constructor. `requestIP` "Returns `null` for closed requests or
  Unix domain sockets" ([server](https://bun.com/docs/runtime/http/server)). The routing page
  does not mention middleware.
- **Hono.** Pass a `Variables` generic for typed `c.get`. The docs warn against augmenting
  `ContextVariableMap` except for middleware that always runs
  ([context](https://hono.dev/docs/api/context)). Our session middleware always runs, so global
  augmentation would be safe. `req.cookie()` was replaced by `getCookie()` in `hono/cookie`
  ([MIGRATION.md](https://github.com/honojs/hono/blob/main/docs/MIGRATION.md)).
  `getConnInfo` returns `remote.address` and `addressType`
  ([conninfo](https://hono.dev/docs/helpers/conninfo)). It calls `server.requestIP` and throws
  without a server, so tests via `app.request()` must pass a stub server as `env`, or put the
  IP lookup behind a seam ([source](https://github.com/honojs/hono/blob/v4.13.14/src/adapter/bun/conninfo.ts)).
- **Elysia.** In 1.x, `derive` runs before validation and `resolve` after it
  ([life-cycle](https://elysiajs.com/essential/life-cycle.html)). In 2.0, `resolve` is removed
  and `derive` moves to `beforeHandle` ([Elysia 2.0](https://elysiajs.com/blog/elysia-20.html)).
  Session code written now would change. An open 2.0 regression reports that macro hooks no
  longer see `.derive()` values ([#1958](https://github.com/elysiajs/elysia/issues/1958)).
  Signed cookies and `t.Cookie` schemas are documented
  ([cookie](https://elysiajs.com/patterns/cookie.html)), but in TypeBox, not Zod.

## 6. Inbound webhook: any content type, body ignored

ADR-0018's `/api/hooks` accepts any content type, including Plex's `multipart/form-data`, and ignores the body.

- **Bun.serve.** The body is read only if the handler reads it.
- **Hono.** The body is read only by an explicit `c.req.json()` / `c.req.parseBody()` or by a
  validator, and the validator guide shows bodies left unparsed without a matching content type
  ([validation](https://hono.dev/docs/guides/validation)). Leave the validator off the hook
  route. That body parsing is lazy is my reading of the API, not a sentence in the docs.
- **Elysia.** Its default parsers cover JSON, text, multipart and urlencoded, chosen ahead of
  time from the route's schema. `parse: 'none'` skips them
  ([life-cycle](https://elysiajs.com/essential/life-cycle.html)). Set it on the hook routes.

None of the three forces parsing. 202/404/409 are plain responses in all of them.

## 7. Testing with `bun:test`

- **Hono.** `app.request(path | Request, init?, env?)` runs the app "without starting a server"
  ([testing guide](https://hono.dev/docs/guides/testing)). `testClient` gives typed calls
  ([testing helper](https://hono.dev/docs/helpers/testing)). The guide's examples use Vitest,
  but `app.request` is runtime-agnostic. WebSocket upgrade and `getConnInfo` need a real Bun
  server, so those tests bind `port: 0`.
- **Elysia.** `app.handle(new Request('http://localhost/...'))` (full URLs only), and
  `treaty(app)` takes the instance directly ([unit test](https://elysiajs.com/patterns/unit-test.html)).
  The docs do not cover WebSocket tests.
- **Bun.serve.** There is no documented in-process dispatcher. `port: 0` picks a free port
  ([server](https://bun.com/docs/runtime/http/server)), and `server.fetch(req)` is described as
  "Make a request to the running server", "for testing or internal routing". Whether it avoids
  the network is not stated. The practical pattern is to export the route handlers as plain
  functions and call them, but cookies applied automatically and `server` arguments then need
  fakes.

## 8. TypeScript ergonomics and tooling

- **Hono RPC** (`hc<AppType>`) infers inputs from validators and outputs from `c.json()`. It
  needs chained routes and `"strict": true` on both sides. The docs warn "the more routes you
  have, the slower your IDE will become", and the mitigation is compiling with `tsc` and using
  `hcWithType` ([RPC](https://hono.dev/docs/guides/rpc)). An open performance issue,
  [#2399](https://github.com/honojs/hono/issues/2399), reports "Type instantiation is
  excessively deep". RPC is optional; the Vue client can use plain `fetch` with Zod-inferred
  types from a shared package.
- **Elysia Eden** gives the same end-to-end typing through `treaty`. Type-depth issues exist but
  the ones found are closed ([#52](https://github.com/elysiajs/elysia/issues/52),
  [#353](https://github.com/elysiajs/elysia/issues/353)).
- **Biome** lints plain TypeScript in all three; none needs a framework plugin. I found no
  framework-specific Biome guidance in any of the three sets of docs.

## 9. Maintenance and bus factor

Counts from `gh api` on 2026-11-01. "Commits" means commits on the default branch since
2025-11-01; "releases" means GitHub releases in the same window.

| | Latest stable | Next | Releases (12 mo) | Commits (12 mo) | Top author share | Open issues + PRs | Stars |
|---|---|---|---|---|---|---|---|
| Bun ([oven-sh/bun](https://github.com/oven-sh/bun)) | 1.4.4 (2026-10-22) | — | 18 | (not counted) | Jarred-Sumner 8,696 all-time; company-backed (Oven) | 9,575 | 96k |
| Hono ([honojs/hono](https://github.com/honojs/hono)) | 4.13.14 (2026-10-25) | 5.0.0-rc.1 | 77 | 455 | yusukebe 207 (45%), usualoma 45 (10%) | 407 | 33k |
| Elysia ([elysiajs/elysia](https://github.com/elysiajs/elysia)) | 1.4.30 (2026-08-26 tag) | 2.0.0-rc.1 (npm, 2026-10-28) | 17 | 340 | SaltyAom 223 (66%); next is 25 | 412 | 19k |

- yusukebe's GitHub profile reads "Developer Advocate @cloudflare @voidzero-dev Creator of
  @honojs" ([profile](https://github.com/yusukebe)). That is employment, not a funding
  commitment to Hono; I found no primary source for formal backing.
- The Hono 5 checklist is [#5106](https://github.com/honojs/hono/issues/5106): ESM only, split
  adapters ([#4949](https://github.com/honojs/hono/issues/4949)), `c.req.query()` returning
  `Record<string, string | undefined>`, `c.req.json()` returning `unknown`, response validation,
  and removal of `routePath()`. Still open on 2026-11-01: a CLI release, a website renewal, and
  others. No release date is given.
- Elysia 2.0: "a complete rewrite… not a stable release yet", with a codemod
  ([blog](https://elysiajs.com/blog/elysia-20.html), tracking issue
  [#1873](https://github.com/elysiajs/elysia/issues/1873), open). Lifecycle hooks drop the
  `on` prefix, `resolve` and `.macro(name, …)` are removed, and errors move to RFC 9457.
- I could not verify any funding or sponsorship for Elysia from a primary source.

## 10. Lock-in and the cost of leaving

- **Bun.serve.** Bun-only types (`BunRequest`, `CookieMap`, `Server`), but the surface is
  small. Leaving means adopting a framework and porting a hand-written middleware layer.
- **Hono.** Handlers take a Web `Request` and return a `Response`, and the app is a `fetch`
  function. The Bun-specific parts are the `@hono/bun` imports (`upgradeWebSocket`,
  `websocket`, `getConnInfo`) and any `ws.raw` pub/sub. Another runtime means another adapter
  and replacing Bun topics with an in-process fan-out.
- **Elysia.** It is optimised for Bun, but 2.0 ships an adapter API with a Node adapter
  (srvx + crossws) ([blog](https://elysiajs.com/blog/elysia-20.html)). Lock-in is to the
  framework more than the runtime: lifecycle hooks, TypeBox `t` and the cookie proxy have no
  Web-standard equivalent, and its 1.x-to-2.0 rewrite shows how far its API moves between
  majors.

## 11. Bun.serve `routes` facts (for completeness)

- Route values can be a handler, a static `Response` (cached for the server's lifetime), a
  `{ dir }` directory, an HTML bundle, or a per-method object
  `Partial<Record<"GET"|"POST"|…, Handler | Response>>`
  ([serve.d.ts](https://github.com/oven-sh/bun/blob/main/packages/bun-types/serve.d.ts);
  [routing](https://bun.com/docs/runtime/http/routing)).
- `params` are inferred from the literal path (`BunRequest<"/orgs/:orgId">`) and
  percent-decoded. `/api/*` is a prefix wildcard and `/*` the catch-all. Precedence runs exact,
  then param, then wildcard, then catch-all. Unmatched requests go to `fetch(req, server)`.
- The routing page does not mention middleware, so auth, logging and error mapping are
  hand-written wrappers.
- HTML imports bundle a frontend on demand under `bun --hot`
  ([server](https://bun.com/docs/runtime/http/server)). This is irrelevant here: the web app is
  Vue + Vite. Hono and Elysia both run on `Bun.serve` underneath, so Bun's server
  characteristics (idle timeout, WebSocket backpressure) apply whichever framework is chosen.

## 12. Comparison

| Criterion | `Bun.serve` | Hono | Elysia |
|---|---|---|---|
| Zod v4 at boundaries | Hand-rolled | First-class (`zValidator`/`sValidator`) | Via Standard Schema; TypeBox is native |
| OpenAPI from Zod v4 | None | `@hono/zod-openapi` (zod-to-openapi) or `hono-openapi` | `mapJsonSchema: { zod: z.toJSONSchema }` |
| Native WebSocket + topics | Direct | Via `ws.raw`; session by closure | `.ws()`; pub/sub undocumented |
| Session middleware, typed | Hand-rolled | `Variables` generic | `derive` (changes in 2.0) |
| Client IP | `server.requestIP` | `getConnInfo` (needs server) | `server?.requestIP` |
| Webhook without parsing | Yes | Yes (no validator) | `parse: 'none'` |
| In-process tests | No documented way | `app.request()` | `app.handle()` |
| Bus factor | Company (Oven) | Lead 45%, second 10% | Lead 66% |
| API stability now | Stable | v5 RC, mostly mechanical | 2.0 RC, complete rewrite |
| Lock-in | Bun | Low (Web-standard) | Framework-specific |

## 13. Open risks

- **Hono 5 timing.** If v5 is still RC at build time, start on 4.13 with `@hono/bun`. Write
  against `string | undefined` query values and `unknown` JSON now, so the upgrade is a
  dependency bump.
- **Two JSON Schema generators.** If `@hono/zod-openapi` is adopted, its output comes from
  `@asteasolutions/zod-to-openapi`, while settings forms use `z.toJSONSchema`. Either keep
  OpenAPI out of scope for Phase 1, or check that `hono-openapi` (Standard Schema) can be
  pointed at `z.toJSONSchema` with `io: "input"`. Unverified.
- **WebSocket publish needs the `Server`.** The runner publishing log lines to a topic must
  reach the `Server` returned by `Bun.serve`. That is a seam for the server spec to name, not
  something Hono provides.
- **Idle timeouts.** Bun's 10 s HTTP idle timeout affects SSE, and the 120 s WebSocket idle
  timeout affects quiet runs. Either transport needs a heartbeat or explicit timeout settings.
- **Trusted-proxy IP in tests.** `getConnInfo` throws without a server, so tests either pass a
  stub server as `env` or the session middleware takes an injected IP resolver.
- **Not verified:** whether `server.fetch()` avoids the network; whether Elysia's `derive`
  values reach WebSocket handlers; whether Elysia exposes Bun's topic pub/sub; and any formal
  funding for Hono or Elysia.

## Sources

- Bun: [routing](https://bun.com/docs/runtime/http/routing),
  [server](https://bun.com/docs/runtime/http/server),
  [websockets](https://bun.com/docs/runtime/http/websockets),
  [cookies](https://bun.com/docs/runtime/http/cookies),
  [serve.d.ts](https://github.com/oven-sh/bun/blob/main/packages/bun-types/serve.d.ts),
  [releases](https://github.com/oven-sh/bun/releases)
- Hono: [validation](https://hono.dev/docs/guides/validation),
  [WebSocket](https://hono.dev/docs/helpers/websocket),
  [conninfo](https://hono.dev/docs/helpers/conninfo),
  [testing](https://hono.dev/docs/guides/testing),
  [testing helper](https://hono.dev/docs/helpers/testing),
  [RPC](https://hono.dev/docs/guides/rpc),
  [streaming](https://hono.dev/docs/helpers/streaming),
  [context](https://hono.dev/docs/api/context),
  [MIGRATION.md](https://github.com/honojs/hono/blob/main/docs/MIGRATION.md),
  [bun/websocket.ts @ v4.13.14](https://github.com/honojs/hono/blob/v4.13.14/src/adapter/bun/websocket.ts),
  [bun/conninfo.ts @ v4.13.14](https://github.com/honojs/hono/blob/v4.13.14/src/adapter/bun/conninfo.ts),
  [v5 features #5106](https://github.com/honojs/hono/issues/5106),
  [split adapters #4949](https://github.com/honojs/hono/issues/4949),
  [#2399](https://github.com/honojs/hono/issues/2399),
  [releases](https://github.com/honojs/hono/releases)
- Elysia: [validation](https://elysiajs.com/essential/validation.html),
  [life-cycle](https://elysiajs.com/essential/life-cycle.html),
  [handler](https://elysiajs.com/essential/handler.html),
  [WebSocket](https://elysiajs.com/patterns/websocket.html),
  [cookie](https://elysiajs.com/patterns/cookie.html),
  [OpenAPI pattern](https://elysiajs.com/patterns/openapi.html),
  [unit test](https://elysiajs.com/patterns/unit-test.html),
  [1.4 post](https://elysiajs.com/blog/elysia-14.html),
  [2.0 post](https://elysiajs.com/blog/elysia-20.html),
  issues [#1873](https://github.com/elysiajs/elysia/issues/1873),
  [#1958](https://github.com/elysiajs/elysia/issues/1958),
  [#1961](https://github.com/elysiajs/elysia/issues/1961),
  [#1670](https://github.com/elysiajs/elysia/issues/1670),
  [#1844](https://github.com/elysiajs/elysia/issues/1844)
- npm registry (`npm view`, 2026-11-01): `hono`, `@hono/bun`, `@hono/zod-validator`,
  `@hono/standard-validator`, `@hono/zod-openapi`, `hono-openapi`,
  `@asteasolutions/zod-to-openapi`, `elysia`, `@elysiajs/openapi`, `@elysiajs/eden`
- GitHub API (`gh api`, 2026-11-01): repo metadata, `/contributors`, `/commits?since=2025-11-01`,
  `/releases`, and users `yusukebe` and `SaltyAom`
