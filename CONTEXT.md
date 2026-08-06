# Context

Domain glossary for ultrasonics. No implementation details — terms only. When a term maps to a
decision, it links the ADR that owns it.

## Core Domain

**ultrasonics** — A tool for syncing music playlists between services. A user chains plugins
into an **Applet** that pulls playlists from one place, optionally transforms them, and pushes
them somewhere else. Self-hostable and free; a hosted paid tier is planned (ADR-0002).

**Song dict** — The universal interchange format passed between every plugin. A list of
**Playlist** objects, each `{ name, id: { service: id }, songs: [Song] }`. This shape is the
project's core asset and is deliberately service-agnostic. Changing it is an ADR-level decision.
_Avoid_: "track list", "payload" — it is always the *song dict*.

**Song** — One entry in a playlist: `{ title, artists: [string], album, date, isrc, location,
id: { service: id } }`. Every field except `title`/`artists` is optional. `isrc`, `id`, and
`location` are **hard-match keys** (see **Fuzzymatch**); the rest are fuzzy-matched.

**ISRC** — International Standard Recording Code. A globally unique per-recording identifier.
When present on both sides it is the most reliable cross-service match short of an exact ID.

**Playlist** — A named, ordered collection of songs, optionally carrying per-service IDs so the
same playlist can be recognised across services.

**Applet** — A saved sync pipeline: one or more **Inputs**, zero or more **Modifiers**, and one or
more **Outputs**, plus its **Trigger** configuration. Modelled on IFTTT. The mental model users
already understand; keep it — the UI still reads "when this, do that" even though a trigger is
server-side configuration rather than a component in the pipeline (ADR-0011). Runs on a trigger or on
manual run.

## Plugins

**Plugin** — A self-contained integration with a service or a transformation step. Declares what
it is via a **Handshake**, does its work in `run()`, optionally validates credentials in
`test()`, and describes its per-applet settings via `builder()`. In v2 a plugin is a typed
module registered explicitly (ADR-0004), not discovered by dynamic import.

**Handshake** — A plugin's self-description: name, description, **Mode**(s), version, declared
**auth** need, and its settings schemas. In v2 a settings schema is a Zod object that drives
validation, the TypeScript type, and the auto-generated settings form at once. The **Component**
types are *not* declared — they are derived from the keys of `run` (ADR-0012), so the list exists
in one place rather than three.

**Component** — Which slot a plugin occupies in an applet: **Input**, **Modifier**, or **Output** —
three, not four. A single plugin may support several (e.g. Spotify is both input and output), and in
v2 it does so by supplying one `run` handler and one `instanceSettings` schema per component
(ADR-0012), not by branching on a component argument as v1 did.
**Trigger is not a component** (ADR-0011); earlier docs list four.

**Input** — A component that fetches playlists/songs from a service and emits a song dict.

**Modifier** — A component that receives a song dict and returns a transformed one (merge,
dedupe, filter, substitute). Optional in an applet.

**Output** — A component that receives a song dict and writes it to a service. Terminal; emits
nothing back into the pipeline.

**Trigger** — What decides *when* an applet runs: a **schedule**, and/or an authenticated **inbound
webhook**. Not part of the song-dict flow. **A trigger is not a plugin and not a Component** — it is
applet configuration owned by the server (ADR-0011). Any trigger firing runs the applet (**OR**,
hardcoded — v1's AND was an acknowledged bug, and the question dissolves once triggers stop being
components). A trigger firing while the applet is already running **queues** it, at a **queue depth of
one**; further firings are absorbed into the pending run and the applet shows a `queued` state.
Concurrency across *different* applets is allowed.
_Avoid_: "trigger plugin" — v1's webhook and time-trigger plugins are not ported as plugins.

**Mode** — Whether a plugin operates on whole **playlists** or on a flat list of **songs**. A
songs-mode plugin contributes a single synthetic playlist to the flow. Mixing many playlists
into a songs-mode output is unsupported and should warn.

