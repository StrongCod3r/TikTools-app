# TikTok LIVE emotes: pipeline, current state, and prerequisites

Status: **partial**. The SonicBoom text-processing half is complete and
verified. The rendering half exists and is unit-tested but renders nothing new
today, because no emote metadata reaches the app yet. This document records
exactly what is done, what is blocked, and on what.

## What an emote is in TikTok LIVE

TikTok serialises graphical emotes two ways:

1. As bracketed shortcodes inside the chat `content` string, e.g.
   `Hello [laughcry][laughcry] everyone!`.
2. As structured protobuf metadata: `WebcastChatMessage`
   (`repeated EmoteWithIndex emotes = 13`) and the standalone
   `WebcastEmoteChatMessage` (`repeated EmoteModel emote_list = 3`).

The structured form is the authority for artwork and position. The shortcode
form is what a comment string contains regardless.

## What works today

### 1. Spoken text never contains recognised emote codes

`plugins/sonicboom` gained a pure text normaliser, implemented twice and pinned
together by shared fixtures:

| Language | File |
|---|---|
| TypeScript | `plugins/sonicboom/shared/tts/sanitizer.ts` |
| Rust | `plugins/sonicboom/backend/src/sanitizer.rs` |
| Fixtures (both read these) | `plugins/sonicboom/shared/tts/fixtures/sanitizer-cases.json` |
| Catalog (TS) | `plugins/sonicboom/shared/tts/emote-catalog.ts` |
| Catalog (Rust) | `plugins/sonicboom/backend/src/emotes.rs` |

Pipeline order inside a decision (both languages):

```
enabled → comment/trigger filter → user eligibility
        → text processing → points check → voice
```

Text processing is `known emote tokens → Unicode emoji → unwanted invisibles →
whitespace`. It sits **after** the trigger filters so command matching still
sees the original comment, and **before** the points check so a comment that
sanitises to nothing is dropped without charging the viewer or issuing a
synthesis request.

Deliberate properties:

- Only tokens in the verified catalog are treated as emotes. Arbitrary
  bracketed text (`[debug]`, `[1,2,3]`, `[username]`) is never touched. The
  naive `text.replace(/\[[^\]]+\]/g, '')` is explicitly rejected.
- Zero-width non-joiner (U+200C) and zero-width joiner (U+200D) are preserved:
  they are meaningful in Indic/Arabic scripts and inside emoji sequences.
- Unicode emoji removal is opt-in (default off); Spanish, Japanese, Chinese,
  Korean and Arabic text is untouched in every mode.
- Emoji handling is per grapheme cluster, so ZWJ sequences, skin-tone
  modifiers and keycaps are removed whole, with no stray variation selectors.
- Character classification uses explicit shared tables rather than JS `\s` /
  Rust `char::is_whitespace`, which disagree on U+FEFF and U+0085.

Operator controls live in a **Text Processing** card in the SonicBoom settings
UI (`plugins/sonicboom/ui/src/components/TtsTextProcessing.vue`), with a live
preview that calls the same `sanitizeTtsText` the backend uses, so preview and
production cannot disagree.

### 2. A reusable resolver exists for rendering

`src/shared/emotes/` resolves a comment plus optional metadata into segments:

```ts
resolveChatSegments('Hello [laughcry] world', emotes) =>
  [ { type: 'text', value: 'Hello ' },
    { type: 'emote', id: 'laughcry', shortcode: '[laughcry]', imageUrl: …, fallbackText: '[laughcry]' },
    { type: 'text', value: ' world' } ]
```

- `isSafeEmoteImageUrl` accepts **absolute HTTPS URLs only**. `javascript:`,
  `data:`, `file:`, `http:`, `blob:` and protocol-relative URLs are rejected, so
  untrusted LIVE metadata can never introduce a privileged image source.
- Metadata is bounded (64 emotes per event, 2048-byte URLs) and invalid entries
  are dropped rather than failing the whole comment.
- A bad URL costs the image, not the emote.
- `segmentsToPlainText` provably reproduces the original comment.

### 3. The feed renders segments without HTML injection

`src/web/components/chat-rich-text.vue` renders each segment as a text child or
an `<img>` — never `innerHTML`/`v-html`. It is wired into the feed row
(`event-card.vue`) and the details panel (`FeedEventDetails.vue`, which also
keeps the original comment visible). Broken images fall back to the shortcode
and are remembered in a bounded 256-entry cache (`src/web/features/emote-images.ts`)
so a re-rendered row never re-requests a URL that already failed.

