# 014 — Which triggers are worth having

**Status:** ✅ resolved 2026-08-04 · **Type:** research (AFK) · **Blocked by:** — · **Blocks:** 004 ·
**Claimed by:** wayfinder session 2026-08-04

## Question

Before [004](004-trigger-model.md) can decide *how* a trigger is modelled, we need to know *which*
triggers are worth having. 004 opened on the SDK shape and immediately hit the prior question: the
right shape depends entirely on whether the valuable set is two server-owned capabilities or an
open-ended, service-specific family.

Cal's framing, verbatim in substance: a **time schedule** is obviously required; **local file
changes** are clearly impossible on hosted; the v1 **webhook** trigger may never have been used by
anyone; and **generic hooks** — a new album dropping, or integration with Home Assistant, Node-RED
or IFTTT — may be worth more than either.

Answer these:

1. **Did anyone use the v1 webhook trigger?** `XDGFX/ultrasonics` is public with 275 stars and 40+
   open issues — read-only evidence (`docs/agents/issue-tracker.md`). Search issues, discussions and
   any Discord/Reddit trace for people configuring the webhook or the time trigger, and for people
   *asking* for automatic syncing. Absence of evidence is a finding; report it as such rather than
   inferring demand.
2. **What do comparable tools offer as triggers?** Soundiiz, TuneMyMusic, FreeYourMusic, Spotlistr
   and similar. Which offer scheduled/automatic sync, at what price tier, and at what frequency?
   Scheduling being the paywalled feature elsewhere is a signal about its value.
3. **Feasibility per deployment.** For each candidate, does it work on the **hosted tier** (which
   launches cloud-services-only and cannot reach a home network, `CONTEXT.md`), on **self-host**, or
   only one? Local file watching is self-host-only by construction — confirm whether anything else
   splits the same way, because a trigger that only works in one deployment is a different product
   decision from one that works in both.
4. **Generic hooks.** What do Home Assistant, Node-RED, IFTTT and Zapier actually need in order to
   drive an external tool? Confirm or refute the assumption that an authenticated **inbound webhook**
   is the common denominator, and note whether an **outbound** hook on sync completion is the more
   requested half. If inbound webhook covers all four platforms, "integrate with Home Assistant" is
   not a distinct trigger — it is the webhook trigger with documentation.
5. **Service-event triggers.** Is "a followed artist released a new album" actually obtainable from
   the Spotify, Last.fm or Deezer APIs? Identify the endpoint if so, and the polling cost — per
   account, per interval — since anything without a push notification becomes recurring server work
   the hosted tier pays for. Note any rate limits that would bite at scale.

## A good resolution

A ranked candidate list. For each trigger: what it does, the evidence of demand (with links), whether
it works hosted / self-host / both, whether it needs a service API or only the server, and a rough
cost class.

That is enough for 004 to decide the shape: a small server-owned set favours deleting the Trigger
component from the SDK; an open-ended service-specific set favours keeping a trigger plugin shape.

Findings land as a Markdown file in the repo, linked from this ticket as an asset.

## Answer

Full findings, with citations:
[`../../reference/trigger-candidates-research.md`](../../reference/trigger-candidates-research.md).

**Every trigger candidate that survives scrutiny is a server capability, not a service integration.**

| # | Candidate | Demand evidence | Deployment | Needs a service API? | Cost |
|---|---|---|---|---|---|
| 1 | Schedule | **Strong**, both directions | Both | No | Trivial |
| 2 | Inbound webhook | **None** — but 4-in-1 leverage | Both | No | Trivial |
| 3 | Outbound webhook | Weak, best available | Both | No | Trivial–small |
| 4 | Manual run-now | n/a (already exists) | Both | No | Trivial |
| 5 | Local file watch | None direct | **Self-host only** | No | Small |
| 6 | Plex `library.new` | None | Self-host only | No — *is* #2 | Zero beyond #2 |
| 7 | Service event ("new album") | **Zero** | **Blocked** | Yes | **Heavy** |

### 1. Nobody used the v1 webhook trigger

Across 51 issues, 983 comment lines, 0 discussions, 18 PRs, the wiki, the README and a GitHub-wide
code search, "webhook" appears **once** — a plugin-discovery log line inside a stack trace pasted by
someone reporting an unrelated Plex bug.

The silence is **over-determined**, which is why it does not settle anything on its own:

- It has been **broken since Werkzeug 2.1.0 (28 Mar 2022)** removed the `werkzeug.server.shutdown`
  key it depends on — and in four years nobody filed a bug.
- The Dockerfile only `EXPOSE`s 5000 while the trigger defaults to 5001, so it was unreachable in
  the primary distribution.