**Plugin SDK** — The typed contract and helper library every plugin builds against
(`packages/plugin-sdk`). Owns `definePlugin()`, the handshake/settings types, and auth helpers.
Changes here are a checkpoint gate (AGENTS.md). **The surface is frozen** as of ADR-0012 and
specified in `docs/proposals/plugin-sdk-v2.md`; changing it is an ADR-level act.

**Conformance test** — A shared test suite every plugin must pass to be considered ported: it
exercises the handshake shape, settings validation, and the input/output contract against the
song dict. The gate for Phase 2 parity work.

## Matching

**Fuzzymatch** — The weighted song-matching engine that decides whether two songs are "the same"
across services. Hard keys (`location`, then `isrc`/`id`) short-circuit to a match; otherwise a
weighted average of fuzzy field scores (title, artist, album, date) is compared to a threshold.
The v1 weights and regex cleaning are the source of truth and are ported verbatim (ADR-0005);
see `docs/reference/legacy-architecture.md`.

**Matcher strategy** — The pluggable approach fuzzymatch uses: `"fuzzy"` (the deterministic v1
algorithm, default) or a future `"llm"` strategy for hard cases. The seam exists from the start;
the LLM implementation is deferred and opt-in (ADR-0002 keeps product AI out of Phase 1).

## Auth

Two different things share the word "auth" and must never be conflated:
**service auth** (how a *plugin* gets credentials for Spotify) and **user auth** (how a *person*
gets into ultrasonics). `AuthProvider` is the first. Accounts and sessions are the second.
_Avoid_: unqualified "auth" in prose — say **service auth** or **user auth**.

### Service auth — credentials for a plugin

**AuthProvider** — The swappable interface through which a plugin obtains credentials for a
service. A plugin declares *what* auth it needs (e.g. Spotify OAuth); it never encodes *how* the
credentials are obtained. Implementations: **BYO** (self-hoster supplies their own app
credentials, default, always works offline), **PKCE** (no client secret needed), and **Proxy**
(credentials brokered by a hosted service). See ADR-0005.

**Service** — The thing a grant is *for* (`"spotify"`, `"plex"`), declared by a plugin as
`defineAuth({ service })`. A **contract string, not a label**: it is the key of the stored
credential row, so two plugins declaring the same service **share one grant by design** — this is
how `spotify` and `spotify-mixer` share one connection, as they did in v1 (ADR-0013).
_Avoid_: treating `service` as a display name, or assuming one plugin means one grant.

**Grant** — One account's stored credential for one service: the encrypted row keyed
`(account_id, service)` (ADR-0009). What `resolve()` returns credentials from, and what a user
"reconnects" when it expires.

**Flow** — *How* a secret is obtained: `oauth2-pkce`, `oauth2`, `token` (the user pastes one), or
`none`. Distinct from **fields**, which is *what* must be collected — a Zod object the plugin
declares, from which `Credentials` is inferred (ADR-0013).
_Avoid_: `apiKey` or `serverUrl` as flow names — both are `token` flows differing only in fields.

**BYO credentials** — "Bring your own": the self-hoster registers their own developer app with a
service and pastes the client ID (and secret only where unavoidable). The default and offline
path. Contrast with the hosted tier, where ultrasonics holds the app credentials.

**ultrasonics-api** — *(legacy, dead)* The v1 proxy server that held secret API keys for public
services. Ran on Heroku free tier and stopped working in Nov 2022, breaking Spotify sync for new
users. Replaced entirely by **AuthProvider**. Referenced only for historical context.

### User auth — getting a person into ultrasonics

The model is settled in ADR-0007. v1 had none of this — it shipped with no login at all.

**Account** — **The** principal, and the only one: a person *and* the boundary that owns their
applets, credentials, and run history, one-to-one and permanently (ADR-0007). One hosted
subscription means exactly one login. In the **hosted tier** an account is created at signup; in
**self-host** one is bootstrapped on first run and the user never sees it (ADR-0003). Every
persisted row carries `account_id`; every route resolves an account before touching data.
_Avoid_: "tenant", "org", "team", "workspace" — there is one word and it is *account*. (Earlier ADRs
say *tenant*; read **Account**. See ADR-0007 for why the term was retired.)

