# 015 — Scheduler architecture

**Status:** Open · **Type:** grilling · **Blocked by:** 004 ✅ · **Blocks:** — · **Claimed by:** —

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
