# PEAK Game plugin for TikTools

This declarative plugin connects TikTools to a running [PEAKapi](https://github.com/nglmercer/PEAKapi)
server. It uses the existing TikTools declarative runtime: there is no new Rust
plugin, no new WebView code and no bespoke UI.

## What it does

* Imports the PEAKapi bearer token and server address from the game's BepInEx
  configuration, either automatically or by letting you pick the game or mod
  profile folder.
* Shows the connection state and the gameplay readiness of the server in the
  existing Connections card.
* Offers the PEAK actions with the ids, players and objects that the running
  game actually has, read from the PEAKapi catalogs.
* Lets you map TikTok LIVE events onto those actions with a gift wall profile.

## Requirements

* PEAK with BepInEx 5 and the PEAKapi plugin installed and running.
* PEAKapi reachable from this machine. The default is `http://127.0.0.1:17454`.

## Installing

The package is declarative: `plugin.json` is the whole integration, there is no
executable to build.

* Development: `bun run prepare:dev-plugins` stages this directory into
  `.dev-plugins/peak.game`, and `bun run start` discovers it from there.
* Release: copy this directory into the user plugin directory
  (`~/.local/share/TikTools/plugins/peak.game` on Linux,
  `%LOCALAPPDATA%/TikTools/plugins/peak.game` on Windows,
  `~/Library/Application Support/TikTools/plugins/peak.game` on macOS) and
  restart the host.

After the install, enable `peak.game` and its `http.request` capability in the
Plugins tab.

## Connecting

1. Start PEAK once so that PEAKapi writes its configuration to
   `BepInEx/config/org.peak.rest-api.cfg`.
2. Open the plugin's connection page in TikTools.
3. Use **Connect automatically** and pick your Steam installation of PEAK or
   your active r2modman/Thunderstore profile. TikTools reads the token and the
   port from the configuration file and never shows the token itself.
4. If the game is not found, use **Select game folder…** and point TikTools at
   the PEAK folder.
5. The card probes `/health`. A reachable server that is not in a level is
   reported as *API reachable, gameplay unavailable*, which is expected while
   you are in the menu.

If you prefer, enter the token and the server address by hand. Both work; the
import only saves you from copying a 44 character token.

## Actions

| Action id | What it does | PEAKapi endpoint |
|---|---|---|
| `peak.game.spawn-item` | Hand an item to a character or place it in the world | `POST /api/spawn/item` |
| `peak.game.spawn-entity` | Spawn a hostile or neutral entity | `POST /api/spawn/entity` |
| `peak.game.spawn-hazard` | Spawn an environmental hazard | `POST /api/spawn/hazard` |
| `peak.game.despawn-entity` | Remove an object PEAKapi created | `POST /api/entities/despawn` |
| `peak.game.clear-entities` | Remove every object PEAKapi created | `POST /api/entities/clear` |

There is deliberately **no** player effect action. PEAKapi reports the
`effects` capability as unavailable because no gameplay effect has been
verified against the running game, and the plugin does not offer an action
that can only fail.

### Position modes

Every spawn action sends a validated `position`:

* `near_player` uses the player chosen in the action editor.
* `random_player` picks a random eligible player.
* `world_position` uses the X, Y and Z fields of the action editor.

The default comes from the `positionMode` setting and falls back to
`random_player`.

### Lifetime of spawned objects

Entities and hazards are sent with a `lifetimeSeconds` between 1 and 300
seconds, so a burst of gifts cannot fill the game's own caps for live
entities and hazards. The action editor sets it per action; a blank field
uses the **Default lifetime in seconds** setting (60 by default).

Items have no lifetime: they stay in the world until the game removes them.

### Dynamic options

The item, entity, hazard, player and instance lists are read from PEAKapi at
the moment the action editor is opened, so the list always matches the running
game. An entry that PEAKapi reports as not spawnable is still visible, but
selecting it will not work.

## Safety

* Every request is a `POST` with `Content-Type: application/json` and an
  `Idempotency-Key`, so a retried event never spawns twice.
* PEAKapi only accepts mutations from the room host and only while a level is
  loaded. A client that is not the host receives `409 HOST_REQUIRED`.
* PEAKapi enforces its own caps on the number of live entities and hazards, so
  a burst of gifts cannot flood the game even if the cooldowns are removed.

## Gift wall profile

`examples/profiles/peak-giftwall.tikprofile.json` contains ten example rules.
Every rule is **disabled** when the profile is imported. Import it, pick the
catalog entries in the action editor, then enable the rules you want.

The gift names in the profile are editable examples. They are not a statement
about which gifts exist in your region or what they cost.

## Privacy

The token is stored as a secret setting. TikTools never sends it to the
WebView; the editor shows a placeholder instead. The plugin only talks to the
address you configure and, by default, only to the loopback interface.