**Session** — An authenticated request context: which account is making this request, and therefore
whose data it may touch. A server-side `sessions` row behind an opaque HTTP-only cookie — not a JWT
(ADR-0007), so it can be revoked instantly. The server resolves it; the **core** never sees it.

**Session source** — Where a `Session` comes from. Authentication is never *bypassed*, only sourced
differently (ADR-0007): a **cookie login**, the **bootstrapped account** (self-host's default), or a
**trusted-proxy header** (Authelia et al.). All three are available in every
deployment. Self-host's realistic choice is **bootstrapped** or **trusted-proxy**: hosted login is
social OAuth, and a LAN box with no public DNS cannot complete an OAuth callback, so the cookie
source is hosted in practice (ADR-0008). `DISABLE_AUTH` selects the bootstrapped source *inside* the
always-run middleware — it never skips it, so `req.session` is never undefined.
_Avoid_: describing `DISABLE_AUTH` as "disabling auth" — it selects a source.

**Login-free self-host** — The requirement that a self-hoster is never shown a login wall: first-run
bootstrap, with trusted-reverse-proxy mode for anyone who wants a wall. A first-class requirement,
not a flag bolted on — v1 had no login, so a wall would be a regression (ADR-0003). **Self-host has
no login wall on offer at all** (ADR-0008); a self-hoster wanting one runs a reverse proxy in front,
and supporting their proxy is outside ultrasonics' scope.
_Avoid_: "a default, not a ceiling" — that framing is withdrawn by ADR-0008.
_Avoid_: generalising this to "no setup", "no configuration" or "no env vars". The promise is about
the **login wall and nothing else**. Self-host may reasonably require configuration — ADR-0009
requires an explicit `ENCRYPTION_KEY` precisely because the wider reading, once assumed, argued for a
weaker security default.

**Login identity** — What a person presents to prove who they are: a `federated_identities` row
holding a provider name and an opaque `subject_id` (ADR-0008). Hosted is **social OAuth only** —
Google at launch — so ultrasonics stores no login credential at all: no password hash, no magic-link
token, no email dependency. An account may hold several identities by construction, though launch
behaviour is one.

**Login identity ≠ service connection** — The two must never be the same record (ADR-0008). Spotify
can occupy both roles — a service ultrasonics fetches playlists from *and* a possible sign-in
provider — so the rule is explicit: signing in with a service provider **may offer to seed** a
service connection, but the account **never depends** on it. Disconnecting Spotify from syncing does
not affect the ability to log in.

**Capabilities, not identity** — How the account boundary is enforced in code (ADR-0007). The server
resolves the account and hands **core** objects already scoped to it (an `AuthProvider` bound to that
account's credentials, a store bound to its rows). No core function takes an `accountId`, so core has
no way to name another account and cross-account leakage is structurally impossible rather than a
rule every query must remember.

## Deployment

**Self-host** — The free, open-source deployment: the full product on the user's own machine,
including services that live on their network (Plex, local files). Always the "real" product;
the paid tier withholds convenience, never capability. Ships login-free by default (first-run
admin bootstrap, auto-login, optional `DISABLE_AUTH`/trusted-proxy mode).

**Hosted tier** — The planned paid SaaS (ADR-0002): ultrasonics runs it, users never touch
Docker. Launches **cloud-services-only** — it cannot reach a home Plex/local library from the
cloud. Subscription + freemium via Stripe.

**Home agent** — *(future, A2)* A lightweight worker a hosted user runs on their own network so
the cloud control plane can reach their Plex/local library. Architecturally the headless **CLI
runner** given a remote-dispatch mode. Deferred; not built in the first hosted launch.

**CLI runner** — The headless applet runner (`packages/cli`) that runs applets without the web
UI, for cron and homelab use. The web UI is a client of the same server API, not a separate
engine.

**Kill-switch** — A per-service feature flag in the hosted tier that disables a service without a
redeploy. Insurance for reactive gating if a platform objects to a service's API use (ADR-0002).

## Storage

**Applet store / Plugin store** — The persisted applets and per-plugin persistent settings. In
v2, typed rows with JSON columns via a real ORM — replacing v1's practice of persisting Python
`repr` strings parsed back with `ast.literal_eval`.
