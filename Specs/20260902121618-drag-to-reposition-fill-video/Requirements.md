# Requirements: Drag-to-Reposition (Horizontal) for Filled Video

## Table of Contents

- [Problem Statement](#problem-statement)
- [User Stories](#user-stories)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Out of Scope](#out-of-scope)
- [Open Questions](#open-questions)

## Problem Statement

`extension/fillTab.js`'s `.fd-fill-active` CSS class fills the tab with
`object-fit: cover`, which crops whichever axis of the source video
overflows the viewport — but always around the fixed center point
(`object-position`'s default, `50% 50%`). For a video whose aspect ratio
doesn't match the viewport (the common case a portrait tab shows a
landscape source, or vice versa), the viewer has no way to shift which
part of the cropped content is visible; whatever content sits left/right
of center is simply cut off with no way to bring it into view.

This was already anticipated: `extension/fillTab.js`'s `exitFill()` clears
`video.style.objectPosition` with the comment "drop any crop offset from a
future drag feature" (line 182), and
[Specs/20260902101903-chrome-extension-fill-video/](../20260902101903-chrome-extension-fill-video/)'s
AGENTS.md entry explicitly defers "drag-to-reposition (panning within the
filled video)" as a follow-up spec, matching §5 of
[CHROME_EXTENSION_FILL_DRAG_REVISED.md](../../CHROME_EXTENSION_FILL_DRAG_REVISED.md).
This spec is that follow-up.

The reference implementation and its proven drag math live in a sibling
project, `home/deck/Documents/Projects/video-manager`
(`WebApp/WebApp.Client/Models/VideoFrameState.cs`'s `ApplyDrag`, wired up
by `WebApp/WebApp.Client/Components/VerticalVideoEditor.razor`'s pointer
handlers) — a Blazor/WebAssembly app, not this project's plain-JS
extension, so this spec ports the *algorithm and interaction pattern*,
not any code, into a new `extension/drag.js`.

Per discovery with the user, this first slice is intentionally
**horizontal-only**: the vertical axis (`object-position`'s Y component)
stays locked at `50%`, matching the "focus is on left/right" framing of
the request. Full two-axis dragging (matching `VideoFrameState`'s
`PositionY`/`overflowY` handling) is left as a possible future extension
— see Out of Scope.

## User Stories

- Given a filled video whose source is wider (after cover-scaling) than
  the current tab viewport, when the user presses and drags left/right
  with a mouse, then the visible crop window shifts to reveal content
  further right/left in the source, up to the point where the opposite
  edge of the source reaches the viewport edge.
- Given a filled video whose source has no horizontal overflow after
  cover-scaling (e.g. its width already matches or is narrower than the
  viewport at the scale `object-fit: cover` applies), when the user drags
  left/right, then the crop position does not move — there is never a
  visible gap/letterbox on either side.
- Given a filled video, when the user drags using touch or a pen instead
  of a mouse, then the same repositioning behaves identically, since all
  three input types are unified through Pointer Events.
- Given the user has dragged a video's crop away from center, when they
  exit fill mode (Exit button or `Escape`) and later re-enter Fill on the
  same video, then the crop starts centered again — drag position is not
  remembered across a fill-mode exit/re-entry.
- Given the user merely clicks "Fill" or clicks/taps the video without
  moving the pointer past a small threshold, when the pointer is released,
  then the crop position is unchanged and the click is not misinterpreted
  as a drag.

## Functional Requirements

1. FR1 — A new module, `extension/drag.js`, owns horizontal drag-to-reposition
   state for whichever single video is currently in fill mode, matching
   the per-concern module split already established by `content.js`
   (discovery/UI chrome) and `fillTab.js` (fill-mode state machine). It
   exposes `attachDrag(video)` / `detachDrag(video)` on the shared
   `window.__fdExt` namespace.
2. FR2 — `fillTab.js`'s `enterFill(video, controls)` calls
   `FD.attachDrag(video)` after adding the `fd-fill-active` class, and its
   `exitFill()` calls `FD.detachDrag(video)` before (or alongside) its
   existing `video.style.objectPosition = ""` reset — so drag listeners
   are only ever live while a video is actually filled, symmetric to how
   the existing `Escape` keydown listener and the attribute-guard
   `MutationObserver` are added on entry and removed on every exit path
   (design doc §5; prior spec's FR7, FR13/FR14).
3. FR3 — `attachDrag(video)` registers `pointerdown`, `pointermove`,
   `pointerup`, `pointercancel`, and `pointerleave` listeners on the video
   element itself (no new DOM node). `detachDrag(video)` removes exactly
   those listeners and ends any drag session already in progress. Only the
   primary pointer (`event.isPrimary`) starts a drag; a second concurrent
   pointer is ignored.
4. FR4 — On `pointerdown`, the video calls `setPointerCapture(pointerId)`
   and a drag session records: the pointer id, the starting `clientX`, the
   video's current horizontal crop position (0-100, defaulting to 50 —
   see FR6), and the geometry needed for FR6's math — the video's current
   rendered viewport box (`getBoundingClientRect()`; while filled this
   equals the full tab viewport) and its intrinsic source dimensions
   (`video.videoWidth` / `video.videoHeight`). If `videoWidth` or
   `videoHeight` is `0` (metadata not yet loaded), no drag session starts.
5. FR5 — A drag session does not change the crop position until the
   pointer has moved at least 6px horizontally from its `pointerdown`
   position (matching `VerticalVideoEditor.razor`'s `DragThreshold`) — so
   a plain click/tap on the video (e.g. one that misses every button in
   the row) never nudges the crop.
6. FR6 — Once the threshold is crossed, each `pointermove` recomputes the
   horizontal crop position using the same normalized-overflow math as
   `VideoFrameState.ApplyDrag`, restricted to the horizontal axis:
   - `scale = max(viewportWidth / videoWidth, viewportHeight / videoHeight)`
     — the effective `object-fit: cover` scale factor.
   - `overflowX = max(0, videoWidth * scale - viewportWidth)` — how many
     CSS pixels of the cover-scaled source extend past the viewport
     horizontally.
   - If `overflowX > 0`: `newPositionX = clamp(startPositionX - (deltaX /
     overflowX * 100), 0, 100)`, where `deltaX` is the current pointer
     `clientX` minus the `pointerdown` `clientX`.
   - If `overflowX === 0`: the position does not change from
     `startPositionX` — there is never a source edge shown short of the
     viewport edge (no letterboxing).
   The vertical component of `object-position` is always written as
   `50%` in this slice (see Out of Scope).
7. FR7 — The computed horizontal position is applied by setting
   `video.style.objectPosition` to `"<positionX>% 50%"` on every qualifying
   `pointermove`, mirroring `VerticalVideoEditor.razor`'s `VideoStyle`
   binding.
8. FR8 — `pointerup`, `pointercancel`, and `pointerleave` each end the
   current drag session (release pointer capture if still held, clear
   session state) without changing the crop position beyond wherever the
   last qualifying `pointermove` left it.
9. FR9 — Exiting fill mode by any path (Exit button, `Escape`, or a video
   being removed from the DOM while filled — the existing `forceExitIfActive`
   path) resets the crop back to center: `fillTab.js`'s existing
   `video.style.objectPosition = ""` clears the inline style entirely, so
   `object-position` falls back to its CSS default (`50% 50%`) the next
   time the video is filled. `attachDrag`/`detachDrag` do not need to
   track or restore a "starting" position across fill-mode sessions
   because of this.
10. FR10 — While a drag session is in progress (threshold already
    crossed), the video's cursor is `grabbing`; while filled but not
    currently dragged, it is `grab`. Outside fill mode, the video's cursor
    is unaffected (default).
11. FR11 — Dragging must not require, add, or depend on any new visible
    DOM element (no drag handle, no new row button) — the existing
    Fill/Play-Pause/Mute button row (`data-fd-role` convention) is
    unaffected by this feature, since it lives in a separate shadow-DOM
    sibling positioned independently of pointer events on the video
    itself.

## Non-Functional Requirements

- No new `chrome.*` API usage, no bundler, no new npm dependency in
  `extension/` — matches this repo's existing constraint (AGENTS.md
  Coding Conventions).
- The extension must continue to never insert, move, wrap, or remove any
  host-page DOM node; drag adds only pointer-event listeners and an
  inline `object-position`/cursor style write on the `<video>` element it
  already targets, both already-permitted categories of mutation under
  the existing NFR from the prior spec.
- `drag.js` is an IIFE attaching only to `window.__fdExt`, consistent with
  `fillTab.js` and `content.js` — never a bare global.
- Pointer listeners must not leak: every listener added by `attachDrag`
  must be removable by `detachDrag`, and `detachDrag` must be idempotent
  (safe to call on a video that was never dragged, or twice in a row) so
  it can be called unconditionally from every fill-exit path without
  first checking whether a drag was ever attached.
- The horizontal-overflow math (FR6) must degrade safely to "no movement"
  when `overflowX` is `0` or when intrinsic video dimensions are
  unavailable, never producing `NaN`, `Infinity`, or an out-of-`[0,100]`
  percentage.

## Out of Scope

- Vertical dragging (`object-position`'s Y component / `PositionY` +
  `overflowY` in the `VideoFrameState` reference). The Y component is
  always written as a fixed `50%` in this slice. A later spec can extend
  `drag.js` to the second axis using the same overflow math, mirrored on
  `Y`/`clientY`/`videoHeight`/viewport height.
- A manual "reset crop to center" control (`video-manager`'s Reset crop
  button). Per discovery with the user, drag-only is sufficient for this
  slice; the existing every-exit reset (FR9) already returns to center
  without a dedicated button.
- Persisting crop position across a fill-mode exit/re-entry, a page
  reload, or navigation — every fill-mode entry starts centered (FR9).
- Any on-screen readout of the current crop position (e.g.
  `video-manager`'s "Crop position: X% horizontal" caption) — this
  extension's UI stays minimal, matching its existing button-row-only
  chrome.
- Dragging while a video is *not* in fill mode (i.e. at its native
  in-page size) — the design doc and the prior spec scope panning to
  filled videos only.
- Keyboard-driven repositioning (arrow keys) — pointer/touch drag only,
  matching the reference implementation and the user's request.

## Open Questions

- ⚠️ TODO: Whether a future spec should extend this to full two-axis
  (horizontal + vertical) dragging, matching the complete
  `VideoFrameState` reference, was intentionally deferred rather than
  decided against — revisit once horizontal-only ships and is validated.
- ⚠️ TODO: No specific real sites were named for manual drag verification
  beyond the fixtures this spec adds (see Validation.md). The prior
  spec's real-site walkthrough (x.com, youtube.com, Reddit) should be
  repeated with drag exercised on at least one wide-aspect and one
  narrow-aspect real video, but this wasn't explicitly requested — confirm
  before treating manual verification as complete.
