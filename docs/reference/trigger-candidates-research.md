# Reference — Trigger candidates

Research findings for ticket [014](../plans/tickets/014-trigger-candidates.md): *which* triggers are
worth having, so [004](../plans/tickets/004-trigger-model.md) can decide how a **Trigger** is
modelled — or whether the **Trigger** component survives at all.

Durable facts, cited. Claims are marked **[repo]** where this document verified them by reading the
v1 source or the public `XDGFX/ultrasonics` tracker directly, **[docs]** where a primary source
states them, and **[uncertain]** where neither settles it.

## Summary

**The valuable set is small and server-owned.** Nothing found here supports an open-ended,
service-specific family of trigger plugins — and the strongest single argument against one is that
in six years nobody, anywhere, wrote a third-party ultrasonics trigger plugin, or asked for one
**[repo]**.

Four findings carry the decision:

1. **Nobody used the v1 webhook trigger.** Across all 51 issues, 983 comment lines, 0 discussions
   and 27 forks, the string "webhook" appears exactly **once** — inside a pasted stack trace, as a
   *plugin-discovery log line* from a user who was reporting an unrelated Plex bug **[repo]**. Worse,
   the plugin has been **structurally broken since Werkzeug 2.1.0 (28 March 2022)**, which removed
   the `werkzeug.server.shutdown` environ key it depends on **[docs]** — and in four years nobody
   filed a bug. It is also unreachable in the official Docker image, which only `EXPOSE`s 5000 while
   the webhook defaults to 5001 **[repo]**. This is about as clean an absence-of-evidence finding as
   is available.
2. **Scheduling is the paywall line at every competitor that has it** — Soundiiz, TuneMyMusic,
   FreeYourMusic and SongShift all gate recurring sync behind the paid tier, and Spotlistr has no
   scheduling at all **[docs]**. Daily is the market norm.
3. **An authenticated inbound webhook genuinely is the common denominator** for Home Assistant,
   Node-RED, IFTTT and Zapier. All four ship a built-in outbound HTTP action taking arbitrary URL,
   method, headers and body **[docs]**. So "integrate with Home Assistant" is *not* a distinct
   trigger — it is the webhook trigger plus a documented YAML snippet. The hypothesis in the ticket
   is **confirmed**.
4. **The outbound half is the one with observable demand.** The established pattern in the
   self-hosted media world is a tool POSTing *to* Home Assistant, not Home Assistant commanding the
   tool — Plex and Jellyfin both ship webhook senders and both have maintained HA blueprints
   **[docs]**. Nothing equivalent exists in the other direction.
5. **"New album by a followed artist" has no push mechanism at any music service** — polling only,
   everywhere **[docs]**. On Spotify the cheap shared-poll route (`GET /browse/new-releases`) is now
   deprecated and removed for Development Mode apps with no replacement, leaving an O(N-artists)
   per-account poll against a **per-app, shared, unpublished** rate limit. It also has **zero**
   demand evidence in the tracker.

