# 011 — Self-host first run and auth-mode configuration

**Status:** Open · **Type:** grilling · **Blocked by:** 001 ✅, 010 ✅ · **Blocks:** — · **Claimed by:** —

## Question

What happens the first time someone starts a self-hosted ultrasonics container, and how do they
change their mind about authentication afterwards?

Graduated from the map's fog once [ADR-0007](../../adr/0007-account-model-sessions-and-the-core-boundary.md)
fixed the model. ADR-0007 established that authentication is never bypassed, only **sourced** — one
middleware always resolves a `Session`, from a cookie login, a bootstrapped account, or a
trusted-proxy header — and that **all three sources are available in every deployment**. Self-host
merely defaults to the frictionless one.

That default is the thing to get right: v1 shipped with no login at all, so any wall in front of a
self-hoster is a straight regression (ADR-0003).

> **Rescoped 2026-08-03 by [ADR-0008](../../adr/0008-hosted-authentication-social-oauth.md).** This
> ticket was written on ADR-0007's "frictionless is a *default, not a ceiling*" framing — that a
> self-hoster could have hosted-style login by changing configuration. **That premise is withdrawn.**
> Hosted authenticates by social OAuth only, and a self-hoster on a LAN cannot complete an OAuth
> callback (providers reject private-network redirect URLs), so there is no login wall on offer for
> self-host at all. Anyone wanting one is directed to a trusted reverse proxy, and supporting their
> proxy is out of scope.
>
> What remains is **first-run bootstrap and the proxy-mode configuration surface** — narrower, and no
> longer blocked on anything. The "switching modes" question below is largely dissolved: there is no
> frictionless → real-login upgrade path to design, only frictionless → trusted-proxy.

## To decide

- **First-run bootstrap.** The account ADR-0007 requires has to exist before the first request is
  served. Is it created eagerly at startup, lazily on first request, or by an explicit setup step?
  What is its identity when nobody has supplied an email address?
- **Switching to proxy mode.** A self-hoster starts frictionless, later puts Authelia in front —
  what happens to the bootstrapped account and its data? Under ADR-0007's 1:1 model the proxy's
  asserted identity must resolve to *that* account rather than minting a second one.
- **The configuration surface.** One env var with three values, or separate switches per source?
  ADR-0008 keeps the name `DISABLE_AUTH` and its single switch, but fixes its meaning: it selects the
  bootstrapped source *inside* the always-run middleware rather than skipping it, so `req.session` is
  never undefined. Whether the name should still be changed — it does not disable anything — is open.
- **Trusted-proxy mode specifics.** Which header carries the identity, how ultrasonics is told to
  trust it, and the failure mode if it is trusted while *not* actually behind a proxy — that is a
  full authentication bypass, so the safe default and the loud warning both matter.
- **Exposure risk.** A frictionless install accidentally port-forwarded to the internet is wide open.
  Is that detected and warned about, or is it the user's problem? v1's answer was implicitly "user's
  problem"; v2 has an account model and can do better.
- **Multi-user self-host is out.** ADR-0007 fixed one account per install; a self-hoster wanting
  separate logins per family member is not served, and this ticket should say so plainly rather than
  leave it implied.

> **A precedent to adopt or reject knowingly, set 2026-08-03 by
> [ADR-0009](../../adr/0009-database-schema-drizzle-sqlite-and-migrations.md)** (map ticket 002).
>
> Ticket 002's grilling nearly justified a weaker security default by appealing to a self-host "no
> setup promise". **No such promise exists** — every use of *frictionless* in ADR-0003/0007/0008 and
> `CONTEXT.md` is about the **login wall specifically**, and Cal's position is that requiring
> configuration of self-hosters is entirely reasonable where it earns its keep. It was an agent's
> paraphrase hardening into a constraint, the same failure mode ADR-0007 caught with "tenant".
>
> So ADR-0009 chose **explicit configuration over a silent default**: the app refuses to boot without
> an `ENCRYPTION_KEY`, accepting the literal value `auto` as an opt-in to generating one. The reason
> was not the risk of the generated key — it was that a silent default means the user never learns the
> key exists, and finds out when a restored backup has dead service connections.
>
> This ticket owns the *general* first-run configuration surface, so it should settle whether that
> pattern is the house style — and note that its two live questions pull the same way. A
> **frictionless install accidentally port-forwarded** and **trusted-proxy mode enabled while not
> actually behind a proxy** are both cases where a silent, convenient default hides a security
> property the operator never chose. This ticket may still reject the precedent; it should just not
> re-derive the withdrawn "no setup" premise while doing so.
>
> Also inherited: ADR-0009 §7 has the app **auto-migrate on boot after copying the SQLite file**, so
> a first run and an upgrade run already share a startup path this ticket's sequence must slot into.

## A good resolution

- The first-run sequence written down, including what the bootstrapped account looks like.
- The configuration surface named, with `DISABLE_AUTH` either renamed or justified.
- The frictionless → trusted-proxy transition, concretely, including what becomes of the
  bootstrapped account's data.
- Feeds the self-host onboarding work in roadmap Phase 1 (`self-host first run reaches a working
  applet without a login prompt` is already in its exit gate).
