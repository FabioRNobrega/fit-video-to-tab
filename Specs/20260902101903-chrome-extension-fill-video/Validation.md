# Validation: Chrome Extension — Fill Video (per-video Fill button, no drag)

## Table of Contents

- [Acceptance Criteria](#acceptance-criteria)
- [Test Cases](#test-cases)
- [Manual Verification](#manual-verification)
- [Definition of Done](#definition-of-done)
- [Rollback Plan](#rollback-plan)

## Acceptance Criteria

| Requirement | Acceptance Criterion |
| --- | --- |
| FR1 | `chrome://extensions` → "Load unpacked" on `extension/` loads with no manifest errors, no background/service-worker entry, and the content script runs on any http(s) page. |
| FR2 | DevTools Elements panel shows exactly one extra top-level `<div>` (the `overlayHost`) appended as the last child of `<body>`, with an open shadow root, on every page tested — regardless of framework (plain HTML vs. a React/Vue SPA). |
| FR3 | A video present at page load gets a button row immediately; a video injected later (e.g. via a test page's "add video" button, or real infinite-scroll/SPA navigation) gets a button row within one MutationObserver tick without a page reload. |
| FR4 | Scrolling the page (including inside a nested `overflow: auto` container holding the video) and resizing the window keep the button row's position glued to the video's current `getBoundingClientRect()` with no visible drift. |
| FR5 | The button row never changes the page's own layout — page content does not shift, reflow, or gain scrollbars because of the row's presence. |
| FR6 | Clicking "Fill" adds `fd-fill-active` to the video, `controls` (if present) disappear, and the label reads "Exit". Clicking "Fill" on a second video while another is filled exits the first automatically. |
| FR7 | While a video is filled, pressing `Escape` exits fill mode identically to clicking "Exit". After exiting via the "Exit" button, a later, unrelated `Escape` press elsewhere on the page does not re-trigger fill mode (this was a bug in the design doc's original one-shot listener snippet — confirm it's actually fixed here). |
| FR8 | Exiting fill mode returns the video to its original in-page size/position, restores `controls` only if it was present before Fill was clicked, and the button label reads "Fill" again. |
| FR9 | The `<style>` block containing `.fd-fill-active` appears exactly once in `document.head` regardless of how many videos are on the page. |
| FR10 | Removing a video from the page while it is filled (test page "remove video" button, or SPA navigation) exits fill mode first (restoring any neutralized ancestors) and then removes its button row/listeners with no console errors. |
| FR11 | Confirmed by code inspection: per-video row/observer/cleanup state is in a `WeakMap` in `content.js`; fill-mode state (only one video at a time) is separate module-level state in `fillTab.js`. |
| FR12 | On x.com/Twitter (a video nested inside `overflow: hidden` + `transform`-bearing wrapper divs, under a page with its own fixed header/sidebar), clicking "Fill" reaches the true viewport — not clipped or confined to the wrapper's box — *and* paints above the site's own fixed UI (header, sidebar), not behind it. Exiting restores every neutralized ancestor's original inline styles exactly (compare `style` attribute before/after in DevTools). Automated: `tests/e2e/clipping-stacking.spec.js` (viewport reach, paints above a simulated fixed sidebar, stacking overrides above the shared boundary restored on exit). |
| FR13 | On youtube.com, click "Fill", let the player run long enough for its own UI to re-render internally, and confirm the `fd-fill-active` class survives — if the player's script strips it, the extension re-applies it within one observer tick. |
| FR14 | The attribute-guard `MutationObserver` from FR13 is disconnected on exit — confirmed via DevTools that no further callback fires for that video once "Fill" is showing again, even if its class/style is manipulated afterward from the console. |
| FR15 | On a page with a video inside an open Shadow DOM (e.g. a Reddit/redgifs video post), the "Fill" button appears for it exactly as it would for a light-DOM video, both for a video present at load and one added to the shadow root later. Automated: `tests/e2e/shadow-dom.spec.js`. |
| FR16 | Not independently testable — confirmed by code inspection that no code path attempts to read `.shadowRoot` contents when it is `null` (closed shadow root), and that this is documented as a hard limitation rather than silently failing in a confusing way. |
| FR17 | On x.com/Twitter with multiple videos visible in the timeline, filling one video does not change the appearance, clipping, or stacking of any other video on the page — only the filled one is affected. Automated: `tests/e2e/clipping-stacking.spec.js` (sibling video's ancestor overflow and own position untouched after fill). |
| FR18 | While a video is filled, Play/Pause and Mute buttons appear in its row. Clicking Play/Pause toggles playback; clicking Mute toggles audio. Both buttons' labels update correctly if the video's play/pause/mute state changes some other way (e.g. clicking the video itself, or a keyboard shortcut) rather than only via these buttons. Automated: `tests/e2e/fill-basic.spec.js`. |
| FR19 | The Play/Pause and Mute buttons are hidden before Fill is clicked and after Exit/Escape is used — they are never visible for a video that isn't currently filled. Automated: `tests/e2e/fill-basic.spec.js`. |

## Test Cases

**Automated (Playwright, real Chromium, run via `make test` inside Docker
— see "Running the automated tests" below):**

- `tests/e2e/fill-basic.spec.js` (`tests/fixtures/plain.html`):
  - Fill button appears above the video (FR1–FR4).
  - Clicking Fill fills the viewport, adds `fd-fill-active`, hides native
    `controls`, label becomes "Exit" (FR6).
  - `Escape` exits fill mode and restores `controls` (FR7, FR8).
  - Clicking "Exit" (the same button, now relabeled) also exits (FR6, FR8).
  - Play/Pause and Mute buttons are hidden until filled, then shown, then
    hidden again on exit (FR18, FR19).
  - Mute button toggles `video.muted` and its label follows the real
    `volumechange` event (FR18).
  - Play/Pause button calls `video.play()`/`pause()` and its label follows
    the real `play`/`pause` events, not just the click itself (FR18) —
    `play()`/`pause()`/`paused` are stubbed on the test video since the
    fixture has no decodable media source; this still exercises the
    extension's actual click-handling and event-listening code, only the
    browser's media decoder is out of scope.
- `tests/e2e/clipping-stacking.spec.js`
  (`tests/fixtures/clipping-stacking.html`, which reproduces the exact
  x.com shape — a per-video `overflow:hidden` wrapper inside a shared
  `#timeline` holding **two** videos inside an `#app` wrapper with its own
  `z-index` stacking context shared with a simulated fixed `#sidebar`) —
  the direct regression tests for FR12/FR17, confirmed during development
  to fail when either fix is reverted:
  - Filling a clipped video reaches the true viewport (FR12).
  - The filled video paints above the page's own fixed sidebar, checked
    via `document.elementFromPoint` at a point over the sidebar (FR12).
  - Filling one video does not change a sibling video sharing the same
    `#timeline`, and never touches that shared ancestor's `overflow`
    (FR17).
  - Stacking overrides applied to an ancestor *above* the shared boundary
    (`#app`) are applied while filled and restored exactly on exit (FR12).
- `tests/e2e/shadow-dom.spec.js` (`tests/fixtures/shadow-dom.html`, a
  custom element with an open `shadowRoot` containing a `<video>`,
  reproducing the Reddit shape):
  - A Shadow-DOM-nested video gets a Fill button (FR15).
  - Fill/Exit works for it exactly as for a light-DOM video (FR15).

**Not covered by the automated suite** (left to manual verification below,
since they need a real extension-loading context, real third-party sites,
or aren't meaningfully testable in an isolated fixture):

- FR1, FR2: Manifest loading via "Load unpacked" and the overlay host's
  exact placement in a real page's DOM.
- FR3, FR10: MutationObserver-driven discovery/cleanup on a real SPA's own
  navigation, and no console errors from real framework reconciliation.
- FR13, FR14: the attribute-guard `MutationObserver` against a real site's
  own re-rendering behavior (YouTube).
- The full real-site walkthroughs (x.com, youtube.com, a Reddit/redgifs
  page) — the fixtures reproduce the *structural* cause of each bug, not
  the sites themselves, so a real-site pass remains the final check before
  calling a fix confirmed in production conditions.

## Running the automated tests

From the repo root, with only Docker and `make` on the host (no Node, npm,
or browser install needed — everything runs inside the container):

```bash
make test
```

`make test-build` builds the image without running it; `make test-clean`
removes the built image. First run pulls the ~1-2GB Playwright base image;
subsequent runs reuse Docker's build cache and only re-run `npm install`
if `tests/package.json` changed.

## Manual Verification

Starting from a clean checkout of this repo:

1. Confirm the three files exist under `extension/` per Plan.md's Component
   Breakdown (`manifest.json`, `content.js`, `fillTab.js`).
2. Open `chrome://extensions` (or your Chromium-based browser's equivalent,
   e.g. `vivaldi://extensions`), enable "Developer mode", click "Load
   unpacked", and select the `extension/` folder. Confirm it loads with no
   errors shown on the card.
3. Build (or reuse) a plain local test HTML page with 2–3 `<video>`
   elements at different sizes/positions, one nested inside a scrollable
   `<div>`, to cover FR2–FR5, FR9, and FR11:
   - Confirm each video gets its own "Fill" button positioned just above
     it.
   - Scroll the page and the nested container; confirm the buttons track
     their videos with no drift.
   - Resize the browser window; confirm buttons re-sync.
   - Inspect `document.head` and confirm exactly one `.fd-fill-active`
     `<style>` block regardless of video count.
4. Click "Fill" on one video (FR6): confirm it fills the tab (browser
   chrome — tabs, address bar — stays visible), `controls` (if present)
   disappear, and the label changes to "Exit". Confirm Play/Pause and Mute
   buttons appear alongside "Exit" (FR18–FR19); click each and confirm
   playback/audio actually toggles and the label updates. Click "Fill" on
   a second video while the first is still filled and confirm the first
   automatically exits (and its Play/Pause/Mute buttons disappear again).
5. Press `Escape` (FR7) and separately, on another video, click "Exit"
   (FR8): confirm both return the video to its original in-page size/
   position, restore `controls` only if originally present, and reset the
   label. After exiting via the "Exit" button specifically, press `Escape`
   again somewhere unrelated on the page and confirm nothing re-triggers.
6. Add and remove a `<video>` element via the test page's own script (e.g.
   a button that does `document.body.appendChild(...)` / `.remove()`), and
   separately test on a real client-rendered site (e.g. a single-page app)
   to confirm no console errors appear from the framework's reconciliation
   (FR3, FR10) — this is the specific failure mode the design doc's
   sibling-overlay approach exists to avoid. Also try removing a video
   *while it is filled* and confirm no ancestor is left with overridden
   inline styles afterward (FR10).
7. On x.com/Twitter (the site that motivated adding ancestor
   neutralization — its video is nested inside `overflow: hidden` and
   `transform`-bearing wrapper divs, with the site's own fixed
   header/sidebar elsewhere on the page), scroll to a timeline with at
   least two videos visible at once, and click "Fill" on one of them
   (FR12). Confirm the video both reaches the true viewport (cropped via
   `object-fit: cover`, not clipped or confined to the wrapper's box) *and*
   paints above x.com's own fixed UI rather than behind it — the
   header/sidebar/composer button should not be visible through or on top
   of the filled video. Confirm the *other* video(s) in the timeline are
   unaffected — not visible on top of or peeking through the filled one
   (FR17; this was the regression found after the first stacking-context
   fix). Confirm that exiting (Escape or "Exit") returns cleanly to the
   in-page player with every neutralized ancestor's original styling
   intact (check `style` attributes in DevTools before and after).
8. On youtube.com, click "Fill" on the video player, let it play for
   20–30 seconds so the player's own UI re-renders internally, and confirm
   fill mode survives (FR13) — or, if YouTube's script strips the class,
   confirm it's silently re-applied (no visible flicker back to the normal
   player). Confirm the attribute-guard observer doesn't linger after
   exiting (FR14).
9. On a Reddit or redgifs page with an inline video (rendered inside an
   open Shadow DOM), confirm a "Fill" button appears for it and Fill/Exit
   works the same as any other video (FR15).
10. On a page with heavy CSS animations on an ancestor of a video (or a
    page with `prefers-reduced-motion` testing tools), fill that video and
    visually confirm the extent of any layout/animation disturbance on the
    neutralized ancestor while filled, per the Open Question in
    Requirements.md and the Risk Assessment in Plan.md — this is expected
    to some degree, not necessarily a bug, but should be observed once so
    it isn't mistaken for a regression later.

## Definition of Done

- Requirements.md, Plan.md, and this Validation.md are complete and
  consistent with each other and with the current implementation,
  including all revisions made after manual testing (CSS fill mode +
  ancestor neutralization in place of the Fullscreen API; recursive Shadow
  DOM discovery; stacking-context neutralization; splitting the ancestor
  walk into clipping vs. stacking override sets with independent stop
  conditions; Play/Pause + Mute controls) — see Requirements.md's Problem
  Statement for the full history and rationale.
- `extension/manifest.json`, `extension/content.js`, and
  `extension/fillTab.js` exist and load without error via "Load unpacked".
- `README.md` at the repo root accurately describes current behavior,
  install/test steps, and how to run the automated test suite.
- `make test` passes (13/13 at the time of this revision) — confirmed to
  actually catch a regression by temporarily reverting the FR12/FR17
  ancestor-walk split during development and observing the relevant test
  fail, then restoring the fix and confirming the suite passes again.
- All manual verification steps below pass on a plain test page, x.com,
  youtube.com, and a Reddit/redgifs page — the automated suite covers the
  structural regressions in isolated fixtures, but a real-site pass is
  still the final check.
- Drag-to-reposition remains explicitly out of scope and undocumented as
  "done" anywhere in this spec.

## Rollback Plan

Since this is a client-side, user-installed browser extension with no
server-side or shared-state component, rollback is local and immediate:

- Remove or disable the extension via `chrome://extensions` ("Remove" or
  toggle off) — the content script stops running on the next page load/
  navigation, and any in-page changes it made (the `fd-fill-active` class,
  any neutralized ancestor inline styles, the injected `<style>` block, the
  `overlayHost` node) exist only in the live DOM of already-open tabs; a
  page refresh clears them entirely since nothing is persisted to the host
  page or to `chrome.storage`.
- No feature flag or config toggle is needed for this slice — there is
  only one behavior (Fill), so "rollback" is "don't load the extension" /
  "remove it."
