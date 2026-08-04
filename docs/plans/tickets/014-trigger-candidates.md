# 014 — Which triggers are worth having

**Status:** Open · **Type:** research (AFK) · **Blocked by:** — · **Blocks:** 004 · **Claimed by:** —

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
