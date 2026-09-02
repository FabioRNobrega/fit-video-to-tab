# Requirements: Chrome Extension — Fill Video (per-video Fill button, no drag)

## Table of Contents

- [Problem Statement](#problem-statement)
- [User Stories](#user-stories)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Out of Scope](#out-of-scope)
- [Open Questions](#open-questions)

## Problem Statement

Most `<video>` elements on the web are rendered inside a page's own layout at
whatever size the host page decided, and there is no built-in way for a
viewer to expand a specific video to fill the viewport without the site
providing that feature itself (and many don't, or only provide it for a
subset of players). [CHROME_EXTENSION_FILL_DRAG_REVISED.md](../../CHROME_EXTENSION_FILL_DRAG_REVISED.md)
lays out a Manifest V3 content-script design for a small "Fill" button shown
next to every video on a page, toggling that video to full-viewport size,
implemented without restructuring the host page's DOM (no wrapper `<div>`
inserted around the video, no elements moved) so it is safe on
framework-managed pages (React/Vue) that reconcile their own subtrees.

This spec covers the first implementation slice: extension shell, the
sibling shadow-DOM overlay, one "Fill" button glued to each on-page video,
the fill-mode toggle itself, and lifecycle handling (videos added/removed
via SPA navigation or infinite scroll). Drag-to-reposition (panning within
the filled video) is explicitly deferred to a later spec — see Out of
Scope.

**Deviation from the design doc's original CSS approach — and back again:**
the design doc (§4) proposed toggling a `fd-fill-active` CSS class
(`position: fixed; inset: 0; ...`) directly on the video. Investigating a
real target site (x.com/Twitter) surfaced a case that approach cannot
handle: Twitter's video is nested several levels deep inside `overflow:
hidden` containers and a `transform`-bearing ancestor (its aspect-ratio/
lazy-load wrapper pattern) — worse than the `transform`-only gap §4 already
accepted, since no CSS positioning on the video itself can escape an
ancestor's clipping box without moving the node in the DOM. This spec
first switched to the browser's native Fullscreen API
(`video.requestFullscreen()`) to solve that. Manual testing then showed
that trade-off wasn't acceptable: native fullscreen hides the browser's
own tab/address-bar chrome (true OS-level fullscreen), not the "fill the
tab, keep chrome visible" look the design doc intended and the product
actually wants. This spec now uses the CSS class approach again, but adds
back the ancestor-neutralization option that was originally set aside as
too risky (§4's ancestor traversal): while a video is filled, any ancestor
whose computed style would clip it or become its `position: fixed`
containing block has its `overflow`/`transform`/`filter`/`contain`
temporarily overridden via inline style, restored exactly (via saved
`cssText`) on exit — see FR6, FR9, FR12–FR14 below and Plan.md's Technical
Approach for the full rationale and the accepted risk.

**Second deviation — Shadow DOM video discovery:** manual testing also
found that Reddit's video player renders its `<video>` inside an *open*
Shadow DOM. `document.querySelectorAll("video")` and a `MutationObserver`
on `document.body` never cross a shadow boundary, so that video was
invisible to the extension entirely (no button shown). FR15–FR16 add
recursive discovery and observation of every open shadow root found on the
page. A *closed* shadow root remains permanently unreachable from a
content script — a browser-level restriction, recorded in Out of Scope.

**Third and fourth findings from continued manual testing on x.com — scope
of ancestor neutralization, and loss of playback controls:** after FR12's
stacking-context fix, filling one video on x.com's infinite-scroll timeline
was found to make *other* timeline videos appear on top of/around the
filled one. Cause: the ancestor walk had no stopping point, so on a page
where many tweets share a common scrollable timeline/list container, the
walk could reach that shared container and un-clip or re-stack every video
under it, not just the target one — the per-tweet wrapper that actually
causes the clip sits well below that shared boundary. FR12 is amended so
the walk stops the moment it reaches an ancestor containing more than one
`<video>` (FR17). Separately, since fill mode removes the video's native
`controls` and no equivalent replaces them, there was no way to play/pause
or mute/unmute while filled. FR18–FR19 add dedicated Play/Pause and Mute
buttons, shown only while a video is filled.

**Fifth finding — FR17 and FR12 were briefly in direct conflict:** stopping
the ancestor walk at the shared boundary (FR17) fixed the concurrent-fill
regression, but reintroduced the stacking-context regression FR12 had just
fixed — because on x.com the ancestor that actually creates the stacking
context trapping the video below the sidebar sits *above* that shared
boundary (the whole timeline, sidebar included, lives under one common
layout wrapper). A single stop point could not satisfy both constraints at
once: clipping overrides must stop at the shared boundary (touching a
shared ancestor's `overflow` reveals sibling videos), but stacking
overrides must NOT stop there (resetting a shared ancestor's `z-index`/
`position`/`opacity` only changes paint order, never sibling visibility, so
it stays safe arbitrarily far up). FR12 is split into two independent
override sets — clipping and stacking — with only the clipping set bounded
by FR17's shared-ancestor stop; the stacking set continues climbing to
`<html>` regardless. See Plan.md's Technical Approach for the full
reasoning.

## User Stories

- Given any webpage with one or more `<video>` elements, when the page
  finishes loading, then a small "Fill" button appears positioned just
  above each video.
- Given a video with a visible "Fill" button, when the user clicks it, then
  that video expands to fill the browser tab (`position: fixed`, viewport
  width/height, `object-fit: cover`) while the browser's own tabs and
  address bar stay visible, and the button's label changes to "Exit". This
  works even when the video is nested inside `overflow: hidden` or
  `transform`-bearing ancestors (e.g. x.com/Twitter's video wrapper
  markup), since those ancestors are temporarily neutralized while filled.
- Given a video currently in fill mode, when the user clicks "Exit" or
  presses `Escape`, then the video returns to its original in-page size and
  position, any native `controls` attribute present before fill mode is
  restored, and every ancestor that was neutralized to reach the true
  viewport is restored to its exact original inline style.
- Given a page where a video is removed from the DOM (SPA navigation,
  infinite-scroll recycling), when the removal happens, then the video's
  button row and its listeners are torn down without leaking DOM nodes or
  event listeners, and if that video was in fill mode, fill mode is exited
  first so no ancestor is left neutralized.
- Given a video rendered inside an open Shadow DOM (e.g. Reddit's player),
  when the page loads or that shadow root's content changes, then the
  video is discovered and gets a "Fill" button exactly as a light-DOM video
  would.
- Given a page where many videos share a common ancestor (e.g. an
  infinite-scroll timeline on x.com), when the user fills one of them, then
  only that video is affected — other videos on the page do not become
  unclipped, repositioned, or visible on top of the filled one.
- Given a video in fill mode, when the user wants to play/pause or mute/
  unmute it, then dedicated Play/Pause and Mute buttons (shown only while
  filled, since native `controls` are hidden during fill mode) let them do
  so without leaving fill mode.

## Functional Requirements

1. FR1 — The extension is a Manifest V3 content script (`matches:
   ["<all_urls>"]`, `run_at: "document_idle"`), with no background service
   worker, per §1 of the design doc.
2. FR2 — On load, the content script creates exactly one `overlayHost`
   `<div>` appended directly to `document.body` (a sibling of the page's own
   tree, never inserted inside a framework-managed subtree) with
   `attachShadow({ mode: "open" })`, per §2.
3. FR3 — The content script discovers all `<video>` elements on the page via
   `document.querySelectorAll("video")` on load, and detects videos added
   afterward via a `MutationObserver` on `document.body`.
4. FR4 — For each discovered video, the extension creates one button row
   element inside the shared shadow root containing a single "Fill" button,
   and keeps that row visually glued to the video's current on-screen rect
   using `getBoundingClientRect()`, updated via `ResizeObserver` on the
   video plus `scroll` (capture phase, to catch nested scroll containers)
   and `resize` listeners on `window`, per §3.
5. FR5 — The button row is positioned at `rect.top - rowHeight` (clamped to
   a minimum of `0`) and never inserts anything into the page's own layout
   flow — it is purely `position: fixed` in viewport coordinates.
6. FR6 — Clicking "Fill" toggles the `fd-fill-active` class on the target
   `<video>` element directly (no wrapper element), matching the design
   doc's original §4 mechanism: records whether native `controls` was
   present beforehand via `dataset.fdControls`, removes the `controls`
   attribute while active, and changes the button's label to "Exit". Only
   one video may be in fill mode at a time; toggling Fill on a second video
   while another is active exits the first.
7. FR7 — While a video has `fd-fill-active` set, pressing `Escape` exits
   fill mode the same way clicking "Exit" does. The `Escape` listener is
   added on entering fill mode and removed on exit (by any means), so it
   never lingers to affect a later, unrelated `Escape` press.
8. FR8 — Exiting fill mode (via "Exit" or `Escape`) restores the
   `controls` attribute if `dataset.fdControls === "1"`, clears any
   `object-position` crop offset left on the video's inline style, and
   resets the button label back to "Fill".
9. FR9 — The `.fd-fill-active` CSS rule (`position: fixed; inset: 0; width:
   100vw; height: 100vh; object-fit: cover; z-index: 2147483647; background:
   #000;`, all `!important`) is injected once as a `<style>` element
   appended to `document.head` (not inside the shadow root, since it must
   apply to the video element which lives on the host page), per §4.
10. FR10 — When a video element is removed from the page (detected via the
    same `MutationObserver`), the extension exits fill mode first if that
    video was active (FR8's cleanup, so no ancestor is left neutralized —
    see FR12), then calls that video's `cleanup()` — disconnecting its
    `ResizeObserver`, removing its `scroll`/`resize` listeners, and
    removing its button row from the shadow root — and drops its entry so
    it can be garbage-collected, per §6.
11. FR11 — Per-video state (button row, `ResizeObserver`, cleanup function)
    is tracked in a `WeakMap` keyed by the video element, per §6.
    Fill-mode state (which video, if any, is currently filled) is tracked
    separately, since only one video can be filled at a time.
12. FR12 — On entering fill mode, the extension walks up the video's
    ancestor chain toward `<html>`, and for each ancestor computes two
    independent sets of overrides — saving that ancestor's current inline
    `style.cssText` and applying only whichever properties actually need
    it (computed per-ancestor, not a blanket set):
    - **Clipping/containing-block** overrides — non-`visible` `overflow`/
      `overflow-x`/`overflow-y`; `transform`/`filter`/`perspective`/
      `clip-path` other than `none`; `contain` other than `none`;
      `will-change` including `transform` — so `position: fixed` on the
      video reaches the true viewport instead of being clipped or
      repositioned relative to that ancestor. Per FR17, this set is only
      applied below the shared-ancestor boundary.
    - **Stacking-context** overrides — `position: fixed` or `sticky`; a
      positioned ancestor (`position` not `static`) with a `z-index` other
      than `auto`; `opacity` other than `1`; `mix-blend-mode` other than
      `normal`; `isolation: isolate` — so the video paints above the rest
      of the page, including the host page's own fixed UI (e.g. x.com's
      sidebar/header). Unlike clipping overrides, this set is applied
      **regardless of FR17's boundary**, all the way to `<html>` — see
      FR17 and Plan.md's Technical Approach for why the two sets need
      different stopping rules.

    On exit, every overridden ancestor's `style.cssText` is restored
    exactly to its saved value.
13. FR13 — While a video is in fill mode, the extension observes
    `attributes` changes (`class`, `style`) on that `<video>` element via a
    dedicated `MutationObserver`; if an external script removes the
    `fd-fill-active` class while the extension's own fill-mode state still
    considers the video active, the extension re-applies the class so the
    video remains filled until the user explicitly exits (button or
    `Escape`). This mirrors the residual-risk mitigation from the design
    doc's §4 for sites like YouTube that actively re-render their player.
14. FR14 — The attribute-watching `MutationObserver` from FR13 is only
    active while a given video is in fill mode; it is disconnected on exit
    (FR8) and on video removal (FR10) to avoid leaking observers or
    fighting the host page outside fill mode.
15. FR15 — Video discovery and the `MutationObserver` lifecycle (FR3, FR10)
    also recurse into every *open* Shadow DOM found on the page: when an
    element with a non-null `.shadowRoot` is discovered (at initial scan or
    via mutation), that shadow root is scanned for existing `<video>`
    elements and given its own `MutationObserver` with the same
    `{childList: true, subtree: true}` config, so videos added later inside
    that shadow root (or a shadow root nested within it) are still
    detected. Each shadow root is only ever scanned/observed once.
16. FR16 — A *closed* shadow root (`element.shadowRoot === null` from the
    content script's perspective) is not discoverable and is not a
    functional gap this extension can close — see Out of Scope.
17. FR17 — The moment FR12's ancestor walk reaches an ancestor containing
    more than one `<video>` descendant (approximated via
    `querySelectorAll("video").length > 1`, light DOM only), clipping
    overrides stop being applied — to that ancestor and every further one —
    since overriding `overflow`/`transform`/etc. there would un-clip or
    reposition every other video sharing that ancestor, not just the one
    being filled. Stacking overrides are unaffected by this boundary and
    keep being applied above it, since they don't reveal or reposition
    sibling content — only change paint order (see FR12).
18. FR18 — While a video is in fill mode, a Play/Pause button and a Mute
    button (hidden otherwise) are shown alongside "Exit" in that video's
    button row. Play/Pause calls `video.play()`/`video.pause()` depending
    on `video.paused`; Mute toggles `video.muted`. Both buttons' labels
    stay in sync with the video's actual `paused`/`muted` state — via the
    video's own `play`/`pause`/`volumechange` events — regardless of
    whether that state changed through these buttons, the host page's own
    UI, or a keyboard shortcut.
19. FR19 — The Play/Pause and Mute buttons are shown on entering fill mode
    and hidden again on exit (by any means), matching the same lifecycle
    as the "Exit" label on the Fill/Exit button (FR6, FR8).

## Non-Functional Requirements

- The extension must never insert, move, wrap, or remove any existing
  host-page DOM node — this is the core safety constraint from §2 of the
  design doc (avoiding SPA reconciliation crashes). It may: set attributes/
  classes/inline styles directly on the `<video>` element it targets;
  temporarily override specific inline-style properties on the video's
  existing ancestors while filled, per FR12, always restored to their
  exact prior `cssText` on exit; and append its own sibling `overlayHost`
  to `<body>`. Overriding an ancestor's inline style is a property write,
  not a tree-structure change, so it does not carry the same
  reconciliation-crash risk a wrapper `<div>` or a moved node would.
- All button-row styling must live inside the shadow root so it cannot leak
  into, or be overridden by, host-page CSS, except the FR9
  `.fd-fill-active` rule and FR12's ancestor overrides, which must target
  elements on the host page and so cannot live in the shadow root.
- `overlayHost` and all button rows use `z-index: 2147483647` (max signed
  32-bit int) to stay above host-page content; `overlayHost` itself has
  `pointer-events: none` so it never blocks clicks on the underlying page
  except where a button row (which sets `pointer-events: auto`) sits.
- No content-script behavior should require network access, remote code,
  or a background service worker.
- FR13's attribute-guard `MutationObserver` must not create an infinite
  mutation loop: it only re-applies the `fd-fill-active` class when it is
  actually missing, so re-application does not itself keep re-triggering
  the observer once the class is back in place.
- FR15's shadow-root discovery must not re-scan or double-observe the same
  shadow root (tracked via a `WeakSet`), and must not attempt to access a
  closed shadow root's contents (FR16).

## Out of Scope

- Drag-to-reposition (§5 of the design doc) — panning the video's
  `object-position` within the filled viewport via `pointerdown`/
  `pointermove`/`pointerup` and the `applyDrag` math. Deferred to a
  follow-up spec once Fill-only behavior is verified working.
- Cross-origin iframes, CSP edge cases, or multi-frame video — out of
  scope per §8 of the design doc.
- Discovering video inside a *closed* Shadow DOM (FR16) — not solvable
  from a content script; a hard browser restriction, not a scoping choice.
- Any build tooling, bundler, or packaging pipeline — plain JS files loaded
  directly per the manifest.
- Publishing to the Chrome Web Store.

## Open Questions

- ⚠️ TODO: No target browser other than Chrome (Manifest V3) was specified.
  If Firefox/Edge/Safari support is needed later, MV3 content scripts are
  broadly compatible, but this was not confirmed.
- ⚠️ TODO: No specific real sites beyond "YouTube's player" (mentioned in
  the design doc as the motivating example), x.com/Twitter (surfaced
  during manual testing as a clipping-ancestor case), and Reddit/redgifs
  (surfaced during manual testing as a Shadow DOM case) were named for
  verification. Validation.md proposes these three plus a plain-`<video>`
  test page as manual check targets — confirm these are sufficient, or
  provide additional sites to check.
- ⚠️ TODO: Neutralizing clipping/transform ancestors while a video is
  filled (FR12) is a known-risky mitigation the discovery step originally
  set aside in favor of the (later rejected) Fullscreen API. It has not
  yet been manually verified against a page whose own CSS animations or
  layout depend on the neutralized properties while fill mode is active —
  see Validation.md's manual verification and Plan.md's Risk Assessment.
- ⚠️ TODO: FR17's "more than one `<video>`" heuristic for where to stop the
  ancestor walk is light-DOM-only (`querySelectorAll` doesn't see into
  shadow roots) and assumes sibling videos are always nested under a common
  ancestor reachable this way. It fixed the observed x.com case, but hasn't
  been verified against a page that shares videos across siblings in some
  other structural pattern (e.g. a virtualized list that keeps sibling
  video DOM nodes detached/reparented outside the obvious shared
  container).