Rows that cannot contain an emote keep the previous plain-string path, so the
hot feed is unchanged.

## What is blocked, and why

### A. No emote metadata exists in this repository

`ttl-live-events` is consumed as a pinned git dependency
(`bcab9dcb…` in the root `Cargo.toml`). Its normalized `ChatEvent` exposes only
`user` and `comment`; there is **no `emotes` field**. Neither
`crates/tiktools-tiktok/src/events.rs` (which re-exports the canonical type) nor
`crates/tiktools-core/src/live_events/mapping.rs` can therefore produce emote
metadata.

Consequently `UiEvent.emotes` (`src/shared/messages.ts`) is a
forward-compatible slot that the host never fills today. The web feed's UI JSON
is hand-built in `mapping.rs`, so populating it later needs **no** generated
contract change — only the signer change and one mapping line.

### B. The generated automation contract cannot express emotes

`ChatAutomationData` is generated from Rust through schemars and
`crates/tiktools-core/src/contracts/tiktok/` provenance validation. Adding an
`emotes` array requires projecting a **repeated protobuf message**, and
`validation.rs::validate_native_element` deliberately rejects
message/bytes sources:

> `native cannot project protobuf message (message/bytes sources need an explicit transform)`

So the contract cannot grow an emote field without first extending
`SourceTransform` with a message-array projection (plus the DTO and provenance
entry). That is a schema-level change, and doing it before the signer emits
emotes would stamp provenance that cannot be validated against real traffic.
It was deliberately **not** done here.

This is also why the OBS chat widget was not changed: its data arrives through
the generated contract, so `ChatMessageView.emotes` would always be `undefined`
and the change would be unverifiable churn against a widget that has an
explicit plain-text guarantee in its e2e suite.

### C. The shortcode catalog is unverified

The token list (`laughcry`, `happy`, `wow`, …) is a **hypothesis**, not captured
traffic. It exists so the mechanism is complete and testable. Two consequences:

- No image URL is stored in either catalog. Inventing artwork URLs is
  forbidden, so a catalog-only emote renders its original shortcode.
- Acceptance criterion "standard verified TikTok emoji codes display as images"
  is therefore **not met** and cannot be until the mapping is verified against
  live traffic (or the protobuf metadata path lands).

### D. Index spans are deliberately unused

`LiveEmote.index` is preserved verbatim but never used to slice text. The unit
is unverified (bytes, code points, UTF-16 are all plausible) and slicing on a
wrong unit would corrupt any comment containing non-BMP text. Matching is
token-based, which is the plan's own "safe textual fallback". If index semantics
are confirmed from captured traffic, index-based placement can be added behind
the same segment model.

## Required next steps

1. **In `tiktok-signer`** (not checked out here):
   - add `emotes: Vec<LiveEmote>` to the normalized `ChatEvent`;
   - normalise `WebcastChatMessage.emotes` (id, first valid image URL, index,
     type, package) with bounded sizes and no image fetching during decode;
   - add first-class `WebcastEmoteChatMessage` handling;
   - mirror the shape in `packages/tiktok-live` and the Java SDK.
2. **In this repository**:
   - populate `emotes` in `mapping.rs`'s chat `json!({…})` (no contract change);
   - extend `SourceTransform` with a message-array projection, add
     `ChatAutomationData.emotes`, add the provenance entry, and regenerate with
     `bun run contracts:generate`;
   - extend `isChatAutomationData`, then `ChatMessageView` and `ChatWidget.vue`.
3. **Verify the catalog** against captured LIVE traffic and populate
   `imageUrl` only where confirmed; bump `EMOTE_CATALOG_VERSION` in both
   catalogs (a test fails if they drift).

## Live protocol assumptions requiring verification

- That TikTok emits bracketed shortcodes for emotes (the whole text path rests
  on this).
- That the catalog token names above correspond to real TikTok emotes.
- That `EmoteWithIndex.index` denotes UTF-16 offsets (currently assumed to be
  *some* unknown unit and therefore unused).
- That `WebcastChatMessage.emotes` image candidates yield a usable HTTPS URL.
