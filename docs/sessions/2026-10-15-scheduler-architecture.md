# 2026-10-15 — Scheduler architecture (map ticket 015)

/wayfinder, working the map. One ticket resolved.

## Done

**Ticket 015 resolved.** Cal agreed every recommendation across two grilling rounds. The decision is
[ADR-0018](../adr/0018-the-scheduler-and-the-inbound-webhook.md), which is Proposed.

- A schedule is an interval (hour, day or week) from an anchor in its own IANA zone, as a tagged
  union so cron can be added later. Days and weeks are calendar units, so DST does not drift them.
- Three nullable columns on `applets`; one 60-second loop; `next_run_at` advances at dispatch.
- Downtime fires one catch-up run; re-enabling and editing do not. Crashed runs become
  `interrupted`. No automatic retries (#12 moves to the map's fog).
- The webhook is a hashed, show-once, rotatable per-applet token, in the path or a Bearer header.
- `runs` gains `trigger`. ADR-0009's table is amended inline, and `CONTEXT.md` gains **Schedule**
  and **Run**.

## Next

Cal to accept ADR-0018. Frontier, first by number: 016, then 017 ⛔.
