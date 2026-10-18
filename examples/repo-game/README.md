# R.E.P.O. Game

Declarative integration for the existing REPOapi mod, with no additional server.
Run `bun run prepare:dev-plugins` for automatic development discovery, or install
this directory through the existing plugin installer. Enable `repo.game` and its
HTTP capability. Configure the local URL in Connections. To set up the token:

1. Start R.E.P.O. with REPOapi once so BepInEx generates its configuration.
2. Open **Connections → R.E.P.O. Game → Connect automatically**.
3. Choose the detected Steam installation or active mod profile and click
   **Use this configuration**. TikTools imports the token and API port, then
   tests the connection. Credentials remain hidden.

The search checks known Steam locations (including configured additional
libraries) and r2modman/Thunderstore profile folders. It does not scan the whole
disk or read credentials before you choose a source. If nothing is found, use
**Select game folder…** and select the installation or active mod-profile folder.
Selecting its `BepInEx` or `config` subfolder also works.

**Import token from configuration…** remains available as a fallback: select
`BepInEx/config/org.repo.rest-api.cfg`. You can also paste the token manually.
The source file is never changed. Cancellation, invalid configurations or
unsupported remote addresses preserve existing settings. Import only accepts
local/wildcard API listen addresses; wildcard addresses become loopback client
URLs. Native file/folder selection requires the desktop host.

There is no API login flow.
The manifest uses the registered `terminal` icon (`gamepad` is not in the current host registry).
Authentication may be disabled in REPOapi's local configuration; leave the token
blank only when the server has been explicitly configured that way.

Test connection queries `/health`. API reachability and gameplay readiness are reported separately. When gameplay readiness is false the banner
reports API version, game-running, level, host and readiness state. An available
HTTP server does not establish that commands can run. Join a level as host.

Choose runtime content in each action's dynamic selector, including modded
content. Catalogs use the existing 60-second cache. Saving plugin settings clears
that cache after a session change. Player IDs are session-specific. The API is
the authority for unknown or stale IDs, host permissions, and safe positions.
Empty or unavailable catalogs must be populated by starting the game/session.

Spawns support near-player, random-player, random-valid and world-position modes.
Only the selected mode's fields are serialized. Blank quantity/position/player
configuration uses plugin defaults. Coordinates are required for world position;
player selection is required for near-player. Quantity is restricted to 1–10;
the server may enforce a smaller limit. Upgrades are physical pickups.
Despawn accepts an API-spawned enemy **instance** ID, not a catalog enemy ID.
Clear removes API-spawned enemies. Teleport is not exposed.

Import `../profiles/repo-giftwall.tikprofile.json`. All eight example events are
disabled: edit each action, select real content, adjust gift filters and quantity,
then enable the event. Follow/share use the existing LIVE triggers. Cooldowns are
10–15 seconds. Automation test runs preview requests without sending gameplay
commands; manually firing the configured event or using the host's immediate
execution API sends real requests.

POSTs receive a cryptographically generated execution key. The hardened sender
sends once and does not automatically retry failures; keep the prepared key and
body together if transport retry support is added later. Never replay uncertain
500/504 outcomes as a new execution. Shared opt-in command budgets reject excess
traffic immediately: four concurrent requests, sixteen starts per second. No
extra gameplay queue or catalog polling runs per event.

HTTP failures surface through the existing automation error path. Stale IDs,
not-ready/non-host responses, rate limits, partial execution and timeouts require
operator attention. Other rules continue using the existing engine. Real gameplay
requires a running R.E.P.O. instance and is not covered by unit tests.
