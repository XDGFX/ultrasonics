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

**Applet** — A saved sync pipeline: one or more **Inputs**, zero or more **Modifiers**, one or
more **Outputs**, and zero or more **Triggers**. Modelled on IFTTT. The mental model users
already understand; keep it. Runs on a trigger or on manual run.

## Plugins

**Plugin** — A self-contained integration with a service or a transformation step. Declares what
it is via a **Handshake**, does its work in `run()`, optionally validates credentials in
`test()`, and describes its per-applet settings via `builder()`. In v2 a plugin is a typed
module registered explicitly (ADR-0004), not discovered by dynamic import.

**Handshake** — A plugin's self-description: name, description, **Component** type(s), **Mode**(s),
version, declared **auth** need, and a settings schema. In v2 the settings schema is a Zod object
that drives validation, the TypeScript type, and the auto-generated settings form at once.

**Component** — Which slot a plugin occupies in an applet: **Input**, **Modifier**, **Output**, or
**Trigger**. A single plugin may support several (e.g. Spotify is both input and output).

**Input** — A component that fetches playlists/songs from a service and emits a song dict.

**Modifier** — A component that receives a song dict and returns a transformed one (merge,
dedupe, filter, substitute). Optional in an applet.

**Output** — A component that receives a song dict and writes it to a service. Terminal; emits
nothing back into the pipeline.

**Trigger** — A component that decides *when* an applet runs (e.g. every 6 hours). Not part of
the song-dict flow. Historically the runner required *all* triggers to fire (AND); the intended
semantics are OR — resolve when triggers are rebuilt.

**Mode** — Whether a plugin operates on whole **playlists** or on a flat list of **songs**. A
songs-mode plugin contributes a single synthetic playlist to the flow. Mixing many playlists
into a songs-mode output is unsupported and should warn.

**Plugin SDK** — The typed contract and helper library every plugin builds against
(`packages/plugin-sdk`). Owns `definePlugin()`, the handshake/settings types, and auth helpers.
Changes here are a checkpoint gate (AGENTS.md).

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

**AuthProvider** — The swappable interface through which a plugin obtains credentials for a
service. A plugin declares *what* auth it needs (e.g. Spotify OAuth); it never encodes *how* the
credentials are obtained. Implementations: **BYO** (self-hoster supplies their own app
credentials, default, always works offline), **PKCE** (no client secret needed), and **Proxy**
(credentials brokered by a hosted service). See ADR-0005.

**BYO credentials** — "Bring your own": the self-hoster registers their own developer app with a
service and pastes the client ID (and secret only where unavoidable). The default and offline
path. Contrast with the hosted tier, where ultrasonics holds the app credentials.

**ultrasonics-api** — *(legacy, dead)* The v1 proxy server that held secret API keys for public
services. Ran on Heroku free tier and stopped working in Nov 2022, breaking Spotify sync for new
users. Replaced entirely by **AuthProvider**. Referenced only for historical context.

## Deployment & Tenancy

**Self-host** — The free, open-source deployment: the full product on the user's own machine,
including services that live on their network (Plex, local files). Always the "real" product;
the paid tier withholds convenience, never capability. Ships login-free by default (first-run
admin bootstrap, auto-login, optional `DISABLE_AUTH`/trusted-proxy mode).

**Hosted tier** — The planned paid SaaS (ADR-0002): ultrasonics runs it, users never touch
Docker. Launches **cloud-services-only** — it cannot reach a home Plex/local library from the
cloud. Subscription + freemium via Stripe.

**Tenant** — The isolation boundary in the data model: a workspace/account that owns its
applets, credentials, and run history. Full multi-tenancy is built in from day one; self-host
runs the same code as a single tenant with a fixed owner it never sees (ADR-0003).
_Avoid_: "org", "team" — it is a *tenant*.

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