> ⚠️ **Out-of-scope finding that outranks this ticket.** Establishing the polling cost surfaced that
> Spotify now caps Development Mode at **five authorised users**, and Extended Quota Mode requires a
> registered business with **≥250k MAUs** **[docs]**. That is a permission wall, not a rate limit,
> and it bears on ADR-0002 and ADR-0005 far more than on triggers. It does *not* affect **BYO**
> self-host. **Flagged, not resolved — it needs its own ticket.** See [§5](#the-finding-that-outranks-the-question).

**Recommendation for 004:** the valuable set is a **schedule** plus a **server-owned webhook pair**
(inbound trigger, outbound notification). Both are server capabilities, not plugins. That favours
deleting the **Trigger** component from the SDK and modelling triggers as applet configuration the
runner owns. See [Ranked candidates](#ranked-candidates).

## How this was verified

The v1 evidence comes from reading the source in this repo at commit `333e0ca` and from the GitHub
API against `XDGFX/ultrasonics` (275 stars, 27 forks, 40 open issues, 51 issues total, 18 PRs, **0
discussions**), read-only, per `docs/agents/issue-tracker.md`. Every issue body and every comment on
every issue was fetched and grepped. External claims are from vendor pricing pages and official
platform documentation, fetched directly.

**Search coverage gap:** reddit.com blocks the fetch agent, so no Reddit trace was searchable. The
project has no Discord, forum or mailing list — the README points contributors at GitHub issues and
nothing else **[repo]** — so the issue tracker really is the whole community record, which makes its
silence more meaningful than it would otherwise be.

---

## 1. Did anyone use the v1 webhook trigger?

**No evidence that anyone ever did. Substantial evidence that nobody could have, for the last four
years.**

### What was searched, and what was found

| Source | Coverage | "webhook" hits |
|---|---|---|
| Issue titles + bodies, all states | 51 issues | **1**, and it is a log line (below) |
| Issue comments | 983 lines across all issues | **0** |
| GitHub Discussions | feature returns `totalCount: 0` — never enabled | n/a |
| Pull requests | 18, all states | **0** |
| Project wiki | 4 pages (Home, Writing a Plugin, Settings Builders, `songs_dict`) | **0** — triggers are undocumented entirely |
| `README.md` | full file | **0** — triggers are described only as "The most simple trigger is time-based" |
| GitHub-wide code search (`up_webhook`) | — | **0** ultrasonics-related results |
| GitHub-wide repo search (third-party ultrasonics plugins) | — | **0** results |

The single hit, in issue [#31](https://github.com/XDGFX/ultrasonics/issues/31) (Oct 2021, "Spotify to
Plex"), is this, pasted by a user reporting an unrelated failure **[repo]**:

```
2021-10-08 20:48:31,984 - 🎧 webhook - DEBUG - LOG CREATED (logs.py:77)
2021-10-08 20:48:31,984 - plugins - INFO - Found plugin: <module 'ultrasonics.official_plugins.up_webhook' …>
```

That is v1's plugin loader importing every `up_*.py` at boot. It proves the file existed on disk. It
proves nothing about use. The same paste, a few lines later, shows what that user's applet actually
did:

```
plugins - ERROR - No trigger is supplied for applet 5e848834-… - will not run automatically.
```

— a user who built an applet with **no trigger at all**.

### The webhook has been broken since March 2022

`up_webhook.py` shuts its per-applet Flask server down like this **[repo]**:

```python
func = request.environ.get('werkzeug.server.shutdown')
if func is None:
    raise RuntimeError('Not running with the Werkzeug Server')
func()
log.info(f"Applet triggered: {applet_id}")
```

Werkzeug **2.1.0**, released **28 March 2022**, removed that key. The changelog entry reads: *"Remove
the non-standard `shutdown` function from the WSGI environ when running the development server. See
the docs for alternatives."* (<https://werkzeug.palletsprojects.com/en/stable/changes/>) **[docs]**

`requirements.txt` pins `Flask==2.0.1` but **does not pin Werkzeug** **[repo]** — which is precisely
the failure reported in the most recent open issue,
[#66](https://github.com/XDGFX/ultrasonics/issues/66) ("Version issue in Flask 2.0.1 with Werkzeug",
Mar 2025, 3 comments). So on any install since March 2022 that resolved a modern Werkzeug, a GET to
the webhook endpoint raises `RuntimeError` *before* the `log.info` line — the applet never triggers,
and the log never even says it was hit.

**Four years, 275 stars, and not one bug report.** Users report Plex path bugs, fuzzy-ratio crashes,
Spotify `NoneType` errors and Docker tags in detail. A trigger that silently fails to fire generated
nothing.

### It was also unreachable by default

- The plugin binds its **own** Flask server on a **separate port per applet**, defaulting to 5001,
  and the builder text warns the port "cannot be the same as ultrasonics (5000) or any other
  instance of the webhook trigger" — so *every additional applet needs its own port* **[repo]**.
- The `Dockerfile` contains a single `EXPOSE 5000` **[repo]**. Docker is the primary distribution
  route (`xdgfx/ultrasonics`, plus `ghcr.io/xdgfx/ultrasonics` from Dec 2024). A user would have to
  work out the per-applet port and publish it by hand.
- Neither the README nor the wiki mentions the webhook at all, so there was nothing to copy.

### Development history

Three commits, all in the first fortnight of the plugin's life, then silence **[repo]**:

```
8f2bf9f 2020-09-04 Created webhook trigger plugin
f618aa9 2020-09-06 Fixed webhook (doesn't work with Debug=True)
d75a62a 2020-09-12 Add required toggle for settings, fix up_spotify
```

Untouched for ~6 years, including through the 1.1.0 and 1.2.0 releases.

### By contrast, the time trigger demonstrably *was* used

This is the control that makes the webhook's silence meaningful — the same tracker does contain
evidence for the other trigger:

- **Community-contributed, then twice improved by its author.** PRs
  [#1](https://github.com/XDGFX/ultrasonics/pull/1), [#2](https://github.com/XDGFX/ultrasonics/pull/2)
  and [#16](https://github.com/XDGFX/ultrasonics/pull/16), all by `AspanishDude`, Aug–Sep 2020 — the
  only trigger anyone outside the maintainer ever wrote **[repo]**.
- **It appears in real users' logs**, unprompted, in at least three separate issues — e.g.
  [#42](https://github.com/XDGFX/ultrasonics/issues/42): `time trigger - INFO - Applet fb19ef4a-… will
  run in 86261 seconds…` (a ~24-hour interval), and the same line in
  [#46](https://github.com/XDGFX/ultrasonics/issues/46) and [#31](https://github.com/XDGFX/ultrasonics/issues/31)
  **[repo]**.

### And nobody asked for *anything* trigger-shaped

Every trigger-adjacent issue in the tracker was filed by the maintainer, not a user **[repo]**:

- [#3](https://github.com/XDGFX/ultrasonics/issues/3) — the AND-should-be-OR bug (Sep 2020, 0
  comments, still open).
- [#6](https://github.com/XDGFX/ultrasonics/issues/6) — update homepage when an applet completes.
- [#12](https://github.com/XDGFX/ultrasonics/issues/12) — auto-retry after a failure.
- [#20](https://github.com/XDGFX/ultrasonics/issues/20) — logs should say *why* an applet was
  triggered.

Grepping every issue and comment for `notif|discord|telegram|pushover|gotify|ntfy` returned **zero**
**[repo]**. There is no recorded user demand for notifications either. What users actually asked for
was **more services** — Tidal (#44), YouTube (#43), Apple Music (#55, #37) — and for the existing
sync to stop crashing.

**Honest reading.** This is genuine absence of evidence, and it should not be inflated into evidence
of absence of *need*. A feature that is undocumented, unreachable in Docker, and silently broken
cannot generate demand signal — its silence is over-determined. What can be said firmly is: **there
is no user pulling on this rope**, so the webhook must be justified on forward-looking grounds
(§4), not on v1 usage. It has none.

---

## 2. What do comparable tools offer as triggers?

**Scheduling is the paywalled feature at every competitor that offers it.** That is the ticket's
hypothesis and it holds without exception.

| Tool | Feature name | On free tier? | Cheapest tier with it | Documented frequency |
|---|---|---|---|---|
| **Soundiiz** | "Sync" / "Auto-sync" | 1 slot only | Premium (~A$9/mo, A$72/yr) | **Daily, weekly or monthly** (user choice) |
| **TuneMyMusic** | "Auto daily sync" | **No** | Premium ($2/mo billed annually) | **Daily** |
| **FreeYourMusic** | "Auto-Sync" | **No** | Premium Quarterly (€5/mo) | **Every 15 minutes** |
| **SongShift** | "Playlist sync monitoring" | **No** | Pro ($6.99/mo, $29.99/yr) | **Not documented** |
| **Spotlistr** | — | n/a | n/a | **No scheduling at all** |

Primary sources and exact wording:

- **Soundiiz** — *"Run your sync **daily** for always-fresh playlists"*, *"**weekly** for lighter
  recurring updates"*, *"**monthly** for low-maintenance syncing"*, and *"Auto-sync is available with
  Premium and Creator plans."* (<https://soundiiz.com/auto-sync-playlist>) **[docs]** Pricing shows
  Free with *"Only one Sync slot"*, Premium *"Include 20 Syncs"*, Creator *"Include 50 Syncs"*
  (<https://soundiiz.com/pricing>) **[docs]**. Notably, **hour-level scheduling is explicitly not
  offered** — a support article is titled *"Why I can't select a specific hour for a Sync
  execution?"* **[docs]**, and the paid-only *"Run now"* button is documented as *"limited to paid
  offers only"* **[docs]**.
- **TuneMyMusic** — *"we monitor your playlists on a **daily** basis and copy any changes made to
  source playlists to the target playlists"*, with a choice of *"Mirror method"* or *"Add only
  method"* (<https://www.tunemymusic.com/features/sync>) **[docs]**. Premium is capped at *"Up to 20
  auto daily syncs"* (<https://www.tunemymusic.com/plans>) **[docs]**.
- **FreeYourMusic** — the market outlier on frequency: *"**Every 15 minutes** we push new additions
  across so both libraries stay identical"* (<https://freeyourmusic.com/>) **[docs]**.
- **SongShift** — *"ongoing playlist sync monitoring"* is a Pro feature; *"Monitor a Shift's source
  for changes, automatically matching new songs **for review**"* (<https://www.songshift.com/pro>)
  **[docs]**. The "for review" wording suggests it is semi-automatic, queuing matches for
  confirmation. **No interval is documented anywhere on their site.**
- **Spotlistr** — purely one-shot conversion on a prepaid-credit model; no recurring sync
  (<https://www.spotlistr.com/pricing>) **[docs]**.

### The self-hosted comparables converge even harder

The tools ultrasonics actually competes with for self-hosters are all **interval-only**, with no
trigger concept at all **[docs]**:

| Tool | Trigger mechanism | Default |
|---|---|---|
| [Plexist](https://github.com/Gyarbij/Plexist) (103★) | `SECONDS_TO_WAIT` env var | `84000` (~23.3 h) |
| [plex-playlist-sync](https://github.com/rnagabhyrava/plex-playlist-sync) | `SECONDS_TO_WAIT` env var | `84000` |
| [spotify-to-plex](https://github.com/cmathews393/spotify-to-plex) | `CRON_SCHEDULE` env var | daily at midnight |

None of the three offers an inbound webhook or an on-demand API endpoint **[docs]**.

### No competitor offers a webhook trigger

Checked across all of the above: **none exposes a webhook, Zapier or IFTTT integration for triggering
a transfer** **[docs]**. The only user-invokable non-schedule control in the entire market is
Soundiiz's paid-only "Run now" button.

Two things follow, and they pull in opposite directions:

- **For:** an inbound webhook would be a genuine differentiator — nobody else has one, and it is the
  natural fit for the homelab audience ultrasonics already has.
- **Against:** nobody else has one *and* they are all commercially successful, which is weak evidence
  that the market does not require it.

The **scheduling** signal, by contrast, is unambiguous and one-directional: it is what everyone
charges for.

**Gaps.** SongShift's interval is undocumented. Soundiiz's prices were served in AUD by
geo-detection and should be re-checked in GBP before being quoted. Whether Soundiiz's *User API
(BETA)* can trigger a sync could **not be determined** — <https://soundiiz.com/api/doc> renders its
endpoint list client-side and returned nothing to two separate fetch attempts **[uncertain]**. That
is the one open question that could change "no competitor offers a user-invokable trigger".

---

## 3. Feasibility per deployment

The hosted tier launches **cloud-services-only** and cannot reach a home network (`CONTEXT.md`); this
section asks which candidates split along that line.

| Candidate | Hosted | Self-host | Why |
|---|---|---|---|
| **Schedule** (every N hours / cron) | ✅ | ✅ | Pure server timer. No network reach, no service API. |
| **Manual "run now"** | ✅ | ✅ | Already implicit in v1; a button, not a trigger. |
| **Inbound webhook** (authenticated endpoint on our server) | ✅ | ⚠️ **caveat** | On hosted, our server has a public URL, so anything on the internet can call it. **On self-host the box typically has no public DNS** — the same constraint ADR-0008 already accepted for OAuth callbacks. Callers on the same LAN (Home Assistant, Node-RED, Plex) reach it fine; internet callers (IFTTT, Zapier) need the user to expose it. |
| **Outbound webhook** (we POST on completion) | ✅ | ✅ | Egress only. Works in both; on self-host it can reach *both* LAN and internet targets, so it is if anything **better** on self-host. |
| **Local file/folder watch** | ❌ | ✅ | Self-host-only by construction. Deferred to the **home agent** (A2) for hosted. |
| **Plex `library.new` webhook** | ❌ | ✅ | Plex POSTs to our endpoint; a cloud server is not reachable from the user's LAN. Also requires **Plex Pass** **[docs]**. |
| **Service event ("new album by followed artist")** | ✅ | ✅ | Cloud API on both sides — but see §5 for what it costs. |

Three observations worth carrying into 004:

1. **The inbound/outbound webhook split is not symmetric, and the asymmetry favours outbound.**
   Outbound works everywhere with no reachability question at all. Inbound is fully capable on hosted
   but partially blocked on self-host — the inverse of the usual pattern, where self-host is the more
   capable deployment. Note this is a *reachability* limitation, not a product one: the LAN
   callers that matter most to a homelab user (Home Assistant, Node-RED, Plex) are on the same
   network and work fine.
2. **Local file watching is the only hard binary split**, and it was already known. Nothing else is
   hosted-impossible in the way local files are.
3. **The Plex webhook is the interesting case**, because it needs *no Plex-specific code*. If our
   inbound webhook endpoint accepts a POST and ignores the body, Plex's `library.new` event becomes a
   trigger for free — the plugin surface is zero. One constraint: Plex posts
   `multipart/form-data` with a JSON `payload` part, not a JSON body **[docs]**, so **the endpoint
   must not require a JSON content type**.

---

## 4. Generic hooks — is an inbound webhook the common denominator?

**Confirmed.** All four platforms ship a built-in outbound HTTP action taking an arbitrary URL,
method, headers and body. None needs OAuth, a published app listing, a polling API or a service
manifest.

| Platform | Outbound mechanism | Arbitrary method? | Custom headers? |
|---|---|---|---|
| **Home Assistant** | [`rest_command`](https://www.home-assistant.io/integrations/rest_command/) | `get, patch, post, put, delete` | yes — `headers` map |
| **Node-RED** | [`http request` node](https://cookbook.nodered.org/http/set-request-header) | `GET, PUT, POST, PATCH, DELETE` | yes — `msg.headers`, plus a native **bearer authentication** option in the node UI |
| **IFTTT** | [Webhooks "Make a web request"](https://ifttt.com/maker_webhooks/actions/make_web_request) | yes | yes — *"Each header should be on a new line formatted as `Some-Header: Some-Value`"* |
| **Zapier** | [Webhooks by Zapier](https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zaps) | GET/POST/PUT, plus **Custom Request** for PATCH/DELETE | yes — Headers field + Basic Auth |

Home Assistant's own documentation example sets an auth header directly **[docs]**:

```yaml
headers:
  authorization: !secret rest_headers_secret
  accept: "application/json, text/html"
```

**So "integrate with Home Assistant" collapses into "the webhook trigger plus documentation."** It is
not a distinct trigger, it does not need a Home Assistant plugin, and the same is true of Node-RED,
IFTTT and Zapier. This is the significant finding the ticket was after, and it is clean.

### What our endpoint must accept

All four can set `Authorization: Bearer <token>`, so that should be the **documented preferred**
form. But the true lowest common denominator — surviving a user pasting a URL into a box with no
header field, IFTTT's line-formatted header quirk, and Zapier's "extremely customized headers"
caveat — is a **token embedded in the URL path**. There is strong precedent: Home Assistant's own
webhook endpoint (`/api/webhook/<webhook_id>`) and IFTTT's maker URL
(`https://maker.ifttt.com/trigger/{event}/with/key/{key}`) both put the secret in the path **[docs]**.

**Recommendation:** accept both — `Authorization: Bearer <token>` *and* `/api/hooks/<token>/run` —
and require no particular content type (see the Plex constraint in §3).

### The commercial caveat

This is not visible from the technical docs and matters for how much the inbound half is worth
**[docs]**:

- **IFTTT** — *every* Webhooks capability is Pro-badged. Free is $0 with **2 Applets and no
  webhooks**; Pro is $2.99/mo (<https://ifttt.com/plans>). An IFTTT free user cannot integrate at
  all, in either direction.
- **Zapier** — Webhooks by Zapier is a premium app; both help pages carry the plan matrix
  *"Free ✗ / Professional ✓ / Team ✓ / Enterprise ✓"*.
- **Home Assistant and Node-RED are free and self-hosted** — and are also the two most likely to be
  running in the same house as an ultrasonics box.

So the realistic audience for the inbound webhook is **Home Assistant and Node-RED users**, i.e.
self-hosters — the deployment where our endpoint is *least* reachable from outside the LAN, though
these two callers are inside it anyway.

### Outbound looks like the more valuable half

Asked which direction users actually want, the evidence — thin, but one-directional — points at
**outbound**, i.e. ultrasonics notifying the automation platform on sync completion.

The established pattern in the self-hosted media world is media-tool → Home Assistant, and there are
maintained community blueprints for exactly that **[docs]**:

- [Jellyfin Webhook v2](https://community.home-assistant.io/t/jellyfin-webhook-v2/898289) — Jellyfin's
  webhook plugin POSTs to `http://{ha_ip}:{ha_port}/api/webhook/{webhook_id}`.
- [Plex Webhook Handler](https://community.home-assistant.io/t/plex-webhook-handler/876339), plus
  older threads ([#72879](https://community.home-assistant.io/t/plex-webhook-trigger-help/72879),
  [#73095](https://community.home-assistant.io/t/plex-webhooks-wip/73095)).

**No equivalent body of threads exists asking to *command* a self-hosted media tool from Home
Assistant** — but that is search-result evidence of what has been *built*, not a survey of what has
been *asked for*, and absence of threads is weak. Treat it as suggestive, not settled. **[uncertain]**

What is firm is the cost side: receiving is plain POST-to-a-URL with **no auth handshake** on all
four **[docs]**, so our outbound side needs exactly one feature — *"POST this JSON to this URL,
optionally with extra headers"* — one config field, no per-platform code.

| Platform | Receiving URL format | Auth |
|---|---|---|
| Home Assistant | `http://<ha>:8123/api/webhook/<webhook_id>` | *"don't require authentication, other than knowing a valid webhook ID"*; POST/PUT/HEAD/GET, PUT recommended; needs `local_only: false` for internet access |
| Node-RED | user-defined path, e.g. `http://<host>:1880/<path>` | needs a paired `http response` node; optional global basic auth via `httpNodeAuth` |
| IFTTT | `https://maker.ifttt.com/trigger/{event}/json/with/key/{key}` | key in path |
| Zapier | `https://hooks.zapier.com/hooks/catch/{id}/{hash}` | the URL itself; 10 MB parsed / 2 MB raw |

**One point that cuts against dropping the inbound webhook entirely:** `roadmap.md` already justifies
dropping the v1 `system command` output plugin on the grounds that *"the self-host use case is served
by the webhook trigger and the CLI runner"* **[repo]**. Removing the webhook without noticing would
quietly invalidate that argument. The CLI runner still covers it, but the reasoning should be
restated rather than left dangling.

---

## 5. Service-event triggers — "a followed artist released a new album"

**No music service offers a webhook or push event for this. Not one.** Detection is polling-only
everywhere — Spotify, Last.fm, Deezer, Apple Music, MusicBrainz. The industry norm is polling, and
this candidate therefore becomes recurring server work the hosted tier pays for, by construction.

Spotify has no webhook, callback, subscription or event-stream mechanism anywhere in the Web API
**[docs]**. (The only "event loop" in Spotify's documentation belongs to *Commercial Hardware*, an
embedded-device SDK, not the Web API.) Apple operates webhooks only in the App Store Connect API — a
different product entirely **[docs]**. Last.fm's documentation covers REST and XML-RPC request styles
only.

### The finding that outranks the question

While establishing the polling cost, the research turned up something that matters more than the
trigger decision and is **outside this ticket's scope but should not wait for a ticket of its own**.

Spotify's [Update on Developer Access and Platform Security](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
(6 Feb 2026) states, for new Client IDs from **11 February 2026** — verified directly **[docs]**:

> "Development Mode use will require a Spotify Premium account"
> "Developers will be limited to one Development Mode Client ID"
> "Each Client ID will be limited to up to **five authorized users**"
> "API access will be limited to a smaller set of supported endpoints"

Applied to existing integrations from **9 March 2026**, though Spotify subsequently *"decided to
postpone endpoint access changes for existing integrations"* **[docs]**.

And [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes),
verified directly **[docs]**:

> "Up to 5 authenticated Spotify users can use an app that is in development mode."
> "The app owner must have a Spotify Premium account for apps in development mode to function."

Extended Quota Mode — the only way past that cap — has accepted applications *from organisations
only* since 15 May 2025, and requires **"Maintaining a minimum of active users (at least 250k
MAUs)"** alongside an established legal entity, a launched service, availability in key Spotify
markets and demonstrated commercial viability **[docs]**.

**Read plainly: a hosted ultrasonics is capped at five Spotify users unless it is already a
registered business with a quarter of a million monthly actives. There is no intermediate tier.** The
1,000-account scenario this section was asked to cost is not rate-limited — it is not permitted.

This bears on ADR-0002 (hosted SaaS revenue model) and ADR-0005 (`AuthProvider`, and specifically
whether **Proxy** is viable for Spotify at all) far more than it bears on triggers. It does **not**
affect **BYO** self-host, where each self-hoster registers their own app and consumes their own
five-user allowance — which is, if anything, an argument that BYO was the right default. **Flagged
for a decision outside this ticket; not resolved here.**

### Can the event be obtained at all?

Yes, but only by polling, and the cheap route on Spotify has just been closed.

| Endpoint | Status | Detail |
|---|---|---|
| `GET /me/following?type=artist` | **Available**, both quota modes | Scope `user-follow-read`; *"Default: 20. Minimum: 1. Maximum: 50."*; cursor-paginated via `after` |
| `GET /artists/{id}/albums` | Available, no deprecation banner | `include_groups`, `market`, `offset`. **`limit` max is 10**, not 50. No date filter, no documented sort order |
| `GET /browse/new-releases` | **Deprecated banner; removed for Development Mode** | Editorially *"featured on Spotify"* — market-wide, **not personalised** to followed artists |
| `GET /artists` (Several Artists) | **Deprecated; removed for Development Mode** | Batch artist hydration is gone |

Two details worth pinning: `/artists/{id}/albums` caps `limit` at **10** — the February 2026
changelog documents the equivalent reduction only for `/search`, so the reason for this one is
**[uncertain]** though the value is verified live. And Spotify **nowhere promises newest-first
ordering**, so using `limit=1` as a cheap "latest album" probe is undocumented behaviour and unsafe.

The November 2024 deprecation the ticket may have had in mind — Related Artists, Recommendations,
Audio Features, Audio Analysis, Featured Playlists, Category Playlists, 30-second previews and
algorithmic/editorial playlists (<https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api>)
**[docs]** — did **not** touch `new-releases`, `me/following` or `artists/{id}/albums`. That only
changed in February 2026. Note the implication: this answer had a materially different shape six
months ago, so it should be re-checked before anything is built on it.

**Last.fm:** `user.getNewReleases` **no longer exists** — the URL 404s and the method is absent from
the API index **[docs]**. There is no new-releases or recommended-releases method of any kind in the
current API. `artist.getInfo` returns no release dates. On rate limits, the historic "5 requests per
second per IP averaged over 5 minutes" figure is **absent from the current Terms of Service**; clause
4.4 now reads only *"Last.fm sets and enforces limits on use of the API… in our sole discretion"*
(<https://www.last.fm/api/tos>) **[docs]**. That is worse for planning, not better.

**Deezer:** could **not be verified from primary sources at all** — `developers.deezer.com/api` and
its sub-pages are login-gated and return navigation chrome only. That is itself a finding: Deezer's
API cannot be evaluated without registering. Deezer's support site confirms *"there is no limitation
on data in the API, but there is a query quota"* **[docs]** while publishing no number anywhere
reachable. The widely-repeated "50 requests per 5 seconds" is **secondary-source only and
unconfirmed** **[uncertain]**, as are `/user/me/artists`, `/editorial/{id}/releases` and `/chart`.
Whether new registration is open could not be determined.

### Polling cost, per account, per interval

Assuming Extended Quota Mode (otherwise moot at five users). Post-February-2026 the batch
`GET /artists` hydration is gone, so step 2 is irreducibly one request per artist:

1. `GET /me/following?type=artist&limit=50` → `ceil(N/50)` requests
2. `GET /artists/{id}/albums?include_groups=album,single&limit=10` → **1 request per artist**

| Followed artists | Per cycle | Daily poll | 6-hourly poll |
|---:|---:|---:|---:|
| 50 | 51 | 51/day | 204/day |
| 200 | 204 | 204/day | 816/day |
| 500 | 510 | 510/day | 2,040/day |

**At 1,000 hosted accounts** (200 artists average, 6-hourly): 816,000 requests/day = **~9.4 req/s
sustained**, or **~283 requests per rolling 30-second window** if perfectly smoothed — and **204,000
in a burst four times a day** if cycles are not staggered.

**The limit is per-app, not per-user.** Spotify's rate-limit page states the limit *"is calculated
based on the number of calls that **your app** makes to Spotify in a rolling 30 second window"*
**[docs]**, and from July 2026 quota is counted **per developer account**, shared across Client IDs.
So all 1,000 users land in one bucket with no per-user isolation. **Spotify publishes no number for
either mode** — so the breach margin cannot be calculated in advance, only discovered empirically via
`429` and `Retry-After`. An unpublished, per-app, shared limit is the worst shape to design against.

### The cheap architecture, and why it must not be Spotify's

A single shared market-wide poll — one `new-releases` fetch for *all* users, then diffing locally
against each user's followed-artist list at zero API cost — would be roughly **1,400× cheaper**
(~580 requests/day versus 816,000). But on Spotify it is now unavailable: `new-releases` is
deprecated and removed for dev mode with **no replacement offered in the migration guide**, its
coverage is *editorial* rather than the complete release firehose (so long-tail and independent
artists — exactly the ones a follow-based feature exists to serve — would be silently missed), and
market scoping is awkward.

**The shape that survives is to invert the dependency.** Use **ListenBrainz** as the event source and
Spotify only as the taste source. ListenBrainz documents two genuinely relevant endpoints **[docs]**:

- `GET /1/explore/fresh-releases/` — *"fetches upcoming and recently released (fresh) releases"*;
  `release_date` pivot, `days` (max 90), `sort`, `past`, `future`.
- `GET /1/user/{user_name}/fresh_releases` — *"Get fresh releases data for the given user."*
  `days` default 14, max 90.

It also publishes proper `X-RateLimit-Limit` / `-Remaining` / `-Reset-In` headers, making the limit
self-describing at runtime — the best-engineered rate limiting of anything surveyed
(<https://listenbrainz.readthedocs.io/en/latest/users/api/misc.html>). MusicBrainz's
[Live Data Feed](https://musicbrainz.org/doc/Live_Data_Feed) is the other option, but it is *polled
replication requiring a full local mirror*, not push, and is CC-BY-NC-SA with commercial use
requiring a MetaBrainz agreement **[docs]**.

Under that inversion, 1,000 accounts refreshing follow-lists daily at 200 artists each costs ~4,000
Spotify requests/day (~0.05 req/s) — comfortable under any plausible limit. The caveat is that
ListenBrainz's per-user feed profiles *listening history*, not an explicit follow list, so it is a
**different signal** from "artists I follow on Spotify" and would need to be described honestly to
users.

**Verdict on this candidate:** obtainable, but only as polling; expensive in the obvious design;
viable only via a third-party event source; and gated behind a Spotify quota wall that a hosted
ultrasonics cannot currently clear. It is also **the only candidate here with zero demand evidence in
the tracker** — no issue or comment ever asked for it **[repo]**.

---

## Ranked candidates

Ranked by *value per unit of cost and risk*. Cost classes: **trivial** (server timer or one HTTP
handler), **small** (one subsystem, no external dependency), **moderate** (external dependency or
recurring work), **heavy** (recurring per-account server work plus platform risk).

### 1. Schedule — every N hours / cron

- **What it does.** Runs an applet on a recurring interval. v1's `time trigger`, re-architected
  around the v2 scheduler instead of blocking in `time.sleep`.
- **Evidence of demand.** The strongest of any candidate, from two independent directions.
  *Internal:* the only trigger with observed real-world use — community-contributed via PRs
  [#1](https://github.com/XDGFX/ultrasonics/pull/1) / [#2](https://github.com/XDGFX/ultrasonics/pull/2)
  / [#16](https://github.com/XDGFX/ultrasonics/pull/16), and visible unprompted in users' pasted logs
  in issues [#42](https://github.com/XDGFX/ultrasonics/issues/42),
  [#46](https://github.com/XDGFX/ultrasonics/issues/46) and
  [#31](https://github.com/XDGFX/ultrasonics/issues/31). *External:* it is the **paywalled** feature at
  Soundiiz, TuneMyMusic, FreeYourMusic and SongShift, and the *only* mechanism the self-hosted
  comparables (Plexist, plex-playlist-sync, spotify-to-plex) offer at all.
- **Deployment.** **Both.** Pure server timer; no network reach, no service API.
- **Needs.** Our own server only.
- **Cost class.** **Trivial.**
- **Note for 004.** Market norm is *daily*; Soundiiz explicitly declines to offer hour-of-day
  selection. Only FreeYourMusic goes to 15 minutes. So a coarse interval is competitive and cheap —
  hourly granularity is not table stakes.

### 2. Inbound webhook — authenticated endpoint that runs an applet

- **What it does.** One authenticated HTTP endpoint per applet. Anything that can make an HTTP
  request runs the applet.
- **Evidence of demand.** **Genuinely none, and that must be stated plainly.** Zero traces in 51
  issues, 983 comment lines, 0 discussions, 18 PRs, the wiki or the README; zero third-party trigger
  plugins ever written. The v1 implementation has been broken since Werkzeug 2.1.0 (March 2022) and
  nobody noticed in four years. **However**, that silence is over-determined — the feature was
  undocumented, unreachable in the default Docker image, and silently failing, so it could not have
  generated signal either way. The forward-looking case (§4) is what justifies it, not v1.
- **Deployment.** **Both, asymmetrically.** Fully capable hosted. On self-host the box usually has no
  public DNS (the same constraint ADR-0008 accepted for OAuth callbacks), so internet callers need
  the user to expose it — but the callers that matter to a homelab user (Home Assistant, Node-RED,
  Plex) are on the same LAN and work unchanged.
- **Needs.** Our own server only. **No service API, and no per-platform code whatsoever.**
- **Cost class.** **Trivial** — one route, one token check.
- **Why it ranks this high despite zero demand evidence.** It is the single highest-leverage item
  here. It collapses *four* separate integration asks (Home Assistant, Node-RED, IFTTT, Zapier) into
  one endpoint plus documentation, confirmed in §4. It absorbs the **Plex `library.new`** trigger for
  free. It restores the `roadmap.md` justification for dropping `system command`. And no competitor
  offers anything like it, so it is a real differentiator for the homelab audience. **Design
  constraints:** accept `Authorization: Bearer <token>` *and* a URL-path token, and do **not** require
  a JSON content type (Plex posts `multipart/form-data`).

### 3. Outbound webhook — POST on sync completion

- **What it does.** POSTs a JSON summary to a user-supplied URL when an applet finishes. Strictly
  *not* a trigger — it is the other half of the automation story, and the ticket asked whether it is
  the more requested half.
- **Evidence of demand.** **Weak but the best available, and it points here rather than at inbound.**
  The established pattern in self-hosted media is tool → Home Assistant: both Plex and Jellyfin ship
  webhook senders, and both have maintained HA community blueprints
  ([Jellyfin Webhook v2](https://community.home-assistant.io/t/jellyfin-webhook-v2/898289),
  [Plex Webhook Handler](https://community.home-assistant.io/t/plex-webhook-handler/876339)). No
  equivalent body of threads exists for commanding a media tool *from* HA. Caveat: this is evidence of
  what has been *built*, not a survey of what is *asked for* — treat as suggestive **[uncertain]**.
  Internally, demand is zero: grepping every issue and comment for
  `notif|discord|telegram|pushover|gotify|ntfy` returned nothing **[repo]**.
- **Deployment.** **Both** — and slightly *better* on self-host, since egress reaches both LAN and
  internet targets. No reachability question at all.
- **Needs.** Our own server only. All four platforms receive a plain POST with **no auth handshake**,
  so this is one config field, not four integrations.
- **Cost class.** **Trivial-to-small** (add retry/backoff and it is small).

### 4. Manual "run now"

- **What it does.** A button. Already present in v1 and not really a trigger, but worth naming
  because Soundiiz charges for it — *"limited to paid offers only"* **[docs]** — which makes it a
  plausible hosted freemium lever rather than a given.
- **Deployment.** Both. **Needs:** our server only. **Cost class:** trivial.

### 5. Local file / folder watch

- **What it does.** Runs an applet when a watched music directory or playlist folder changes.
- **Evidence of demand.** None directly. Indirect only: local-file plugins are a real part of v1's
  catalogue (`local playlists`, `local music database`) and self-host is explicitly the deployment
  that reaches them.
- **Deployment.** **Self-host only, by construction.** Hosted cannot reach a home network; this waits
  on the **home agent** (A2) and is out of scope for the first hosted launch.
- **Needs.** Filesystem access only.
- **Cost class.** **Small**, but it carries the operational tail that file watchers always have
  (debouncing, recursive watch limits, network shares where events do not fire at all).
- **Note.** This is the one candidate that genuinely splits the product, and it was already known to.
  Given that a schedule covers the same need adequately for a local library, it is hard to justify
  ahead of items 1–3.

### 6. Plex `library.new` — *not a separate candidate*

Listed for completeness because it looks like one. Plex ships outbound webhooks (**Plex Pass
required**) with a `library.new` event that fires when a new item is added to a library **[docs]**. It
needs **no Plex-specific code** — it is candidate 2 with a different caller. Self-host only, since a
cloud endpoint is not reachable from the user's LAN. Cost: **zero beyond candidate 2**, provided the
endpoint tolerates `multipart/form-data`.

### 7. Service event — "a followed artist released a new album"

- **What it does.** Runs an applet when an artist the user follows releases something.
- **Evidence of demand.** **Zero.** No issue or comment ever asked for it **[repo]**. It originates as
  a hypothesis in the ticket, not from users. What users actually asked for repeatedly was *more
  services* — Tidal (#44), YouTube (#43), Apple Music (#55, #37).
- **Deployment.** Both in principle.
- **Needs.** A service API, and — in the only viable design — a **third-party** one (ListenBrainz or
  a MusicBrainz mirror) rather than the music service itself.
- **Cost class.** **Heavy.** No push exists anywhere, so it is recurring per-account server work the
  hosted tier funds: ~816,000 Spotify requests/day at 1,000 accounts in the naive design, against a
  **per-app, shared, unpublished** rate limit. The cheap shared-poll design is unavailable on Spotify
  (`new-releases` deprecated and removed for dev mode, no replacement, editorial coverage only).
- **Blocked regardless.** Spotify caps Development Mode at **five authorised users**, and Extended
  Quota Mode requires a registered business with **≥250k MAUs** **[docs]**. Not a rate-limit problem —
  a permission problem.
- **If it is ever built:** invert the dependency — ListenBrainz `fresh-releases` as the event source,
  Spotify only for the follow list. And be honest that ListenBrainz profiles listening history rather
  than an explicit follow list, so it answers a subtly different question.

### Summary table

| # | Candidate | Demand evidence | Hosted | Self-host | Needs service API? | Cost |
|---|---|---|---|---|---|---|
| 1 | **Schedule** | **Strong** (internal + market) | ✅ | ✅ | No | Trivial |
| 2 | **Inbound webhook** | **None** — but 4-in-1 leverage | ✅ | ⚠️ LAN callers fine | No | Trivial |
| 3 | **Outbound webhook** | Weak, but best available | ✅ | ✅ | No | Trivial–small |
| 4 | Manual run-now | n/a (exists) | ✅ | ✅ | No | Trivial |
| 5 | Local file watch | None direct | ❌ | ✅ | No | Small |
| 6 | Plex `library.new` | None | ❌ | ✅ | No (= #2) | Zero beyond #2 |
| 7 | Service event | **Zero** | ⛔ blocked | ⚠️ BYO only | **Yes** | **Heavy** |

---

## What this means for ticket 004

The ticket set up the fork explicitly: *"a small server-owned set favours deleting the Trigger
component from the SDK; an open-ended service-specific set favours keeping a trigger plugin shape."*

**The evidence lands firmly on the first branch.** Candidates 1–4 are all **server capabilities** —
a timer, an HTTP route in, an HTTP route out, a button. None of them is a plugin. None needs a
handshake, per-applet settings schema, `run()`, or credentials. Candidate 5 is self-host-only and
deferrable. Candidate 6 is candidate 2 wearing a hat. Candidate 7 — the *only* one that would have
justified a service-specific plugin family — has zero demand evidence, no push mechanism anywhere in
the industry, heavy recurring cost, and is currently blocked outright by Spotify's quota policy.

Three supporting observations:

- **In six years nobody wrote a third-party trigger plugin, and the plugin shape attracted no
  extension** — while the *service* plugins attracted repeated requests and at least one substantial
  third-party contribution (the TIDAL PR, [#45](https://github.com/XDGFX/ultrasonics/pull/45)). The
  extensibility that earned its keep in v1 was on the Input/Output axis, not the Trigger axis.
- **The `plugin-sdk-v2.md` sketch had already reached the same conclusion by accident** — ticket 004
  notes `RunContext.component` is typed `"inputs" | "modifiers" | "outputs"`, with triggers absent.
- **The AND→OR bug (issue [#3](https://github.com/XDGFX/ultrasonics/issues/3)) dissolves** if triggers
  are applet configuration rather than plugins that must each "complete". Any of several independent
  sources may fire the applet; there is no sequence to get wrong. That is a runner semantic, exactly
  as `CONTEXT.md` says.

If 004 keeps a Trigger component anyway, the case must rest on optionality for candidate 7 — and this
document's finding is that candidate 7 is the weakest item on the list, not the strongest.

## Confidence and gaps

**High confidence, verified in-repo or against the live tracker [repo]:** the complete absence of
webhook usage evidence across issues, comments, discussions, PRs, wiki, README and GitHub-wide code
search; the `werkzeug.server.shutdown` dependency in `up_webhook.py`; the unpinned Werkzeug in
`requirements.txt`; the single `EXPOSE 5000` in the `Dockerfile`; the webhook's three-commit history
ending September 2020; the time trigger's PR provenance and its appearance in three users' logs; the
zero-result greps for notification demand; the absence of any third-party trigger plugin.

**High confidence, from primary docs [docs]:** Werkzeug 2.1.0's removal of the shutdown key;
competitor scheduling tiers and frequencies; `rest_command`, Node-RED `http request`, IFTTT Webhooks
and Zapier Webhooks all supporting arbitrary method/URL/headers; the IFTTT and Zapier paywalls; the
four inbound URL formats; Spotify's five-user Development Mode cap and the 250k-MAU Extended Quota
criterion (both re-verified directly against Spotify's pages for this document); Spotify's per-app
rolling-30-second rate limit with no published number; `new-releases` and `GET /artists` deprecation;
`me/following` limit 50 and cursor pagination; the November 2024 deprecation list; the removal of
`user.getNewReleases`; Last.fm's "sole discretion" clause; ListenBrainz's `fresh-releases` endpoints;
Plex webhooks requiring Plex Pass.

**Gaps, and how to close them:**

- **Reddit was not searchable** — reddit.com blocks the fetch agent. The project has no Discord or
  forum, so the issue tracker is the whole community record, but a manual Reddit search of
  r/selfhosted and r/PleX for "ultrasonics" would close this cheaply.
- **Whether Soundiiz's User API (BETA) can trigger a sync** could not be determined —
  <https://soundiiz.com/api/doc> renders client-side and returned nothing to repeated fetches. This is
  the one open question that could overturn "no competitor offers a user-invokable trigger".
- **SongShift's sync interval** is documented nowhere on their site.
- **Soundiiz pricing was served in AUD** by geo-detection; re-check in GBP before quoting.
- **Deezer's API could not be assessed at all** — the reference is login-gated. The "50 requests per
  5 seconds" quota, `/user/me/artists`, `/editorial/{id}/releases` and `/chart` are secondary-source
  only. Closing this requires registering a Deezer developer account, which would also settle whether
  registration is still open.
- **No numeric Spotify rate limit exists in public documentation** for either quota mode, so the
  polling arithmetic in §5 cannot be checked against a threshold — only against 429s in practice.
- **Why `/artists/{id}/albums` caps `limit` at 10** is undocumented; the value is verified live but
  the changelog explains only the equivalent `/search` reduction.
- **Whether Spotify returns `/artists/{id}/albums` newest-first** is undocumented, so a `limit=1`
  latest-album probe is unsafe to rely on.
- **Apple Music rate-limit specifics** rest on search summaries and Apple's developer forums, not
  directly quoted documentation — Apple's docs are JavaScript-rendered.
- **Which webhook half users actually want** is genuinely unresolved. The Plex/Jellyfin blueprint
  evidence points at outbound, but it shows what was *built*, not what was *requested*. Since both
  halves are trivial, this does not need resolving before 004 — but it should not be reported as
  settled.
- **The Spotify quota wall (§5) is unresolved and out of scope here.** It affects ADR-0002 and
  ADR-0005 far more than it affects triggers, and needs its own ticket.
