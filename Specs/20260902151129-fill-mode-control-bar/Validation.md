# Validation: Fill-Mode Control Bar

## Table of Contents

- [Validation: Fill-Mode Control Bar](#validation-fill-mode-control-bar)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Test Cases](#test-cases)
  - [Manual Verification](#manual-verification)
  - [Definition of Done](#definition-of-done)
  - [Rollback Plan](#rollback-plan)

## Acceptance Criteria

| Requirement | Acceptance Criterion |
| --- | --- |
| FR1 | Before fill, the video shows one circular icon button (`[data-fd-role="fill"]`) near its top-left corner, no text row. After entering fill, that button is hidden (the bar's own Exit control takes over); after exiting, it reappears with its original "fill" icon and `aria-label="Fill video"`. |
| FR2 | While filled, `[data-fd-role="play-pause"]`/`[data-fd-role="mute"]` from the old top row are absent/hidden; the bottom bar's equivalents are visible and functional. Before/after fill (not filled), the bottom bar is entirely absent from the DOM or `hidden`. |
| FR3 | Dragging `[data-fd-role="scrub"]` sets `video.currentTime` proportionally to the drag position; while playing, the scrubber's `value` advances in step with `video.currentTime` without being dragged. |
| FR4 | Clicking `[data-fd-role="play-pause"]` toggles `video.paused`; the icon reflects the resulting state without a second click. Clicking `[data-fd-role="mute"]` toggles `video.muted` and its label. |
| FR5 | Clicking `[data-fd-role="marker-a"]` at `currentTime = t1` then `[data-fd-role="marker-b"]` at `t2 > t1` enables `[data-fd-role="ab-loop"]` (previously disabled). `[data-fd-role="clear-loop"]` resets both markers and disables the button again, turning off A-B loop if it was on. |
| FR6 | With valid A/B markers, toggling `[data-fd-role="ab-loop"]` on, then advancing `video.currentTime` past B (via seek or playback), causes `currentTime` to jump back to A. Toggling A-B loop on while standard repeat is on turns standard repeat off. |
| FR7 | Toggling `[data-fd-role="repeat"]` sets `video.loop = true`; toggling it on while A-B loop is on turns A-B loop off (markers remain set). |
| FR8 | After Exit (button, Escape, or video removal), re-entering fill mode for the same video shows unset A/B markers and both loop toggles off, even if they were on at exit time. |
| FR9 | The bar's visibility class/style is off by default after a brief pause post-fill-entry; a `mousemove` over the video or bar turns it on; ~2000ms of no further qualifying movement turns it back off — except during an active scrubber drag (must stay visible for the whole drag regardless of elapsed idle time). |
| FR10 | No `<link>`/`@font-face`/network request is added for icons; `grep -r "bi-" extension/` (Bootstrap's CSS class convention) and any external URL reference return nothing new — icons are inline `<svg>` literals in `fillControls.js`. |
| FR11 | Every new interactive bar element has a distinct `data-fd-role` value, `grep`-verifiable in `fillControls.js`. |
| FR12 | No change to `document.body`'s child structure outside the extension's own `overlayHost`; existing `tests/e2e/shadow-dom.spec.js`-style assertions (host DOM untouched) still pass. |
| FR13 | `tests/e2e/reddit-iframe-fill.spec.js` and any YouTube-path behavior remain green — no shared state or shared DOM node between `fillControls.js` and `reddit_fill.js`/`youtube-fill.js`. |

## Test Cases

**Playwright (this repo's only test framework — `tests/e2e/*.spec.js`, run via `make test`):**

- `tests/e2e/fill-controls.spec.js` (new, following `tests/e2e/drag.spec.js`'s
  fixture-based pattern):
  - Play/pause toggle updates both `video.paused` and the button's
    accessible state.
  - Mute toggle updates `video.muted`.
  - Scrubber drag sets `video.currentTime`; scrubber tracks `timeupdate`
    when not being dragged.
  - Set marker A / marker B enables A-B loop button only once both are
    set with A < B; clear-loop disables it again.
  - A-B loop: seed `video.currentTime` near B (via the same
    `Object.defineProperty`/stub pattern `drag.spec.js` uses for
    `videoWidth`/`videoHeight`, applied here to `duration`/`currentTime`
    if real playback timing proves flaky in CI), dispatch `timeupdate`,
    assert seek back to A.
  - Toggling repeat while A-B loop is active disables A-B loop, and vice
    versa (FR6/FR7 mutual exclusion).
  - Exit and re-enter fill mode; assert markers/loop toggles reset (FR8).
  - Idle-hide: fire a `mousemove`, assert bar visibility class present;
    advance fake timers (Playwright's `page.clock` or a real wait
    matched to the ~2000ms constant) past the idle threshold with no
    further movement, assert visibility class removed; repeat but with a
    simulated scrubber drag in progress, assert the bar stays visible
    through the equivalent elapsed time.
- `tests/e2e/fill-controls.spec.js` also covers the cross-module risk
  called out in Plan.md's Risk Assessment directly (a scrubber drag must
  not move `object-position` on the video), rather than adding an
  assertion to `drag.spec.js`.
- Implementation note: because the bar is `pointer-events: none` until
  revealed (FR9), any test driving a bar button via a real `.click()`
  must first dispatch a `mousemove` on the video (or bar) to reveal it —
  `.fill()`/`.dispatchEvent()` bypass hit-testing and don't need this,
  but `.click()` does, since it hit-tests through to the video
  underneath otherwise. See `revealBar()` in `fill-controls.spec.js`.
- Update `tests/fixtures/drag.html` (and any other fixture that lists
  the extension's own scripts) to add `<script
  src="../../extension/fillControls.js"></script>` in the load-order
  position from Plan.md's Component Breakdown, or the fixture's page
  throws before `fillTab.js`'s `enterFill` can call
  `FD.attachControls`.
- `tests/e2e/fill-basic.spec.js` and `tests/e2e/clipping-stacking.spec.js`
  must still pass unmodified in behavior (fill/exit still works), though
  any assertion keyed to the old row's `data-fd-role="play-pause"`/
  `"mute"` positions (if any) needs updating to the new bar location.

**Integration tests:** Not applicable — no database, cache, or external
service is involved; the Playwright suite against the Dockerized
Chromium browser (`make test`) is this project's full integration-level
check, already covering real DOM/event behavior.

## Manual Verification

Starting from a clean unpacked-extension load (`chrome://extensions` →
Developer Mode → Load unpacked → `extension/`, per README.md):

1. Open a page with a `<video>` (e.g. a local test page or a supported
   site). Confirm only a small circular fill icon appears near the
   video's top-left corner — no text row, no Play/Pause/Mute visible yet.
2. Click the fill icon. Confirm the video fills the tab, the floating
   fill icon itself disappears entirely (no icon lingering over the
   video's corner), and the old top-row Play/Pause/Mute buttons are
   gone.
3. Move the mouse over the filled video. Confirm the bottom bar fades
   in with progress scrubber, Play/Pause, Mute, repeat toggle, A/B loop
   controls, and Exit.
4. Stop moving the mouse off the bar for ~2 seconds. Confirm the bar
   fades out. Move again — confirm it reappears.
5. Drag the scrubber slowly, pausing mid-drag without releasing.
   Confirm the bar does not fade out during the pause, and the video
   seeks live as you drag.
6. Set point A, play forward, set point B, enable A-B loop. Confirm a
   thin colored tick appears on the scrubber at each marker's position as
   it's set, and playback loops between A and B. Enable standard repeat
   — confirm A-B loop turns off. Re-enable A-B loop — confirm repeat
   turns off.
7. Click "clear loop points" — confirm both markers clear and the A-B
   loop button disables.
8. Exit fill mode (Exit button). Re-enter fill mode for the same video.
   Confirm markers and loop toggles are back to unset/off.
9. Repeat steps 1-8 on youtube.com specifically (per Plan.md's Risk
   Assessment) — confirm the bar survives YouTube's own player
   re-renders the same way `fd-fill-active` already does.
10. Load a Reddit post with a RedGIFs/Imgur/Streamable embed and confirm
    its separate embed-iframe button row is unaffected (still the old
    text-based Fill/Play/Pause/Mute row, per FR13/Out of Scope).
11. Run `make test` and confirm the full Playwright suite passes,
    including the new `fill-controls.spec.js`.

## Definition of Done

- Requirements, Plan, and Validation docs in this spec folder reflect
  the final implementation (update them if real-world testing changes
  the design, per `AGENTS.md`'s Spec-Kit Workflow guidance).
- `make test` passes, including new tests for FR1-FR9 and the
  cross-module `drag.js` non-interference check.
- `extension/manifest.json` lists `fillControls.js` in the correct load
  order; every fixture HTML under `tests/fixtures/` that loads the
  `<all_urls>` script set is updated to match.
- Every new interactive element has a `data-fd-role` attribute (FR11),
  verified by the new Playwright tests targeting them.
- No new `manifest.json` permissions, `web_accessible_resources`, or
  external network/font references were introduced (FR10).
- Manual verification steps 1-10 above completed at least once against
  a real page and against youtube.com and a Reddit embed page.

## Rollback Plan

Revert is a pure code rollback — no data migration, no feature flag,
no persisted state:

- Remove `"fillControls.js"` from `extension/manifest.json`'s
  `<all_urls>` `js` array and delete `extension/fillControls.js`.
- Revert `extension/content.js`'s `attachButtonRow` and
  `extension/fillTab.js`'s `enterFill`/`exitFill` to their pre-spec
  versions (restoring the three-button top row and removing the
  `FD.attachControls`/`FD.detachControls` calls).
- Revert the fixture HTML changes under `tests/fixtures/` and the new/
  modified spec files under `tests/e2e/`.
- Since the extension is loaded unpacked with no build step, rollback
  takes effect immediately on next extension reload — no cache, no
  deployed artifact to invalidate.
