# ADR-0018 — The scheduler and the inbound webhook

**Status:** Proposed
**Date:** 2026-10-15
**Builds on:** ADR-0011 (triggers are server config: OR, queue depth one), ADR-0009 §5 (schema),
ADR-0017 §4 (the importer maps `time trigger` to a schedule)
**Amends:** ADR-0009 §5. `applets` gains `schedule`, `next_run_at` and `webhook_token_hash`, and
`runs` gains `trigger` and an `interrupted` status.
**Ticket:** [`docs/plans/tickets/015-scheduler-architecture.md`](../plans/tickets/015-scheduler-architecture.md)

## Context

ADR-0011 made the server own scheduling, but left open how it does so. In v1 nothing owned it: the
time trigger blocked in `time.sleep`, and `scheduler.py` polled plugins every 120 seconds. The
market norm is a daily sync, and Soundiiz refuses hour-of-day selection outright, so the 014
research found that full cron is more than anyone asks for. The database is SQLite in a single
container (ADR-0009 §2), so there is only ever one scheduler process.

## Decision

### 1. A schedule is an interval from an anchor, as a tagged union

```ts
{ kind: 'interval', unit: 'hour' | 'day' | 'week', count: number, anchor: string, timeZone: string }
```

- `count` is an integer, at least 1. The minimum interval is therefore one hour.
- `anchor` is a local date-time, and `timeZone` an IANA zone the browser fills in when the schedule
  is saved. The zone lives in the schedule, not on the account, so it is right on both tiers without
  a column.
- `day` and `week` are **calendar** units in that zone, so "daily at 03:00" stays at 03:00 across a
  clock change. `hour` is an absolute 3600 seconds and never sees DST.
- A slot that does not exist (spring forward) runs at the next valid instant. A slot that occurs
  twice (fall back) runs once, at the first occurrence.
- The union is tagged so that a `cron` kind can be added later without a migration. A self-hoster
  who wants cron now can point their own cron at the webhook (§5).

Rejected: a cron string, which needs a cron editor to be usable in a UI and offers precision nobody
asked for; and v1's fixed-second intervals, which drift by an hour across DST.

### 2. Intent lives on the applet row

`applets` gains three nullable columns, all outside `definition`, which stays the plugin chain:

- `schedule` (JSON, Zod-validated) — null means no schedule.
- `next_run_at` (indexed) — the only scheduling state; nothing is held in memory.
- `webhook_token_hash` — null means no webhook.

An applet with neither is valid and runs only on demand. It is never logged as an error (v1 #31).
A separate schedules table was rejected: it only pays for itself if an applet can have several
schedules, which nobody has asked for.

### 3. One loop, a 60-second tick

A single loop wakes every 60 seconds, selects `enabled AND next_run_at <= now`, and hands each due
applet to the runner, which applies ADR-0011's queueing. It is also the loop ADR-0009 gives session
sweeping to. Per-applet in-process timers were rejected: they would have to be rebuilt on boot, and
the loop needs no rehydration.

`next_run_at` advances **at dispatch**, to the next slot on the anchor's grid, never measured from
when a run started or finished, so slow runs do not drift the schedule.

### 4. Downtime, disabling, editing and crashes

- **Downtime:** an applet whose `next_run_at` passed while the server was down runs **once** on
  boot, then returns to its grid. Missing a day's sync because the box rebooted is the worse
  failure. Backfill collapses to one run anyway, by the queue-depth rule.
- **Re-enabling** never triggers a catch-up run: `next_run_at` jumps to the next future slot,
  because disabling was deliberate and downtime was not. **Editing** a schedule does the same, from
  the new anchor.
- **A crash mid-run:** on boot, `runs` rows left `running` become **`interrupted`** and are not
  rerun. A pending run, which is held in memory, is lost. Because `next_run_at` moved at dispatch, a
  crash costs at most one run.
- **No automatic retries** in Phase 1 (v1 #12). Retrying only transient failures would need plugins
  to classify their errors, which is a plugin SDK change (ADR-0012). The next scheduled firing is
  the retry.

### 5. The inbound webhook

- One secret token per applet. The token alone identifies the applet, and the applet's
  `account_id` scopes the run, so no session is involved.
- Accepted as `GET` or `POST /api/hooks/<token>`, or `POST /api/hooks` with
  `Authorization: Bearer <token>`. `GET` is accepted because some tools can send nothing else.
  Any content type; the body is ignored (Plex sends `multipart/form-data`).
- Responses: `202` with `started` or `queued`; `404` for an unknown or revoked token, identical in
  both cases; `409` for a disabled applet, which queues nothing rather than hiding a misconfigured
  automation.
- The token is **hashed at rest** and shown once, when it is generated. It can be regenerated, which
  invalidates the old one immediately, or removed.
- No rate limiting in Phase 1: the queue depth of one already absorbs a flood into one pending run.
  Per-IP limits on bad-token guesses are a hosted-tier concern.

### 6. A run records its trigger

`runs` gains `trigger`: `schedule | webhook | manual`. When several firings are absorbed into one
pending run, it records the first.

### 7. The importer's mapping

v1's Hours, Days and Weeks map to the matching `unit` with `count: 1`, anchored at the import
(ADR-0017 §4). v1's "Months" was a fixed 2,628,000 seconds, not a calendar month; it becomes four
weeks, noted in the import report. The zone comes from `TZ`, or UTC when it is unset.

## Consequences

- A scheduled run starts up to 60 seconds late. With a one-hour minimum, nobody will notice.
- The webhook is the only unauthenticated route that starts work in an account. Its token is a
  credential, and a leaked database cannot be used to trigger anyone's applets.
- `runs` retention is still undecided (ADR-0009 §5); this ADR adds columns but does not settle it.
- If the hosted tier ever needs more than one instance, the single loop needs a lease. ADR-0009 §2
  already names that as its own revisit trigger.
