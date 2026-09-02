# Validation: Drag-to-Reposition (Horizontal) for Filled Video

## Table of Contents

- [Acceptance Criteria](#acceptance-criteria)
- [Test Cases](#test-cases)
- [Manual Verification](#manual-verification)
- [Definition of Done](#definition-of-done)
- [Rollback Plan](#rollback-plan)

## Acceptance Criteria

| Requirement | Acceptance Criterion |
| --- | --- |
| FR1 | `extension/drag.js` exists as an IIFE attaching `attachDrag`/`detachDrag` to `window.__fdExt`, alongside the existing `toggleFill`/`injectFillStyle`/`forceExitIfActive` exports — confirmed by code inspection and by `drag.spec.js` calling drag behavior only through the normal Fill button flow (no direct access to internals). |
| FR2 | Clicking "Fill" wires drag listeners (a drag started immediately after clicking Fill actually moves the crop); clicking "Exit" or pressing `Escape` immediately after stops drag from having any further effect (a `pointermove` dispatched after exit does not change `object-position`). |
| FR3 | Pointer listeners exist only while filled: dispatching a `pointermove` with a large `deltaX` on the video *before* clicking Fill has no effect on `object-position`. A second, non-primary pointer's `pointerdown` does not start or interfere with an existing drag session. |
| FR4 | If `videoWidth`/`videoHeight` are `0` (unset in the fixture), a full drag gesture leaves `object-position` unset — no session starts, no crash/console error. |
| FR5 | A `pointerdown` + `pointermove` sequence with total horizontal displacement under 6px leaves `object-position` unchanged; one at or past 6px changes it. |
| FR6 | With stubbed `videoWidth`/`videoHeight`/viewport geometry producing a known `overflowX`, dragging a known `deltaX` produces the exact `clamp(50 - deltaX/overflowX*100, 0, 100)` result — verified numerically, not just "moved in the right direction." Dragging far past either bound clamps at `0` or `100`, never beyond. With `overflowX === 0` geometry, any `deltaX` leaves the position at `50` (no letterboxing). |
| FR7 | `object-position`'s inline style value always has the form `"<number>% 50%"` while a drag is applying movement — the Y component is never anything other than `50%` in this slice. |
| FR8 | `pointerup`, `pointercancel`, and `pointerleave` each stop further position changes from subsequent `pointermove` events fired with the same (now-released) pointer id. |
| FR9 | After a drag has moved the crop away from `50%`, exiting fill mode (Exit button, `Escape`, or the video being removed while filled) and re-entering Fill on the same video shows `object-position` unset (i.e. back to the CSS default `50% 50%`), not the previously dragged value. |
| FR10 | `getComputedStyle(video).cursor` is `"grab"` while filled and not currently dragged, and `"grabbing"` during an active drag (post-threshold) — checked via `:active` pseudo-class behavior or a direct style assertion depending on what Playwright can observe reliably. |
| FR11 | No new `data-fd-role` element is added by this spec; the existing Fill/Play-Pause/Mute row's tests (`tests/e2e/fill-basic.spec.js`) continue passing unmodified, confirming the button row is unaffected. |

## Test Cases

**Automated (Playwright, real Chromium, run via `make test` inside Docker
— unchanged workflow from the prior spec):**

- `tests/e2e/drag.spec.js` (new, using `tests/fixtures/drag.html`, a
  fixture that stubs `video.videoWidth`/`video.videoHeight` via
  `Object.defineProperty` — the same pattern `fill-basic.spec.js` already
  uses to stub `paused`/`play`/`pause` on a fixture video with no
  decodable source):
  - Dragging left/right past the 6px threshold with known overflow
    geometry moves `object-position`'s X component by the exact expected
    percentage (FR5, FR6, FR7).
  - Dragging with `overflowX === 0` geometry never changes the X
    component from `50` (FR6).
  - Dragging far past either edge clamps at `0` / `100`, not beyond (FR6).
  - A `pointermove` with less than 6px total displacement leaves
    `object-position` unset (FR5).
  - `pointerup` ends the session: a `pointermove` fired afterward with the
    same pointer id has no further effect (FR8).
  - Exiting fill mode (Exit button and, separately, `Escape`) after a drag
    resets `object-position` to unset; re-entering Fill on the same video
    starts from unset/center again (FR9).
  - A `pointerdown`/`pointermove`/`pointerup` sequence dispatched with
    `pointerType: "touch"` produces the same repositioning as the mouse
    case (User Story: touch/pen parity).
  - `pointermove` dispatched *before* Fill is clicked, and a second
    non-primary pointer's events during an active drag, have no effect
    (FR2, FR3).
  - `getComputedStyle` cursor is `grab` while filled/idle and `grabbing`
    mid-drag (FR10).
  - The existing `tests/e2e/fill-basic.spec.js` suite continues to pass
    unmodified against the updated `manifest.json`/`fillTab.js`, confirming
    FR11 (no regression to the button row) and that adding `drag.js` to
    the script load order doesn't break the existing Fill/Exit/Escape
    lifecycle.

**Not covered by the automated suite** (left to manual verification,
matching the prior spec's own carve-out for anything needing a real
decodable video or a real site):

- Real-world "feel" of the drag (smoothness, no visible jank) with an
  actual decodable video file, since fixture videos have no real media
  source and therefore no real `videoWidth`/`videoHeight` without
  stubbing.
- Drag behavior on a real third-party site's video (x.com, YouTube,
  Reddit) — per Requirements.md's Open Questions, not explicitly
  requested but recommended before calling this fully verified in
  production conditions.

## Manual Verification

Starting from a clean checkout of this repo, with `extension/` already
loaded unpacked per the prior spec's step 2:

1. Reload the extension in `chrome://extensions` (or your Chromium-based
   browser's equivalent) after this feature's changes, confirming
   `manifest.json` still loads with no errors and `drag.js` appears in its
   `js` array after `fillTab.js` and before `content.js`.
2. Open a page with a video whose aspect ratio is clearly wider than a
   typical browser window once cropped to fill it (a landscape video
   works well) — a real site (YouTube, an `.mp4` opened directly in a
   tab) or a local test page with a real video file.
3. Click "Fill" on that video (FR2). Confirm the cursor over the video
   reads as a "grab" hand while idle.
4. Press and drag left, then right, with a mouse (FR5-FR7). Confirm:
   - A tiny, sub-threshold nudge doesn't visibly move the crop.
   - A deliberate drag pans the visible content smoothly in the direction
     dragged (dragging left reveals content further right in the source,
     matching the reference implementation's sign convention), with the
     cursor switching to a "grabbing" hand while actively dragging.
   - Dragging as far as possible in one direction stops cleanly at the
     source's edge — no gap/letterbox ever appears on either side.
   - The video never jumps or snaps unexpectedly; releasing the pointer
     leaves the crop exactly where it was when released.
5. Repeat step 4 on a touchscreen or touch-emulated device/DevTools mode
   to confirm touch dragging behaves the same way (User Story: touch/pen
   parity).
6. Confirm dragging vertically has no effect on the crop in this slice —
   only horizontal movement should reposition anything (Requirements.md's
   Out of Scope: horizontal-only).
7. Exit fill mode (Exit button), confirm the video returns to its normal
   in-page size, then click "Fill" again on the same video and confirm the
   crop starts centered again, not wherever it was left before exiting
   (FR9).
8. Repeat step 7 but exit via `Escape` instead of the Exit button, and
   separately by removing/replacing the video element (if testable),
   confirming the reset-on-exit behavior is consistent across every exit
   path.
9. With a video whose cropped source does *not* overflow horizontally at
   the current viewport size (e.g. a portrait video filling a portrait-ish
   browser window), confirm dragging left/right has no visible effect —
   there's nothing to reveal, and the crop stays centered.
10. Confirm the existing Play/Pause and Mute buttons in the row still work
    normally while a video is filled, and that clicking/tapping them does
    not accidentally start a drag on the underlying video (FR11).

## Definition of Done

- Requirements.md, Plan.md, and this Validation.md are complete and
  consistent with the current implementation.
- `extension/drag.js` exists, is wired into `manifest.json`, and
  `fillTab.js`'s `enterFill`/`exitFill` call `attachDrag`/`detachDrag`
  symmetrically.
- `make test` passes, including the new `tests/e2e/drag.spec.js` suite,
  with the full prior suite (`fill-basic.spec.js`,
  `clipping-stacking.spec.js`, `shadow-dom.spec.js`) still green —
  confirming this feature didn't regress fill-mode lifecycle behavior.
- All manual verification steps above pass on at least one real
  wide-aspect video, with both mouse and touch input exercised.
- `README.md` describes horizontal drag-to-reposition as part of Fill
  mode's behavior.
- Vertical dragging remains explicitly out of scope and undocumented as
  "done" anywhere in this spec, matching Requirements.md's Out of Scope.

## Rollback Plan

Client-side-only change with no server or shared-state component, same
rollback story as the prior spec:

- Remove `drag.js` from `manifest.json`'s `js` array and remove the two
  `FD.attachDrag`/`FD.detachDrag` call sites in `fillTab.js` to fully
  disable the feature while keeping Fill mode itself intact — no data
  migration, flag, or persisted state to unwind, since nothing this
  feature writes survives a page reload (FR9's reset-on-exit already
  guarantees no crop position persists across a fill-mode session).
- Alternatively, removing or disabling the extension entirely via
  `chrome://extensions` reverts all behavior immediately, identical to the
  prior spec's rollback path.
