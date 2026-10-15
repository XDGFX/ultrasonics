# 015 — Scheduler architecture

**Status:** ✅ resolved 2026-10-15 (agreed by Cal in session; ADR-0018 accepted 2026-10-15) · **Type:** grilling · **Blocked by:** 004 ✅ · **Blocks:** — · **Claimed by:** Claude (wayfinder session 2026-10-15)

## Question

[ADR-0011](../../adr/0011-triggers-are-server-capabilities-not-plugins.md) makes the **server** own
scheduling. In v1 nobody owned it: the time trigger blocked in `time.sleep` and `scheduler.py` merely
polled plugins every 120 seconds. That job is now ours, and it is Phase 1 work.

Graduated from the map's **Not yet specified** on 2026-08-04, when 004 resolved.

Decide:

1. **Where scheduled intent lives.** A column on the applet row, or its own table of due-times? The
   schema is already frozen (ADR-0009: SQLite via Drizzle, JSON columns available), so this must fit
   it rather than reopen it.
2. **How the schedule is expressed.** Cron string, or v1's simpler interval-from-a-start-timestamp
   (Hours 3600 / Days 86400 / Weeks 604800 / Months 2628000)? Note the competitor evidence in
   [014](014-trigger-candidates.md): daily is the norm and Soundiiz explicitly *refuses* hour-of-day
   selection, so full cron may be more expressiveness than anyone wants — but self-hosters running
   their own box may expect it.
3. **Missed runs.** The box was asleep, or the container was down, across a due time. On next boot:
   run immediately, skip to the next due time, or backfill? Interacts with the queue-depth-of-one
   rule — backfilling several missed runs collapses to one run by construction.
4. **Restart durability.** Schedules must survive a restart, which means due-times are computed from
   persisted state rather than held in an in-process timer. Confirm the mechanism: a single wake-up
   loop scanning for due applets, or per-applet timers rehydrated on boot?
5. **Resolution.** How often the scheduler wakes. v1's 120-second poll is a floor on precision; is
   that good enough, and does it interact with the minimum permitted interval?
6. **The inbound webhook's shape** — the other half of ADR-0011's trigger config. URL form, how it is
   authenticated (per-applet token in the path, a header, or an account-level key), and whether it is
   rotatable. It must be callable by Home Assistant and Node-RED, which send a plain HTTP request with
   arbitrary headers, so nothing exotic.

## A good resolution

Enough for Phase 1 to build the scheduler and the webhook route without further decisions: where
intent is persisted, how it is expressed, what happens across downtime, and how the webhook endpoint
is addressed and authenticated.

## Context

Not a contract the *plugin SDK* depends on — 005 can freeze without it. It is a **core/server**
decision that Phase 1 needs before the runner is built, which is why it sits on this map rather than
being left to an implementation wave.

## From 009

- #12 asks for one automatic retry after a transient failure. Decide whether retries exist, and how
  they interact with queueing at depth one.
- v1 logged an applet with **no trigger** as an error with a traceback (#31). An applet that only
  runs on demand is valid and must not log as a failure.

## Answer

Agreed with Cal on 2026-10-15, across two grilling rounds. The decision is
[ADR-0018](../../adr/0018-the-scheduler-and-the-inbound-webhook.md). In short:

1. **Where intent lives:** nullable `schedule` (JSON), `next_run_at` (indexed) and
   `webhook_token_hash` columns on `applets`, outside `definition`. No schedules table.
2. **Expression:** `{ kind: 'interval', unit: 'hour'|'day'|'week', count, anchor, timeZone }`, tagged
   so a `cron` kind can follow without a migration. Days and weeks are calendar units in the
   schedule's own IANA zone; the minimum interval is one hour. v1's "Months" imports as four weeks.
3. **Missed runs:** an overdue applet runs once on boot. Re-enabling or editing jumps to the next
   future slot, with no catch-up run.
4. **Restart durability:** one loop scans for due applets; `next_run_at` is the only state, advanced
   at dispatch along the anchor's grid. Orphaned `running` rows become `interrupted` on boot.
5. **Resolution:** a 60-second tick, ample against a one-hour minimum.
6. **Webhook:** one hashed, show-once, rotatable token per applet, as `GET|POST /api/hooks/<token>` or
   a Bearer header; `202` / `404` / `409`; no rate limit in Phase 1.

From 009: **no automatic retries** in Phase 1 (#12), because retrying only transient failures needs
plugins to classify errors, an SDK change; it moves to the map's fog. An applet with no trigger is a
row with nulls and never logs as an error (#31). `runs` also gains `trigger`
(`schedule | webhook | manual`).
