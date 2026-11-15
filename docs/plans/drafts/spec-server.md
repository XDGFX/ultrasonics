# Spec: the server, its HTTP API, the run stream, the scheduler and the webhook

Part of [Phase 1 specs](https://github.com/XDGFX/ultrasonics/issues/100), spec 4 of 8. Builds on [Spec: the plugin SDK and AuthProvider types](https://github.com/XDGFX/ultrasonics/issues/108), [Spec: the database, its stores and the initial migration](https://github.com/XDGFX/ultrasonics/issues/109) and [Spec: the runner, run queue and run events](https://github.com/XDGFX/ultrasonics/issues/110). Settles open questions 1, 3, 4 and 5 of [Spec: the Vue UI and the settings-form renderer](https://github.com/XDGFX/ultrasonics/issues/118), whose [#126](https://github.com/XDGFX/ultrasonics/issues/126) consumes these routes. Spec 5, the Spotify input, adds the `oauth2-pkce` half of the provider this spec starts.

Cal grilled this spec on 16 November 2026 and accepted every recommendation. The answers are under "Decisions from the grilling" in Implementation Decisions. Points marked **⚑ checkpoint** touch the auth layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md); each was settled in that grilling.

## Problem Statement

Every Phase 1 package exists except the one that joins them. The database opens and scopes rows, the runner runs a chain and emits run events, the registry lists plugins, and the UI talks to an in-memory fake. Nothing boots, nothing listens on a port, nothing resolves a session, nothing serves the UI, and nothing starts a run on a schedule or a webhook.

The exit gate needs all of it: "self-host first run reaches a working applet without a login prompt", and "a real Spotify playlist syncs to Plex through the UI".

