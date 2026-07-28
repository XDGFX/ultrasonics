# ADR-0002 — Open-core with a hosted SaaS revenue tier

**Status:** Accepted
**Date:** 2026-07-28

## Context

Reviving ultrasonics is a real effort, and the owner wants a pathway to revenue without
compromising the self-hostable, open-source product that earned the project its audience. In an
open-core model the code is free and fully self-hostable, so nobody pays for capability they
could run themselves — they pay for **convenience operated on their behalf**. The question was
what, concretely, the paid product is, and how it coexists with a free tier. A pure cloud SaaS
also has a hard constraint specific to this domain: it cannot reach services on the user's home
network (Plex, Subsonic, local files), which is historically the most-requested use case
(Spotify → Plex).

## Decision

Adopt **open-core** with a **hosted SaaS** revenue tier:

1. **Free forever, self-hostable** — the full product, including network-local services, stays
   OSS and free. The paid tier withholds convenience, never capability.
2. **Paid = fully hosted SaaS ("A1")** — ultrasonics runs it; users sign up and connect services
   without touching Docker. It launches **cloud-services-only** (Spotify, Deezer, Tidal, Apple
   Music, YouTube Music, Last.fm), because the cloud cannot reach a home Plex/local library.
3. **Home agent ("A2") is a later addon** — a lightweight home-network worker that lets the
   hosted tier reach Plex/local. Architecturally the CLI runner with remote dispatch (ADR-0001).
   Designed-for, not built up front.
4. **Ship every service in hosted; gate reactively** — no preemptive official-vs-unofficial-API
   boundary. YouTube Music (unofficial API) is included. Insurance is a per-service **kill-switch**
   feature flag so a service can be disabled by config, not a redeploy.
5. **Pricing** — subscription with a freemium tier, via Stripe. The free hosted tier is the
   conversion funnel. Exact tier limits are a launch-time detail.
6. **Sequencing** — hosted is a later phase (roadmap Phase 5), foundation-first: a reliable
   multi-tenant self-host product at v1 parity comes first. Only the commercial-API applications
   (Spotify extended quota, Apple Developer) start early in parallel, for lead time.

Product AI (LLM matching, natural-language playlists) stays out of the initial product; the seams
are reserved (see `CONTEXT.md`, "Matcher strategy") but the implementation is deferred and opt-in.

## Consequences

- Multi-tenancy and accounts are pulled forward into the foundation (ADR-0003), earlier than a
  self-host-only product would need them.
- The auth layer must serve both BYO self-host credentials and hosted app-owned credentials
  behind one interface (ADR-0005).
- A commercial relationship with each streaming platform (extended quota, developer terms) becomes
  a real, ongoing dependency for the hosted tier — tracked as an early parallel workstream.
- Reliability of unofficial APIs (YouTube Music) becomes a support/comms concern for paying users;
  the kill-switch is the mitigation.
- Superseded scope from the original plan: auth/accounts are no longer "deferred".
