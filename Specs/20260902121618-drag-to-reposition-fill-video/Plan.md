# Plan: Drag-to-Reposition (Horizontal) for Filled Video

## Table of Contents

- [Summary](#summary)
- [Technical Approach](#technical-approach)
- [Component Breakdown](#component-breakdown)
- [Dependencies](#dependencies)
- [External / Vendor Documentation Evidence](#external--vendor-documentation-evidence)
- [Flow](#flow)
- [Risk Assessment](#risk-assessment)

## Summary

A new `extension/drag.js` module adds Pointer Events-driven horizontal
panning to a video already in fill mode, ported conceptually from
`home/deck/Documents/Projects/video-manager`'s proven
`VideoFrameState.ApplyDrag` math and `VerticalVideoEditor.razor`'s pointer
wiring, restricted to the horizontal axis per this spec's Requirements.
`fillTab.js` calls into it symmetrically on fill-mode entry/exit, the same
pattern it already uses for the `Escape` listener and the attribute-guard
`MutationObserver`.

## Technical Approach

**Follows the existing per-concern module split**, extending it rather
than restructuring it — `content.js` (discovery/button-row chrome),
`fillTab.js` (fill-mode state machine), and now `drag.js` (drag state for
the currently-filled video). This is exactly the slot the prior spec's
Plan.md left open: "No `drag.js` in this slice — deferred... The file
layout leaves room for it... so the follow-up drag spec adds a file
rather than restructuring existing ones."

**Why the math is ported from `VideoFrameState.ApplyDrag`, not
reinvented:** that C# class already encodes the one non-obvious part of
this feature correctly — converting a raw pointer-pixel delta into a
0-100 `object-position` percentage requires knowing not just the
viewport/video pixel sizes but the *effective `object-fit: cover` scale*
(`max(viewportW/videoW, viewportH/videoH)`), because `object-position`
percentages are relative to the difference between the *scaled* image
size and the viewport, not the raw intrinsic size. Its companion test
suite (`WebApp.Tests/Client/VideoFrameStateTests.cs`) already exercises
the edge cases that matter here: an axis with zero overflow stays locked
(no letterboxing), drag is clamped at both `[0, 100]` bounds, and invalid
(zero/negative) geometry is a no-op. `drag.js` reimplements the same
formula in plain JS, scoped to `X` only per this spec's horizontal-only
decision — `Y` is always written as `50%`.

**Why a drag session lives in a plain closure variable, not a `WeakMap`:**
identical reasoning to `fillTab.js`'s existing fill-mode state — only one
video can be filled (and therefore dragged) at a time, so `drag.js` keeps
one module-level `session` variable (`null` when no drag is active),
mirroring `fillTab.js`'s `activeVideo`/`activeControls` pattern rather than
introducing a new state-tracking style into the codebase.

**Why pointer listeners attach/detach on fill-mode entry/exit rather than
staying permanently registered on every video:** this matches the
existing precedent for both of `fillTab.js`'s per-fill-session listeners
— the `Escape` keydown handler and the attribute-guard `MutationObserver`
are both added in `enterFill` and removed on every exit path, specifically
because a one-shot/always-on listener was already found to be a source of
bugs in the original design doc's `Escape` snippet (prior spec's Risk
Assessment). Registering drag listeners on every discovered video
regardless of fill state would also be wasted work (most videos are never
filled) and would require guarding every handler with an `if (not
filled) return`, which the entry/exit-symmetric approach avoids entirely.

**Why `setPointerCapture` and a 6px threshold:** ported directly from
`VerticalVideoEditor.razor`'s `StartDragAsync`/`MoveDrag` — pointer
capture keeps receiving `pointermove` even if the pointer briefly leaves
the video's box during a fast drag (relevant primarily for touch), and the
threshold (already proven at 6px in the reference) stops an ordinary
click/tap from being misread as a drag. `pointerleave` still ends the
session as a safety net matching the reference's
`@onpointerleave="args => EndDragAsync(args, revealControls: false)"`,
even though a captured pointer's `pointermove` no longer strictly requires
it.

**Why the crop resets via the existing `objectPosition = ""` clear
(FR9), not new state in `drag.js`:** `fillTab.js`'s `exitFill()` already
clears `video.style.objectPosition` on every exit path (it was written in
the prior spec specifically anticipating this feature — see the inline
comment at that line). Because CSS `object-position` defaults to
`50% 50%`, clearing the inline style *is* the reset to center; `drag.js`
doesn't need its own "reset" function or to remember a starting position
across sessions, keeping it stateless between fill-mode entries.

**No new dependencies:** Pointer Events, `getBoundingClientRect`,
`video.videoWidth`/`videoHeight`, and `setPointerCapture` are all
standard, long-stable web platform APIs already implicitly available in
any browser this extension targets — consistent with the existing "no new
runtime package, no bundler" constraint.

## Component Breakdown

**Existing files to modify:**

- `extension/manifest.json` — add `drag.js` to the content script's `js`
  array, positioned after `fillTab.js` (which owns `enterFill`/`exitFill`,
  the functions that call into `drag.js`) and before `content.js` (which
  doesn't reference `drag.js` directly at all — it only ever calls
  `FD.toggleFill`, unchanged by this spec).
- `extension/fillTab.js` — `enterFill(video, controls)` gains one call,
  `FD.attachDrag(video)`, after `video.classList.add("fd-fill-active")`;
  `exitFill()` gains one call, `FD.detachDrag(video)`, before its existing
  `video.style.objectPosition = ""` line (whose comment — "drop any crop
  offset from a future drag feature" — is updated to reflect that this is
  now that feature, not a future one).
- `README.md` — update the feature description to mention horizontal
  drag-to-reposition once implemented, per this repo's existing pattern of
  keeping README user-facing and current (prior spec's Definition of Done
  held the same expectation).

**New files to create:**

- `extension/drag.js` — the drag module: `attachDrag(video)` /
  `detachDrag(video)`, the pointer event handlers, the ported
  `applyHorizontalDrag` math (FR6), and the `grab`/`grabbing` cursor rule
  (injected once into the same `<style>` block pattern `fillTab.js`
  already uses for `.fd-fill-active`, or as a second small `<style>`
  injected by `drag.js` itself — see Risk Assessment for the tradeoff).
- `tests/fixtures/drag.html` — a fixture video with **known, stubbed**
  intrinsic dimensions (`videoWidth`/`videoHeight`, set the same way
  `tests/e2e/fill-basic.spec.js` already stubs `paused`/`play`/`pause` via
  `Object.defineProperty`, since the fixture has no decodable media
  source) so the overflow math in FR6 is deterministic and assertable
  from a Playwright test, loading `fillTab.js`, `drag.js`, and
  `content.js` in the same order as the real `manifest.json`.
- `tests/e2e/drag.spec.js` — the regression tests for FR3-FR10 (see
  Validation.md for the full mapping): threshold behavior, horizontal
  clamping at both bounds, no movement when there's no horizontal
  overflow, reset to center on exit, and a simulated touch drag via
  dispatched pointer events.

## Dependencies

- No new runtime dependency. Testing continues to require only Docker and
  `make` on the host, per the existing `tests/Dockerfile`/`make test`
  workflow — no change to that setup is needed for this spec.
- Playwright's `page.mouse` API and manually dispatched `PointerEvent`s
  (via `page.locator(...).dispatchEvent("pointerdown", {...})` or
  `page.evaluate`) cover the mouse and touch/pen simulation needed for
  `tests/e2e/drag.spec.js` — no additional test tooling required.

## External / Vendor Documentation Evidence

Not applicable — this feature uses only standard, long-stable web
platform APIs (Pointer Events, `setPointerCapture`,
`getBoundingClientRect`, `HTMLVideoElement.videoWidth`/`videoHeight`), all
already relied on elsewhere in this codebase or its reference
implementation. No vendor-specific decision required verification against
official documentation, and no matching docs MCP tool applies.

## Flow

```mermaid
sequenceDiagram
    participant User
    participant Video as filled <video>
    participant Drag as drag.js
    participant FT as fillTab.js

    User->>FT: clicks "Fill" (or Escape/Exit later)
    FT->>Video: classList.add("fd-fill-active")
    FT->>Drag: attachDrag(video)
    Drag->>Video: register pointerdown/move/up/cancel/leave

    User->>Video: pointerdown
    Video->>Drag: pointerdown handler
    Drag->>Video: setPointerCapture(pointerId)
    Drag->>Drag: record session (startClientX, startPositionX,<br/>viewport rect, video.videoWidth/Height)

    User->>Video: pointermove (drag)
    Video->>Drag: pointermove handler
    alt |deltaX| < 6px threshold not yet crossed
        Drag-->>Drag: no-op
    else threshold crossed
        Drag->>Drag: scale = max(vw/vidW, vh/vidH)<br/>overflowX = max(0, vidW*scale - vw)
        alt overflowX > 0
            Drag->>Drag: newPositionX = clamp(startX - deltaX/overflowX*100, 0, 100)
        else
            Drag->>Drag: newPositionX = startPositionX (locked)
        end
        Drag->>Video: style.objectPosition = "<newPositionX>% 50%"
    end

    User->>Video: pointerup / pointercancel / pointerleave
    Video->>Drag: end-of-drag handler
    Drag->>Drag: clear session; release pointer capture

    User->>FT: Escape / Exit / video removed while filled
    FT->>Drag: detachDrag(video)
    Drag->>Video: remove pointer listeners
    FT->>Video: style.objectPosition = "" (resets to center, 50% 50%)
    FT->>Video: classList.remove("fd-fill-active")
```

## Risk Assessment

| Risk | Evidence | Mitigation |
| --- | --- | --- |
| `video.videoWidth`/`videoHeight` are `0` until `loadedmetadata` fires; a drag attempted before that would divide by zero or produce a meaningless scale | Standard `HTMLMediaElement` behavior — not specific to this codebase | FR4: no drag session starts unless both intrinsic dimensions are non-zero at `pointerdown` time; math never runs on stale/zero geometry |
| High-frequency `pointermove` writing `style.objectPosition` on every event could feel janky on lower-end hardware, and each write also touches the `style` attribute the prior spec's attribute-guard `MutationObserver` (FR13/FR14 of that spec) is watching | The guard's `attributeFilter: ["class", "style"]` will fire its callback on every drag-frame style write | The guard's callback body only ever calls `classList.add` when the class is actually missing (unchanged by this spec) — a `style`-only mutation is a cheap early-exit, so the extra callback volume during a drag is not expected to be costly; revisit only if observed to matter in manual testing, same accepted-as-is precedent the prior spec set for its own per-mutation-batch shadow-root scan cost |
| Injecting a second `<style>` block for the `grab`/`grabbing` cursor rule (rather than folding it into `fillTab.js`'s existing single `.fd-fill-active` block) could violate the prior spec's "exactly one `.fd-fill-active` style block" acceptance criterion (FR9) if done carelessly | Prior spec's Validation.md FR9 acceptance criterion is specific to `.fd-fill-active`'s own block count, not styling in general | `drag.js` injects its own separate, once-only `<style>` block for `.fd-fill-active { cursor: grab } .fd-fill-active:active { cursor: grabbing }` — additive, doesn't touch or duplicate `fillTab.js`'s existing block, so the prior FR9 criterion is unaffected; confirmed in `tests/e2e/drag.spec.js` |
| `detachDrag` must be safe to call unconditionally from every `exitFill` path, including one where a drag was never attached (e.g. `Escape` pressed immediately after `Fill` with no pointer interaction) or where it's called twice (e.g. `forceExitIfActive` racing a user-initiated exit) | Symmetric requirement already proven necessary for `fillTab.js`'s own listener add/remove pattern (prior spec's Risk Assessment, the `Escape`-listener leak this codebase already fixed once) | FR's NFR requires idempotency: `detachDrag` checks whether listeners are currently attached (and a session is active) before doing anything, mirroring `fillTab.js`'s own guard style (`if (!activeVideo) return;` in `exitFill`) |
| A fixture video with no decodable source has no real `videoWidth`/`videoHeight`, so the drag math can't be exercised end-to-end without stubbing | Same limitation the prior spec already worked around for `play()`/`pause()`/`paused` in `fill-basic.spec.js` | `tests/fixtures/drag.html` stubs `videoWidth`/`videoHeight` via `Object.defineProperty`, following the exact precedent already established and documented inline in `fill-basic.spec.js` |