v1's server shows what to avoid. Flask held all state in module globals. The time trigger blocked in `time.sleep` and the webhook trigger blocked in its own Flask server, broken since Werkzeug 2.1.0 (ADR-0011, Notes). Triggers combined with AND, which v1's own comment called a bug. Errors reached only the server log (v1 #9, #20). Spotify auth ran through a proxy that died in November 2022.

## Solution

A new package, `packages/server` (`@ultrasonics/server`), on Hono over `Bun.serve` (ADR-0024). It:

- **boots** in ADR-0015 §3's order: check configuration, open the database (backup, migrate, make sure the account exists), mark leftover `running` runs `interrupted`, load the plugin catalogue, start the scheduler, listen;
- resolves a **`Session`** on every request through one middleware, from the source `AUTH_SOURCE` names (ADR-0007 §3, ADR-0015 §2);
- serves the **HTTP API** that the UI's `ApiClient` already expects, with Zod at the boundary and the API's request and response schemas exported for the UI;
- builds the **local `AuthProvider`**, bound to the session's account, and implements its `token` flow. The Spotify spec adds `oauth2-pkce`;
- runs applets through the core **run queue** and `runApplet`. A **run hub** keeps each live run's journal, writes it to the `runs` row, and fans it out as one **SSE stream per run** (ADR-0026);
- runs a **scheduler** loop on a 60-second tick, and serves the **inbound webhook** (ADR-0018);
- serves the **built UI** from the same origin.

The UI's fake stays for tests and the dev server. #126 swaps in an HTTP client against these routes.

## User Stories

**Self-host first run**

1. As a self-hoster, I want the app to refuse to start until I've set `ENCRYPTION_KEY` and `AUTH_SOURCE`, with a message explaining each choice, so that I choose my security properties deliberately (ADR-0015 §1).
2. As a self-hoster with no `ENCRYPTION_KEY`, I want the refusal to print a freshly generated key ready to paste, so that the secure path is also the fast path (ADR-0009 §6).
3. As a self-hoster, I want an example compose file with every required line filled in, so that a copy-paste install has no extra steps (ADR-0015 §1).
4. As a self-hoster with `AUTH_SOURCE=bootstrapped`, I want to open the UI and land on first run with nothing to log in to (ADR-0015 §3; exit gate).
5. As a self-hoster, I want my install's one account created at boot whatever the source, so that switching source never makes a second one (ADR-0015 §3).
6. As a self-hoster in `bootstrapped` mode, I want a warning in the log and a banner in the UI when a request comes from a public address, so that an accidental exposure is visible without locking me out (ADR-0015 §6).
7. As a self-hoster upgrading, I want migrations to run at boot after a file copy, so that `docker compose pull && up -d` is the whole upgrade (ADR-0009 §7).

**Trusted proxy**

8. As a self-hoster behind Authelia, I want `AUTH_SOURCE=proxy` to refuse to start without `TRUSTED_PROXIES`, so that I can't run an open proxy mode by accident (ADR-0015 §4).
9. As a self-hoster behind a proxy, I want a request from a trusted address carrying the identity header to reach my account, so that my proxy's login is the only login (ADR-0015 §4–5).
10. As a self-hoster behind a proxy, I want a request with no header, or from any other address, refused with 401 and never let through as `bootstrapped`, so that a misconfigured proxy fails closed (ADR-0015 §4).
11. As a self-hoster, I want the header value logged for audit and never stored as an identity (ADR-0015 §5).
12. As a self-hoster, I want `X-Forwarded-Proto` and `X-Forwarded-Host` honoured only from trusted proxies (ADR-0015 §4).

**The API the UI already uses**

13. As the UI, I want every operation `ApiClient` declares served by a route, with the same shapes, so that swapping the fake for HTTP changes no screen.
14. As the UI, I want the plugin catalogue: each official plugin's name, description, version, components, modes, service, and form JSON Schema for persistent and per-component instance settings, so that the builder and settings render without importing plugin code (ADR-0019 §1).
15. As a user, I want to list, read, create, update and delete applets, with each slot's settings checked against its plugin's schema and issues returned at `[component, index, "settings", …]`, so that I fix them on the node they belong to (ADR-0019 §5).
16. As a user, I want each applet in the list to carry its live state (`idle`, `running`, `queued`), its last run and its next run time, and the list to refresh itself while anything is running or queued, so that the list shows what is happening (ADR-0025 §3).
17. As a user, I want a slot whose stored settings no longer parse still returned raw, so that the form opens with its issues (ADR-0019 §7).
18. As a user, I want to save my plugins' persistent settings, validated by the server alone, with issues by path (ADR-0019 §5).
19. As a user, I want deleting an applet to delete its runs (ADR-0009 §5).
20. As a user, I want every error a route returns to say what went wrong in a message I can show, so that failures never surface only in the server log (v1 #9, #20).

**Service auth**

21. As a user, I want to see each service the official plugins use, whether it's connected or needs reconnecting, and which plugins use it.
22. As a user connecting a `token` service such as Plex, I want my fields validated, then tested against the service, then saved only if the test passed, so that a wrong token is caught before a run (#118 story 52–53).
23. As a self-hoster, I want my Spotify client ID entered in the UI and stored as an operator setting, so that I never edit an environment variable for it (ADR-0015, "Out of this decision"; ADR-0013 §7).
24. As a user connecting an `oauth2*` service, I want Connect to send me to the service and the wizard to complete the grant when I return (ADR-0013 §4).
25. As a user, I want my grants encrypted at rest and never sent back to the browser.
**Runs**

26. As a user, I want "run now" to answer with a run id when the run starts, or `queued` when the applet is already running (ADR-0026 §5).
27. As a user, I want to watch a run live, and to open a finished run and see the same events (ADR-0026 §4).
28. As a user whose connection drops mid-run, I want the stream to resume from the last event I saw, so that nothing is lost or duplicated (ADR-0026 §3).
29. As a user, I want a run cut short by a restart to show as `interrupted`, with everything it had logged before the last write (ADR-0018 §4, ADR-0026 §4).
30. As a user behind nginx, I want the run stream not to buffer (ADR-0026 §1).
31. As a user, I want a run's log, stages and results kept with the run, and each applet's last 100 runs kept (ADR-0009 §5).

**Triggers**

32. As a user, I want to set an applet's schedule as every N hours, days or weeks from an anchor in my time zone, and have it run on that grid across clock changes (ADR-0018 §1).
33. As a user, I want a run missed while the server was down to run once when it comes back (ADR-0018 §4).
34. As a user, I want re-enabling an applet, or editing its schedule, not to fire a catch-up run (ADR-0018 §4).
35. As a user, I want any trigger to run the applet, and a firing during a run to queue at most one more (ADR-0011 §3–4).
36. As a user, I want different applets to run at the same time (ADR-0011 §5).
37. As a user, I want a webhook token generated, shown once with its URL, regenerated or removed, and stored only as a hash (ADR-0018 §5).
38. As Home Assistant, Node-RED or a plain `curl`, I want `GET` or `POST /api/hooks/<token>`, or `POST /api/hooks` with a bearer token, to start the applet, whatever body I send (ADR-0018 §5).
39. As an automation, I want `202` with `started` or `queued`, `404` for an unknown or revoked token, and `409` for a disabled applet (ADR-0018 §5).
40. As a run, I want to record the trigger that first made me due (ADR-0018 §6).

**Developers and agents**

41. As an agent, I want every route testable in-process with `app.request()`, without a port (ADR-0024).
42. As a future maintainer, I want route handlers to read the session from Hono's context and never branch on deployment mode (ADR-0007 §3).
43. As a future maintainer, I want the auth store and the system module imported only in the files lint names (ADR-0009 §4, ADR-0028).
44. As #126, I want the API's Zod schemas importable without pulling in the server, so that the UI parses responses with the server's own schemas.

**Cross-site requests**

45. As a self-hoster in `bootstrapped` mode, I want a page on another site I visit to be unable to change my install through my browser, even though my install has no login.
46. As a self-hoster, I want a run now on a disabled applet to work, so that I can test an applet before turning its triggers on (ADR-0017 §3).

## Implementation Decisions

### Package and dependencies

- `@ultrasonics/server`, private, depends on `@ultrasonics/db`, `@ultrasonics/core`, `@ultrasonics/registry`, `@ultrasonics/plugin-sdk`, Hono and a Hono Zod validator (ADR-0024). Hono 5 if stable when the ticket is claimed, else 4.13 with `@hono/bun` (ADR-0024).
- Its `exports`: the app entry (for the CLI runner later) and an **`./api` subpath** holding only the API's Zod schemas (grilling decision 4).
- Files the lint rules already name: `src/boot.ts` (auth store and system module), `src/session-middleware.ts` (auth store), `src/scheduler.ts` and `src/webhook-route.ts` (system module). The rule from #109 already exists in `biome.json`. This spec creates the files and adds one, `src/operator-settings.ts`, to the auth-store allowlist (grilling decision 5).

### Configuration and boot (ADR-0015, ADR-0009 §6–7)

Read from the environment and parsed with Zod before anything else happens. A security setting has no silent default (ADR-0015 §1):

| Setting | Required | Notes |
|---|---|---|
| `ENCRYPTION_KEY` | yes | 64 hex characters or `auto`. Resolved by db's `resolveEncryptionKey`; an unset or malformed value prints the fresh key from `EncryptionKeyError` and exits (ADR-0009 §6). |
| `AUTH_SOURCE` | yes | `bootstrapped`, `proxy` or `oauth` (ADR-0015 §2). Boot refuses `oauth` in Phase 1 (grilling decision 5). |
| `TRUSTED_PROXIES` | when `proxy` | Comma-separated CIDRs. Boot refuses `proxy` without it (ADR-0015 §4). Also governs `X-Forwarded-*` in every mode. |
| `PROXY_USER_HEADER` | no | Default `Remote-User` (ADR-0015 §4). Not a security property: the address list is. |
| `DATA_DIR` | no | Default `/config` in the image, `./data` outside it. Holds `ultrasonics.db`, its `.pre-` copies, the `auto` key file and plugin config dirs. |
| `PORT` | no | Default `5000`. |

Unset required settings each get their own explanation, and boot exits non-zero after printing all of them, so a first run needs one restart, not three.

Boot order, from ADR-0015 §3 and ADR-0018 §4:

1. Parse configuration (above).
2. `openDatabase(path, key)`: backup, migrate, make sure the account exists (#109). A failure exits loudly.
3. `system.interruptRunning()`, logging the count.
4. Load every registry entry through `load()`, and convert each settings and auth `fields` schema with `toFormSchema` once. A schema outside the renderable subset aborts boot with its path: conformance should have caught it, so it's a build bug.
5. Start the scheduler. Its first tick runs immediately, which is how a run missed during downtime fires once (ADR-0018 §4).
6. `Bun.serve` the Hono app.

The v1 importer slots in between steps 3 and 5 in Phase 2 (ADR-0017 §1). Nothing here forecloses it.

### The session middleware (ADR-0007 §3, ADR-0008 §4, ADR-0015) ⚑ checkpoint: auth layer

- One middleware on every `/api` route except `/api/hooks`, which is authenticated by its token alone (ADR-0018 §5). It always sets a `Session` (`{ accountId }`) on a typed Hono context variable (ADR-0024). Handlers read it from there and nowhere else.
- The client IP lookup is a parameter, so the trusted-proxy tests run in-process (ADR-0024, Consequences). Production passes Hono's `getConnInfo`.
- **`bootstrapped`:** builds the session per request from `authStore.installAccount()`, with no cookie and no `sessions` row (ADR-0015 §3). The account id is read once at boot and held.
- **`proxy`:** a request from an address inside `TRUSTED_PROXIES` with a non-empty header resolves to the install's account; the value is logged and never stored (ADR-0015 §5). A missing or empty header, or any other address, is `401` with no fallback (ADR-0015 §4).
- **`oauth`:** never reached in Phase 1, because boot refuses it (grilling decision 5).
- **Exposure check (ADR-0015 §6):** in `bootstrapped` mode, a request whose source address isn't private logs a warning (once per address per boot, so the log isn't flooded) and sets the `exposed` flag `GET /api/instance` returns. Private here means loopback, RFC 1918, link-local, IPv6 ULA (`fc00::/7`) and `100.64.0.0/10`. ADR-0015 §6 names Tailscale's range as a false positive to avoid. It is a warning, never a block.
- **Cross-site requests** ([ADR-0030](https://github.com/XDGFX/ultrasonics/blob/revival/docs/adr/0030-cross-site-requests-need-a-json-content-type.md), Proposed): every mutating `/api` route except `/api/hooks` answers `415` unless the request has `Content-Type: application/json`, and the server sends no CORS headers. A cross-origin JSON request then needs a preflight that never succeeds; the UI's same-origin requests are unaffected. DNS rebinding stays an accepted risk in `bootstrapped` mode (grilling decision 7).

### The API

All routes are under `/api`, return JSON, and validate params, query and body with Zod through Hono's validator (ADR-0024). Every route reaches data only through `storeFor(session.accountId)` (ADR-0009 §4). A row of another account is a `404`, the same as a missing row (#109).

Responses follow the UI's existing types in `packages/web/src/api-client.ts`. Where those types differ from the server's data, the server maps; it never leaks a db column the UI doesn't name (`accountId`, `webhookTokenHash`, timestamps the UI doesn't use).

| `ApiClient` operation | Route | Notes |
|---|---|---|
| `instance()` | `GET /api/instance` | `{ exposed }`, computed from this request's address. |
| `plugins()` | `GET /api/plugins` | The catalogue built at boot (step 4). `service` is the plugin's `auth.service`, if any. |
| `applets.list()` | `GET /api/applets` | `AppletListing[]`: each applet with `state` from the run queue at request time, `lastRun` from `store.runs.listForApplet(id)[0]`, `nextRunAt` from the row. |
| `applets.get(id)` | `GET /api/applets/:id` | `Applet`: `hasWebhook` is `webhookTokenHash !== null`; the hash is never returned. |
| `applets.create(draft)` | `POST /api/applets` | `201` with the applet, or `422` with `{ issues }`. |
| `applets.update(id, draft)` | `PUT /api/applets/:id` | As create. Turning `enabled` on moves `next_run_at` to the next future slot (ADR-0018 §4). |
| `applets.delete(id)` | `DELETE /api/applets/:id` | `204`. Runs go with it (cascade, ADR-0009 §5). |
| `applets.runNow(id)` | `POST /api/applets/:id/run` | `202` with `{ kind: "started", runId }` or `{ kind: "queued" }` (ADR-0026 §5). Trigger `manual`. Allowed on a disabled applet (grilling decision 10). |
| `triggers.setSchedule(id, s)` | `PUT /api/applets/:id/schedule` | Body is a `Schedule` or `null`. Writes the schedule and `next_run_at` together through `store.applets.setSchedule` (#109). `422` with issues on a bad schedule. |
| `triggers.generateWebhook(id)` | `POST /api/applets/:id/webhook` | Generates a token, stores its hash, returns `{ url }` once. Replaces any previous token at once (ADR-0018 §5). The URL's origin comes from the request (grilling decision 11). |
| `triggers.removeWebhook(id)` | `DELETE /api/applets/:id/webhook` | `204`. |
| `runs.get(id)` | `GET /api/runs/:id` | `RunSummary`. |
| `runs.events(id)` | `GET /api/runs/:id/events` | SSE, below. |
| `settings.get(plugin)` | `GET /api/settings/:plugin` | `{ value, issues }`: the stored value raw, and what it fails today (ADR-0019 §7). |
| `settings.save(plugin, v)` | `PUT /api/settings/:plugin` | Parsed with the plugin's `persistentSettings`; stored raw on success; `422` with issues otherwise (ADR-0019 §5). |
| `services.list()` | `GET /api/services` | `ServiceStatus[]` from the provider's `status()` (grilling decision 6). |
| `services.requirements(s)` | `GET /api/services/:service/requirements` | `provider.requirements(spec)`. |
| `services.redirectUri(s)` | `GET /api/services/:service/redirect-uri` | Asks the concrete provider, which chooses the URI (grilling decision 2). The wizard sends its own origin, which a BYO provider may use. |
| `services.clientForm(s)` | `GET /api/services/:service/client-form` | The provider's fixed client form for the service's flow. For `oauth2-pkce` it is `{ clientId }` (spec 5). |
| `services.registerClient(s, v)` | `PUT /api/services/:service/client` | Writes operator `instance_settings` through `operator-settings.ts` (grilling decision 5). |
| `services.configure(s, v)` | `POST /api/services/:service/configure` | `token` flows. Parse, test with the candidate credentials, store only on a pass (grilling decision 3). |
| `services.begin(s)` | `POST /api/services/:service/begin` | `oauth2*`: `provider.begin(spec)` → `AuthChallenge`. |
| `services.outcome(s, q)` | `POST /api/services/:service/complete` | `oauth2*`: `provider.complete(spec, query)` → `ConnectOutcome`. The OAuth return lands on the SPA's wizard route, which posts its query here (grilling decision 2). |

- **Which spec a service route uses.** A route names a service, not a plugin. The server takes the `AuthSpec` from the first registry plugin declaring that service. Two plugins declaring one service with different specs would disagree on scopes or fields; boot refuses that, since one grant serves both (ADR-0013 §2).
- **Applet validation.** The server checks the name (non-empty), that every slot's plugin is in the registry and implements that slot's component, and parses each slot's settings with that component's `instanceSettings`. Issues use the paths the fake already returns: `["name"]`, `[component, index]`, and `[component, index, "settings", …]` (`fake-api.ts`, `checkDraft`). The store then validates the chain's shape again (#109). Settings are stored raw.
- **Error shape.** `4xx` and `5xx` bodies are `{ message }`, or `{ issues }` for `422`. An unexpected error is logged with its stack and returned as `500` with a generic message, never a stack.
- **The UI.** The server serves `packages/web`'s built `dist` from `/`, with an SPA fallback to `index.html` for any non-`/api` path. Paths are relative, so a URL subpath stays addable later (ADR-0015, "Out of this decision"). In development, Vite proxies `/api` to the server.
- **Mismatches with the UI** (none needs a screen change):
  - The fake's webhook URL is `/hooks/<applet>/<token>`; ADR-0018 §5 fixes `/api/hooks/<token>`. The server follows the ADR, and **ticket 1 corrects the fake** to match.
  - The fake's redirect URI is `http://localhost:5173/services/<service>`. Spotify no longer accepts `localhost` at all; spec 5 sets what the provider returns, and #126 meets it.
  - `ServiceStatus.status` `failed` comes from the provider's `status()` (grilling decision 6). The fake keeps seeding it.
  - The UI's `RunSummary` and `Applet` are web-local types. #126 replaces them with `z.infer` of `@ultrasonics/server/api` (grilling decision 4).

### The local `AuthProvider` ⚑ checkpoint: auth layer

- The server builds one provider per request, bound to `session.accountId` (ADR-0007 §4), and passes it to core as an `AuthProvider` (#108's interface). Core never sees anything beyond that interface.
- **A mismatch with the SDK:** `requirements(spec)` is synchronous (`auth.ts`), but the operator's client ID comes from `instance_settings`, and every store method is `async`. The factory is therefore `async` and reads what `requirements` needs before returning the provider. No SDK change.
- **The server's concrete provider has more than the interface:** `redirectUri`, `clientForm`, `registerClient` and `status`. They live on `LocalAuthProvider` in `packages/server/src/auth/`. The routes call them on the concrete type; core never sees them, and the SDK's `AuthProvider` keeps ADR-0013 §4's five methods (grilling decision 6).
- **`status(service)` makes no network calls:** no grant → `not-connected`; an `oauth2*` service with no client registered → `failed` with `misconfigured`; a grant the provider has marked failed → `failed` with `reconnect`; otherwise `connected`. Spec 5 defines how an `oauth2-pkce` grant is marked failed.
- **This spec implements:** the `token` flow (`requirements` → one `fields` requirement drawn from the declared fields, or `[]` when there are none; `configure` → validate and `store.credentials.put`, called by the route only after `test()` passes; `resolve` → `store.credentials.get`, rejecting with `AuthFailure` `not-connected` when absent); and `none` (`[]`, resolves to `{}`). The Spotify spec adds `oauth2-pkce` (`client` and `connect` requirements, `begin`, `complete`, refresh inside `resolve`).
- A decryption failure (`CredentialKeyMismatchError`) is not an `AuthFailure`: it fails the run and the route loudly, naming the key, because a lost key is the operator's problem, not a reconnect (#109).

### Runs: the queue, the hub and the stream (ADR-0011, ADR-0026)

- **One run queue** (`createRunQueue()` from core) for the whole server. The route, the scheduler and the webhook all call `submit(appletId, trigger, start)`, so one rule governs all three (#110).
- **`start(trigger)`** loads the applet through the account's store. A missing applet ends quietly; it was deleted while queued. It creates the run row with `store.runs.start(appletId, trigger)` (ADR-0026 §5: "A run's row is created when it starts"), opens a journal in the hub, and calls `runApplet` with that id, the registry, the account's provider, persistent settings from `store.pluginSettings`, `configDir` as `<DATA_DIR>/accounts/<accountId>/plugins/<plugin>` (grilling decision 9), and the hub's sink. It finishes the row with `store.runs.finish(id, status, journal)`, which also prunes to 100 (#109).
- **Run now answers with the id** of the run it started. Because `submit` calls `start` synchronously when the applet is idle, the route awaits the row's creation inside `start` before replying. A queued submit answers `queued` with no id (ADR-0026 §5).
- **The hub** holds each live run's events in memory. It writes the journal (`toJournal`, which applies the log cap) to the row at each `stage` finish, at most every five seconds, and at `end`, then drops the run (ADR-0026 §4). ADR-0024's note that publishing outside a request needs the `Server` object no longer applies: SSE subscribers read from the hub, not from Bun's topic pub/sub (ADR-0026, Considered options).
- **`GET /api/runs/:id/events`** (Hono `streamSSE`, ADR-0026 §1):
  - Looks the run up through the scoped store first: `404` outside the account.
  - Live run: replays from `Last-Event-ID + 1`, or from the first event, then follows the hub. Each event's `seq` is its SSE `id` (ADR-0026 §2).
  - Finished run: replays `fromJournal(row)` from the same point, then closes (ADR-0026 §4).
  - **Interrupted run:** its journal has no `end`, because the run never wrote one. The server appends `end` with status `interrupted` (`seq` one past the last) so the UI's single code path terminates.
  - A heartbeat comment line every 15 seconds, below Bun's default idle timeout. `X-Accel-Buffering: no` on the response (ADR-0026 §1).
- **`state`** in the applet list is the queue's `state(appletId)` at request time. The UI re-fetches the list every five seconds while any row is `running` or `queued` (grilling decision 1).
- A finished run's `runs.get` returns the row's status. A run still `running` in the row but absent from the hub can't exist after boot step 3.

### The scheduler (ADR-0018 §1–4, ADR-0028)

- **`nextSlot(schedule, after)`**: a pure function from a schedule and an instant to the first slot on the anchor's grid strictly after it. `day` and `week` step in calendar units in the schedule's zone; `hour` steps 3,600 seconds. A spring-forward gap runs at the next valid instant; a fall-back repeat runs once, at its first occurrence (ADR-0018 §1). It uses `Intl` (no date library) unless a ticket finds the arithmetic needs one; `Temporal` if Bun has shipped it unflagged by then.
- **Setting a schedule, or turning `enabled` on,** writes `next_run_at = nextSlot(schedule, now)` (ADR-0018 §4: "`next_run_at` jumps to the next future slot"). Clearing a schedule writes `null`. Turning `enabled` off leaves `next_run_at` alone; `dueApplets` already skips disabled applets.
- **One loop** in `scheduler.ts`, every 60 seconds, with the first tick at boot (ADR-0018 §3):
  1. `system.dueApplets(now)` → `{ accountId, appletId }[]`.
  2. For each: advance `next_run_at` to `nextSlot(schedule, now)` through `storeFor(accountId)` **at dispatch** (ADR-0018 §3), then `queue.submit(appletId, "schedule", start)`. Advancing from `now`, not from the old slot, collapses any backlog into one run (ADR-0018 §4).
  3. `system.sweepExpiredSessions(now)` (ADR-0009 §5). It deletes nothing in Phase 1; it costs one query.
- A tick that throws logs the error and the loop carries on. Ticks never overlap: the next is scheduled after the previous finishes.
- No automatic retries (ADR-0018 §4).

### The inbound webhook (ADR-0018 §5) ⚑ checkpoint: security

- `webhook-route.ts` mounts `GET` and `POST /api/hooks/:token`, and `POST /api/hooks` with `Authorization: Bearer <token>`, outside the session middleware. Any content type; the body is never read (ADR-0018 §5: "Plex sends `multipart/form-data`").
- A token is 32 random bytes, base64url. Its hash is SHA-256, hex, stored in `applets.webhook_token_hash` (unique, #109). A token is compared only by looking up its hash, so there is no timing-sensitive string comparison.
- `system.appletForWebhookToken(hash)`: none → `404`; disabled → `409` with `{ message }`; otherwise `queue.submit(appletId, "webhook", start)` → `202` with `{ status: "started" | "queued" }`. Unknown and revoked tokens get identical `404`s (ADR-0018 §5).
- No rate limiting in Phase 1 (ADR-0018 §5).

### Deployment files

- A single-arch `Dockerfile` on a Bun base image, and an example `compose.yaml` with `ENCRYPTION_KEY` and `AUTH_SOURCE` filled in and commented (ADR-0015, Consequences: "The example compose file is part of the self-host onboarding work in Phase 1"). Ticket 1 ships both; Phase 4 adds multi-arch builds and publishing (grilling decision 12).

### Decisions from the grilling (Cal, 16 November 2026)

The draft carried each of these as an open question with a recommendation. Cal accepted all twelve. ⚑ marks a checkpoint.

1. **Live status on the applet list** (#118 open question 1). `GET /api/applets` returns each applet's `state` from the run queue. The list re-fetches every five seconds while any row is `running` or `queued`, and stops when none is. There is no new route and no new contract. This meets ADR-0025 §3 ("Each row also shows live status while a run is in progress") without the per-account stream ADR-0026 rejected for Phase 1. Rejected: opening each running applet's run stream, which spends one HTTP/1.1 connection per applet against the six-per-origin limit ADR-0026 names; and state as of page load, which contradicts ADR-0025 §3.
2. **The redirect URI, and where the OAuth return lands** (#118 open question 3). ⚑ auth layer. `GET /api/services/:service/redirect-uri` asks the concrete provider. The OAuth return lands on the SPA's wizard route, `/services/:service`, which posts the query to `/api/services/:service/complete`. The session middleware covers that call like any other, and there is no server-rendered callback page. ADR-0013 §8 ("The redirect URI in `begin()` is provider-supplied, not derived from the local instance URL") is read as "the provider chooses, not the server or the UI". A BYO provider may therefore derive the URI from the wizard's origin, which the route passes it. Rejected: a server callback route that completes and redirects to the wizard. It needs a non-API route outside the SPA and a way to carry the outcome back.
3. **Test and save** (#118 open question 4). The route parses the input with the declared fields, answering `invalid` with issues. It then calls `test()` on the first registry plugin that declares the service and defines one, through `createTestContext`, with a host port that returns the *candidate* credentials and the account's stored persistent settings. `{ ok: false }` gives `test-failed` with its message, and nothing is stored. `{ ok: true }`, or no plugin with a `test()`, goes on to `provider.configure()` and `saved`. A `test()` that throws is a `500` naming the plugin (ADR-0012 §5: "the plugin itself is broken"). Rejected: storing before testing, which leaves a bad grant in place; and `configure()` alone, which never reaches the wizard's `test-failed` branch (#118 stories 52–53).
4. **Where the API's schemas live** (#118 open question 5). A subpath export, `@ultrasonics/server/api`, holds only the Zod schemas for every request and response. Lint restricts its imports to Zod, the SDK, `@ultrasonics/db`'s schema exports and `@ultrasonics/core/run-events`, the way `@ultrasonics/core/run-events` is restricted. Response schemas are written for the API, not re-exported db rows, so `accountId` and `webhookTokenHash` can't leak. `packages/web` may import that subpath and nothing else of the server. #126 turns `api-client.ts`'s types into `z.infer` of it. Rejected: a separate `@ultrasonics/api` package, which earns its keep only if the CLI runner needs the schemas without the server.
5. **Operator settings, and `AUTH_SOURCE=oauth` in Phase 1.** ⚑ multi-tenancy, auth layer and the DB boundary.
   - (a) Boot refuses `AUTH_SOURCE=oauth` with "hosted login arrives with the hosted tier". `oauth` stays a valid value in the schema, so ADR-0015 §2 holds, and a test pins the refusal. Every Phase 1 install's one account is then its operator, which is what lets `PUT /api/services/:service/client` write the operator-owned `instance_settings` (ADR-0009 §5, ADR-0013 §7). **Phase 5 must lock down the client route before it lifts the refusal.** Under `oauth`, any hosted account could otherwise replace the operator's Spotify app for everyone.
   - (b) `src/operator-settings.ts` joins the auth-store allowlist in `biome.json`. It holds the reads and writes of the operator's client credentials and nothing else. The client route and the provider factory call it. The import stays visible in review, which is the rule's purpose (ADR-0009 §4).
   - Rejected: an `operator` flag on `Session` now, a session-shape change with nothing to exercise it until Phase 5; moving `instanceSettings` to its own db subpath, a db API change; and having boot pre-read it into a closure, which satisfies the lint rule's letter and dodges its intent.
6. **The concrete provider's extra methods.** ⚑ auth layer. `redirectUri`, `clientForm`, `registerClient` and `status` go on the server's `LocalAuthProvider` in `packages/server/src/auth/`. The SDK's `AuthProvider` is unchanged: core never calls these, and ADR-0013 §4 froze five methods. `status()` makes no network calls. The class moves to a package when the CLI runner needs it. Rejected: widening the SDK's `AuthProvider`, an ADR-level change for methods core never calls; and having `status` call `resolve()`, which refreshes a token on every settings page load.
7. **Cross-site requests.** ⚑ security. Every mutating `/api` route except `/api/hooks` requires `Content-Type: application/json`, and the server sends no CORS headers. DNS rebinding is an accepted risk in `bootstrapped` mode. Recorded in [ADR-0030](https://github.com/XDGFX/ultrasonics/blob/revival/docs/adr/0030-cross-site-requests-need-a-json-content-type.md) (Proposed). Rejected: a CSRF token, which needs somewhere to live when there's no cookie; and a `Host` allowlist, one more required setting that breaks access by IP.
8. **The run stream's path** is `/api/runs/:id/events`. ADR-0026 §1's `GET /runs/:id/events` is read as relative to the API root, as ADR-0018 §5's `/api/hooks` is.
9. **`configDir` per account.** ⚑ multi-tenancy. `<DATA_DIR>/accounts/<accountId>/plugins/<plugin>`, created on first use. Core still sees only a string (ADR-0010 #8). Rejected: a shared `<DATA_DIR>/plugins/<plugin>`, harmless for self-host and a cross-account leak the day hosting starts. No Phase 1 plugin writes there.
10. **Run now on a disabled applet** is allowed. Disabled means the applet's triggers don't fire, which is how #118 story 26 reads it ("won't run on its schedule"). An imported applet arrives disabled (ADR-0017 §3), and its first test run is manual. The webhook still answers `409` for a disabled applet (ADR-0018 §5).
11. **The webhook URL's origin** comes from the request: `Host`, plus `X-Forwarded-Proto` and `X-Forwarded-Host` from trusted proxies only (ADR-0015 §4). There is no `PUBLIC_URL` setting yet. The hosted tier will need one and can add it then.
12. **The Dockerfile.** Ticket 1 ships a single-arch `Dockerfile` and an example `compose.yaml`. Phase 4 adds multi-arch builds and publishing (roadmap).

One more answer from the grilling: the fake API's webhook path, `/hooks/<applet>/<token>`, is wrong. ADR-0018 §5's `/api/hooks/<token>` wins, and ticket 1 corrects the fake.

## Testing Decisions

- A good test drives the server through HTTP, in-process with `app.request()` (ADR-0024), against a real database opened in a temporary directory by `openDatabase`, the real core runner and queue, and a test registry of fixture plugins written with `definePlugin`. It asserts on status codes, response bodies, run events and rows read back through the API. No mocks of Drizzle, Hono or core, and no assertions on internal helpers.
- **Seam 1, the app:** `createApp(deps)` takes its configuration, database handle, registry, clock and client-IP lookup, so tests build it without the environment.
  - Configuration: each missing or malformed required setting exits with its message; `ENCRYPTION_KEY` unset prints a valid key; `proxy` without `TRUSTED_PROXIES` refuses to boot; `oauth` refuses to boot with the hosted-tier message.
  - Cross-site: a mutating request without `Content-Type: application/json` is `415`; a webhook request with any content type is not; no response carries an `Access-Control-Allow-*` header.
  - Sessions: `bootstrapped` resolves with no cookie; `proxy` accepts a trusted address with the header, and answers `401` for a trusted address without it and for an untrusted address with it; forwarded headers are ignored from untrusted addresses; a public address in `bootstrapped` sets `exposed`, a Tailscale or ULA address doesn't.
  - Scoping: with a second account seeded directly in the database, no route reads or changes its rows (404 everywhere). This is the test that carries ADR-0003 at the API.
  - Applets: issues at the fake's paths; a stored slot that no longer parses comes back raw; enabling moves `next_run_at` forward; delete removes runs.
  - Settings: save issues; get with issues for a stored value that no longer parses.
  - Services: a `token` service's configure answers `invalid`, `test-failed` (no grant written) and `saved` (grant written, encrypted); a `test()` that throws is a `500` naming the plugin, with no grant written; requirements for a `token` service and for `none`; `status` for each of its four cases, with no outbound request.
  - API schemas: every route's response parses with its `@ultrasonics/server/api` schema, and none carries `accountId` or `webhookTokenHash`.
- **Seam 2, the stream:** a fixture plugin that waits on a test-controlled promise, so a run can be held mid-flight.
  - Run now answers `started` with an id, then `queued`, and further firings are absorbed. Run now on a disabled applet starts a run.
  - `configDir` is under the run's account.
  - SSE: a live run streams events in `seq` order; reconnecting with `Last-Event-ID` resumes without duplicates; a finished run replays the same events as the live run produced; an interrupted run ends with `end: interrupted`; another account's run is `404`.
  - Journal: the row holds the journal after a stage finishes, before `end`; the log cap is applied.
  - These tests use `port: 0` where Hono's SSE needs a real server (ADR-0024, Consequences).
- **Seam 3, triggers:** an injected clock.
  - `nextSlot`, as a pure function: hourly across a DST change (absolute); daily at 03:00 across spring forward and fall back (calendar); a 02:30 anchor on the spring-forward day; weekly; `count > 1`; an anchor in the future.
  - The loop: a due applet runs once with trigger `schedule` and `next_run_at` advanced; a backlog of several missed slots runs once; a disabled applet doesn't run; re-enabling doesn't fire.
  - Webhook: `GET`, `POST` and bearer forms start a run; a multipart body is ignored; unknown and revoked tokens give identical `404`s; a disabled applet gives `409`; regeneration invalidates the old token at once; the URL's origin follows `Host`, and `X-Forwarded-*` only from a trusted proxy.
  - Boot: a `running` row becomes `interrupted`.
- Prior art: the `bun:test` suites in `@ultrasonics/db` (real SQLite in a temp dir) and `@ultrasonics/core` (fixture plugins in `test/fixtures/`).

## Out of Scope

- Hosted login, cookie sessions, `federated_identities`, linking (ADR-0008, ADR-0016) and the `Proxy` provider (Phase 5). `AUTH_SOURCE=oauth` refuses to boot until then.
- A `PUBLIC_URL` setting (the hosted tier will need one; grilling decision 11).
- A `Host` allowlist, CSRF tokens, or any defence against DNS rebinding (ADR-0030).
- The `oauth2-pkce` half of the provider and everything Spotify-specific: the Spotify spec.
- The HTTP `ApiClient`, and reconciling the UI's view types: #126.
- A list of past runs per applet (#118, Out of Scope).
- A per-account live stream (ADR-0026, Considered options).
- The v1 importer (Phase 2, ADR-0017), and its boot step.
- `WorkerExecutor` and deadline enforcement (Phase 2, ADR-0010).
- Automatic retries (ADR-0018 §4); outbound webhooks and file watch (ADR-0011 §6).
- Rate limiting the webhook (ADR-0018 §5).
- A URL subpath (ADR-0015, #37).
- Scheduled token refresh pre-warm (ADR-0013 §5).
- Multi-arch images and publishing (Phase 4).
- OpenAPI (ADR-0024, Consequences).

## Further Notes

- **Tickets: three**, as #100 planned, each sized for `/code-review` (`docs/build-process.md`, "Sizing"):
  1. Boot, sessions, the API and the token provider. No open blocker: #108, #109 and #110 are delivered.
  2. The run hub and the stream. Blocked by ticket 1.
  3. The scheduler and the webhook. Blocked by ticket 2.

  Spec 5's one ticket is blocked by ticket 1, and #126 by all three.
- **Decided here, worth a glance:**
  - `PORT` defaults to `5000` and `DATA_DIR` to `/config` in the image.
  - Applet create answers `201`, and validation failures `422` with `{ issues }`.
  - A heartbeat every 15 seconds on the SSE stream.
  - The exposure warning is logged once per address per boot.
  - Boot refuses two plugins that declare one service with different specs.
  - A decryption failure is never shown as "reconnect".
  - Tokens are 32 random bytes, hashed with SHA-256.
- **Accepted-ADR wording that argued for the cheaper option**, checked in the grilling:
  - ADR-0026's "Rejected for Phase 1: nothing needs the applet list to update live" is why decision 1 polls rather than streams.
  - ADR-0018 §5's "No rate limiting in Phase 1: the queue depth of one already absorbs a flood into one pending run" is why the webhook has no limiter.
  - ADR-0015 §6's "a warning, not a block" underlies ADR-0030's accepted DNS-rebinding risk.
- **Status of the ADRs this rests on:** ADR-0026 and ADR-0030 are Proposed. The runner already implements ADR-0026, so this spec follows it. Every other ADR cited is Accepted.
