# 011 — Self-host first run and auth-mode configuration

**Status:** Open · **Type:** grilling · **Blocked by:** 001 ✅, 010 · **Blocks:** — · **Claimed by:** —

## Question

What happens the first time someone starts a self-hosted ultrasonics container, and how do they
change their mind about authentication afterwards?

Graduated from the map's fog once [ADR-0007](../../adr/0007-account-model-sessions-and-the-core-boundary.md)
fixed the model. ADR-0007 established that authentication is never bypassed, only **sourced** — one
middleware always resolves a `Session`, from a cookie login, a bootstrapped account, or a
trusted-proxy header — and that **all three sources are available in every deployment**. Self-host
merely defaults to the frictionless one.

That default is the thing to get right: v1 shipped with no login at all, so any wall in front of a
self-hoster is a straight regression (ADR-0003). But Cal was explicit that frictionless is a
*default, not a ceiling* — a self-hoster who wants login exactly like hosted must be able to have it
by changing configuration, not by running a different build.

## To decide

- **First-run bootstrap.** The account ADR-0007 requires has to exist before the first request is
  served. Is it created eagerly at startup, lazily on first request, or by an explicit setup step?
  What is its identity when nobody has supplied an email address?
- **Switching modes.** A self-hoster starts frictionless, later wants a real login — what do they do,
  and what happens to the bootstrapped account? Does it gain credentials, or is a new account made
  and the data reassigned? (Under ADR-0007's 1:1 model, reassignment is not free.)
- **The configuration surface.** One env var with three values, or separate switches per source?
  Naming matters — `DISABLE_AUTH` is now actively misleading, since ADR-0007 says auth is never
  disabled, only sourced differently.
- **Trusted-proxy mode specifics.** Which header carries the identity, how ultrasonics is told to
  trust it, and the failure mode if it is trusted while *not* actually behind a proxy — that is a
  full authentication bypass, so the safe default and the loud warning both matter.
- **Exposure risk.** A frictionless install accidentally port-forwarded to the internet is wide open.
  Is that detected and warned about, or is it the user's problem? v1's answer was implicitly "user's
  problem"; v2 has an account model and can do better.
- **Multi-user self-host is out.** ADR-0007 fixed one account per install; a self-hoster wanting
  separate logins per family member is not served, and this ticket should say so plainly rather than
  leave it implied.

## A good resolution

- The first-run sequence written down, including what the bootstrapped account looks like.
- The configuration surface named, with `DISABLE_AUTH` either renamed or justified.
- The frictionless → real-login upgrade path, concretely.
- Feeds the self-host onboarding work in roadmap Phase 1 (`self-host first run reaches a working
  applet without a login prompt` is already in its exit gate).
