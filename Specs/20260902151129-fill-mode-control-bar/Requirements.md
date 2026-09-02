# Requirements: Fill-Mode Control Bar

## Table of Contents

- [Requirements: Fill-Mode Control Bar](#requirements-fill-mode-control-bar)
  - [Problem Statement](#problem-statement)
  - [User Stories](#user-stories)
  - [Functional Requirements](#functional-requirements)
  - [Non-Functional Requirements](#non-functional-requirements)
  - [Out of Scope](#out-of-scope)
  - [Open Questions](#open-questions)

## Problem Statement

Today, `content.js` renders one always-visible button row per `<video>`
(Fill, Play/Pause, Mute — the latter two `hidden` until fill mode is
entered, per `extension/content.js:39-64`) positioned just above the
video via `ResizeObserver` + scroll/resize listeners. It gives a filled
video no way to scrub, no loop controls, and no auto-hide — the row is
always on screen, competing with the video for attention, and offers only
play/pause and mute. `home/deck/Documents/Projects/video-manager`'s
`MediaPlayerControls.razor` demonstrates a richer, purpose-built filled
player bar (progress scrubber, play/pause, standard repeat, A/B loop
markers, exit) that fades out until hovered. This spec ports that
control surface into this extension's plain-JS, shadow-DOM overlay
architecture, and turns the plain "Fill" text button into a small
floating icon so the un-filled state stays visually unobtrusive.

## User Stories

- Given a page with a `<video>`, when the viewer has not yet filled it,
  then they see a small circular fill icon button near the video's
  top-left corner (not a row of buttons) that they can click to fill it.
- Given a video is filled, when the viewer moves the pointer over the
  video or the control bar, then a bottom control bar fades in showing
  progress, play/pause, standard repeat, A/B loop controls, and exit;
  when the pointer is idle (not hovering the bar, not dragging) for
  ~2 seconds, the bar fades out.
- Given a video is filled, when the viewer drags the progress scrubber,
  then the video seeks live and the bar does not hide mid-drag even if
  the pointer pauses.
- Given a video is filled, when the viewer sets point A then point B and
  toggles A-B loop, then playback loops between those two timestamps
  until the loop is toggled off or cleared.
- Given a video is filled, when the viewer toggles standard repeat, then
  the video loops from the end back to its start, and any active A-B loop
  is turned off (the two loop modes are mutually exclusive).
- Given a video is filled, when the viewer clicks exit (or presses
  Escape), then fill mode exits exactly as it does today and the control
  bar is torn down.

## Functional Requirements

1. FR1 — The per-video floating button that enters fill mode is a small
   icon-only circular button (inline SVG "fullscreen" icon), positioned
   over the video's top-left corner instead of `content.js`'s current
   text-based row-above-video placement. It is hidden entirely while its
   video is filled — the bottom control bar's own Exit button (FR2)
   already offers a way out, so a second, visually-overlapping exit
   affordance in the video's corner is redundant — and reappears (still
   the "fill" icon; it never itself becomes an "exit" icon) once fill
   mode ends.
2. FR2 — While a video is filled, the top-of-video button row (Play/Pause,
   Mute) is hidden entirely; a new bottom control bar is shown instead,
   containing Play/Pause, Mute, the progress scrubber, standard-repeat
   toggle, A/B loop controls, and Exit. While not filled, only the FR1
   fill icon is visible for that video — no row, and no bottom bar.
3. FR3 — The control bar's progress scrubber is a range input reflecting
   `currentTime`/`duration` via the video's `timeupdate`/`loadedmetadata`
   events; dragging it seeks the video live (on `input`), and it stays
   in sync when the video's time changes from any other source (e.g. an
   A/B loop seek).
4. FR4 — Play/Pause and Mute in the bar toggle the underlying video's
   `paused`/`muted` state and reflect it live via the video's own
   `play`/`pause`/`volumechange` events (same event-driven pattern as
   `content.js`'s existing `updatePlayPauseLabel`/`updateMuteLabel`).
5. FR5 — "Set point A" and "set point B" buttons record the video's
   current `currentTime` as marker A / marker B respectively (disabled
   until `duration` is known). A "clear loop points" button clears both
   markers and turns off A-B loop if active. Each set marker also shows a
   thin colored tick on the progress scrubber at its `time / duration`
   percentage (mirroring `MediaPlayerControls.razor`'s `MarkerStyle`
   spans), hidden again when cleared or when a fresh fill session starts.
6. FR6 — The A-B loop toggle button is enabled only when both markers are
   set and A < B (`HasValidAbRange`, mirroring
   `MediaPlayerState.HasValidAbRange`). While enabled, a `timeupdate`
   listener seeks the video back to marker A once `currentTime >= B`.
   Enabling A-B loop turns off standard repeat if it was on.
7. FR7 — The standard-repeat toggle sets/clears the video's native `loop`
   property. Enabling it turns off A-B loop if it was on (markers are
   preserved, only the loop mode is disabled — see FR5's Clear button for
   the only way to drop markers).
8. FR8 — All markers and both loop-mode toggles reset to their initial
   (off/unset) state whenever fill mode is exited for that video — by
   Exit click, Escape, or the video leaving the DOM
   (`FD.forceExitIfActive`). Re-entering fill mode always starts clean.
9. FR9 — The control bar is hidden (opacity/visibility, not `display:
   none`, so transitions can animate) by default while filled, and shown
   on `mousemove`/`pointermove` over the video or the bar itself. It
   auto-hides after ~2000ms of no such movement, except: the hide timer
   is suspended (never fires) while the pointer is actively dragging the
   scrubber, and is reset (not suspended) while the pointer is hovering
   the bar without dragging.
10. FR10 — All new icons (fullscreen, fullscreen-exit, play-fill,
    pause-fill, volume states already used by content.js may stay as
    emoji/text per Out of Scope, repeat-1, chevron-bar-left,
    chevron-bar-right, infinity, x-circle) are inline SVG markup — no
    external font, no network request, no new `manifest.json` entries.
11. FR11 — The new bar and floating fill icon carry `data-fd-role`
    attributes for every interactive element (e.g. `play-pause`,
    `mute`, `scrub`, `marker-a`, `marker-b`, `ab-loop`, `clear-loop`,
    `repeat`, `exit`), following the existing convention in
    `extension/content.js` and `AGENTS.md`'s Coding Conventions, so the
    Playwright suite can target them.
12. FR12 — The extension continues to never insert, move, wrap, or
    remove any host-page DOM node; the new bar is appended only to the
    extension's own existing shared shadow root (`content.js`'s
    `overlayHost`/`shadow`), the same constraint the current button row
    already satisfies.
13. FR13 — `youtube-fill.js`'s cleanup script is unaffected — this spec's
    bar only attaches to the primary `<all_urls>` fill mechanism
    (`fillTab.js`'s `enterFill`/`exitFill`), matching how `drag.js`
    already scopes itself.

    **Amended after this spec shipped:** `reddit_fill.js`'s embed-iframe
    frame was originally scoped out here (see the prior revision of this
    FR and the old Out of Scope entry below) but was later updated to
    reuse this same bar and floating icon button for its own local
    `<video>` controls (play/pause, mute, scrub, A/B loop, repeat) —
    `FD.attachControls`/`FD.detachControls` needed no change to support
    this beyond decoupling the bar's Exit button from a hardcoded
    `FD.toggleFill` call (not loaded in that frame) into a caller-supplied
    `controls.onExit` callback. See
    `Specs/20260902124537-reddit-iframe-embed-fill/Requirements.md` for
    the embed-frame specifics; `reddit_fill.js`'s *cross-frame iframe-fill
    coordination* (postMessage, exclusivity) is unchanged by this — only
    its local button/bar UI was swapped to match the generic path's new
    look.

## Non-Functional Requirements

- No new runtime dependencies, bundler, or build step — plain IIFE JS
  and inline SVG/CSS only, consistent with the project's greenfield,
  no-`package.json`-at-root shape (`AGENTS.md`'s Project Overview).
- No new `chrome.*` API usage (`AGENTS.md`'s Coding Conventions) — the
  bar must work identically under Playwright as a plain `<script>` tag,
  same as every existing module.
- No new `manifest.json` permissions, `content_scripts` entries, or
  `web_accessible_resources` — inline SVG requires none of these.
- The bar's hide/show and drag interactions must not interfere with
  `drag.js`'s horizontal drag-to-reposition, which listens for
  `pointerdown`/`pointermove` directly on the `<video>` element; the bar
  is a separate shadow-DOM element so pointer events on the bar never
  reach the video's listeners, but this must be verified (see
  Validation.md).
- Single-video-at-a-time state shape: the bar's state (markers, loop
  mode, hide timer) lives in module-level variables scoped to whichever
  video is currently filled, mirroring `fillTab.js`'s and `drag.js`'s
  existing pattern — not a `WeakMap` — since only one video can be
  filled tab-wide (`FD.requestExclusiveFill`).

## Out of Scope

- Volume slider / mute redesign — the existing Mute button keeps its
  current emoji-label behavior (🔇/🔊), just relocated into the bottom
  bar per FR2; no new volume-level control.
- Playback-rate selector.
- Any change to `ancestorOverrides.js`, the clipping/stacking-override
  walk, or cross-mechanism exclusivity.
- Vertical drag / vertical `object-position` changes (still out of scope
  per the drag spec's Constraints).
- YouTube's cleanup script (`youtube-fill.js`) keeps its own, separate
  button handling unchanged (FR13). ~~Reddit cross-origin embed-iframe
  fill (`reddit_fill.js`) keeps its own, separate button row
  unchanged~~ — no longer accurate; see FR13's amendment. `reddit_fill.js`
  now reuses this spec's bar/icon for its embed frame's local video
  controls, though its cross-frame iframe-fill coordination itself is
  still out of scope for *this* spec (owned by
  `Specs/20260902124537-reddit-iframe-embed-fill/`).
- Keyboard shortcuts beyond the existing Escape-to-exit.

## Open Questions

None outstanding — the discovery round (button placement, loop
exclusivity, marker persistence) is resolved and reflected in FR2, FR6/
FR7, and FR8 above.
