# 2026-10-15 — Self-host first run and auth-mode config (map ticket 011)

/wayfinder, working the map. One ticket resolved.

## Done

**Ticket 011 resolved.** Cal agreed every recommendation in one grilling round. The decision is
[ADR-0015](../adr/0015-self-host-first-run-and-the-auth-source-switch.md), which is Proposed.

- A setting that decides a security property never has a silent default. This is now the house
  style, generalised from ADR-0009's `ENCRYPTION_KEY`.
- `AUTH_SOURCE=bootstrapped|proxy|oauth` is required and replaces `DISABLE_AUTH`. This amends
  ADR-0008 §4.
- The account is created at boot, after migrations, in every mode. The bootstrapped `Session` has no
  row, which amends ADR-0009 §5's use of a never-expiring session.
- Trusted proxy: a `TRUSTED_PROXIES` CIDR list, and `PROXY_USER_HEADER`, which defaults to
  `Remote-User`. Requests fail closed with a 401. Any proxy user maps to the one account.
- Exposure gets a warning, not a block. Self-host has one account and does not support several
  users.
- Corrected ADR-0003's "admin account, auto-login" wording and the **Session source** and
  **Self-host** entries in `CONTEXT.md`. Added a **Trusted proxy** glossary entry.

## Next

Frontier, first by number: **012 ⛔ — the identity-collision rule**, then 013, 015, 016, 017 ⛔.