- It was never documented anywhere.

Three commits in Sept 2020, then nothing. **The webhook must therefore be justified forward-looking,
never on v1 usage.** The control that makes the comparison meaningful: the **time trigger** *is*
evidenced — contributed by the community across three PRs and visible unprompted in three users' logs.

### 2. Scheduling is the paywall line everywhere

Soundiiz, TuneMyMusic, FreeYourMusic and SongShift all gate scheduled sync behind payment, without
exception; Spotlistr has none at all. Daily is the norm (FreeYourMusic's 15 minutes is the outlier;
Soundiiz explicitly refuses hour-of-day selection). The self-hosted comparables — Plexist,
plex-playlist-sync, spotify-to-plex — are **interval-only with no trigger concept whatsoever**.
**No competitor offers a webhook trigger.**

### 3. One hard deployment split, and one asymmetry the wrong way

Local file watching is self-host-only by construction, as expected — it is the only hard binary.
The nuance: the **inbound webhook is asymmetric the "wrong" way** — fully capable on hosted, partly
limited on self-host, which has no public DNS. It survives because the callers that actually matter
to a homelabber (Home Assistant, Node-RED, Plex) sit on the same LAN.

### 4. Generic hooks collapse into the webhook — hypothesis confirmed

Home Assistant, Node-RED, IFTTT and Zapier **all** ship a built-in outbound HTTP action taking an
arbitrary URL, method and headers. So **"integrate with Home Assistant" is not a trigger — it is the
inbound webhook plus documentation.** One endpoint serves all four, and no per-platform plugin is
warranted.

Two things the hypothesis did not anticipate:

- **IFTTT and Zapier both paywall webhooks**, so the realistic audience is Home Assistant and
  Node-RED users — i.e. self-hosters, the same population the local-file-watch trigger serves.
- **The outbound half has the better demand signal.** Plex and Jellyfin both ship webhook *senders*
  with maintained HA blueprints; there is no equivalent in the inbound direction. Suggestive, not
  settled — flagged for 004 rather than decided here.

### 5. Service events are not obtainable at sane cost

**No music service has a push mechanism** — polling only. Spotify's one cheap shared-poll route
(`/browse/new-releases`) is deprecated and removed for development-mode apps with no replacement,
leaving roughly **816,000 requests/day at 1,000 accounts** against a per-app, shared, *unpublished*
limit. Last.fm's `user.getNewReleases` no longer exists. Deezer's API is login-gated and could not
be assessed.

The one candidate that would have justified a service-specific trigger plugin family is the weakest
on the list.

## What this hands to 004

Candidates 1–4 are a timer, a route in, a route out, and a button. **None needs a handshake, a
settings schema, `run()`, or credentials** — the entire plugin apparatus is unused by every trigger
worth building. That is evidence for deleting the **Trigger** component from the SDK; 004 owns the
call.

Two supporting observations, both for 004 to weigh rather than inherit:

- In six years nobody wrote a third-party *trigger* plugin, while the *service* axis drew repeated
  requests and a substantial TIDAL PR. Extensibility demand is real, but it is not on this axis.
- **The AND→OR bug dissolves entirely** if triggers become applet configuration rather than
  components — there is no longer a set of trigger plugins whose firings must be combined.

## Gaps not closed

Marked in the research document, and none of them overturn the ranking except where noted:

- **Reddit is unsearchable** (blocked), so r/selfhosted was not covered.
- **Soundiiz's beta User API** — whether it can trigger a sync could not be established
  (client-side-rendered docs, two failed fetches). This is the one open question that could overturn
  "no competitor offers a user-invokable trigger".
- **Deezer's API** could not be assessed at all.
- **No numeric Spotify rate limit is published**, so the §5 arithmetic cannot be checked against a
  threshold — the conclusion rests on the endpoint's removal, not on the sum.

## Out-of-scope finding, flagged not resolved

Question 5 surfaced a **Spotify platform-access constraint** that has nothing to do with triggers and
outranks them: development mode is reportedly capped at a handful of authorised users, and extended
quota requires a registered business above a high MAU threshold. That is a *permission* wall, not a
rate limit, and it bears on ADR-0002 (hosted revenue model) and ADR-0005 (whether **Proxy** is viable
for Spotify at all). **BYO self-host is unaffected** — arguably a retrospective vindication of BYO as
the default.

Both affected areas are hosted-tier, which this map rules out of scope, so **no ticket is opened
here**. The specific figures are second-hand within this research and must be reconfirmed against
Spotify's own developer terms before any decision rests on them. See the map's **Out of scope**
section for the pointer.
