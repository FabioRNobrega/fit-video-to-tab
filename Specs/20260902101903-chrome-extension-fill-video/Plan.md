# Plan: Chrome Extension — Fill Video (per-video Fill button, no drag)

## Table of Contents

- [Summary](#summary)
- [Technical Approach](#technical-approach)
- [Component Breakdown](#component-breakdown)
- [Dependencies](#dependencies)
- [External / Vendor Documentation Evidence](#external--vendor-documentation-evidence)
- [Flow](#flow)
- [Risk Assessment](#risk-assessment)

## Summary

A Manifest V3 content script that, without altering the host page's DOM
tree structure, shows a small "Fill" button above every `<video>` on the
page and toggles that video to fill the browser tab on click —
implementing §1–§4 and §6 of
[CHROME_EXTENSION_FILL_DRAG_REVISED.md](../../CHROME_EXTENSION_FILL_DRAG_REVISED.md)
largely as-is, plus two additions surfaced by manual testing against real
sites: ancestor neutralization to reach the true viewport past clipping/
transform wrapper elements (x.com), and recursive open-Shadow-DOM
discovery (Reddit). An earlier iteration of this slice used the native
Fullscreen API instead of §4's CSS class — see Requirements.md's Problem
Statement for why that was tried and then reverted. This is a greenfield
project — no existing repo conventions to extend — so the file layout
below establishes the conventions this and future specs (drag, packaging)
will follow.

## Technical Approach

Everything lives in plain, unbundled JS files loaded directly by
`manifest.json` — no build step, per the project's "keep it simple, no
over-engineering" framing and because no bundler/package.json exists yet.

**Responsibility split** (single-responsibility per file, matching §7 of
the design doc):

- `content.js` owns video discovery (recursive: light DOM plus every open
  Shadow DOM, `MutationObserver`-driven, per FR15–FR16), creation/teardown
  of the shared shadow-root overlay, and per-video button-row lifecycle
  (creation, position sync via `ResizeObserver`/scroll/resize, cleanup on
  removal). It is the orchestrator — it does not know the details of what
  "Fill" does, only that clicking the button calls into `fillTab.js`, and
  that it must ask `fillTab.js` to exit fill mode before tearing down a
  video that's being removed (FR10).
- `fillTab.js` owns everything about fill-mode state for a single video:
  toggling the `fd-fill-active` class, tracking/restoring the `controls`
  attribute, the `Escape` key handler (added/removed per fill-mode
  entry/exit, not a one-shot listener — see Risk Assessment), the
  ancestor-neutralization walk on entry and its exact restoration on exit
  (FR12), and the attribute-guard `MutationObserver` (FR13/FR14) that
  re-applies the fill class if an external script strips it. This isolates
  fill-mode's state machine — the riskiest part of this slice, since it's
  the only part that mutates DOM nodes it doesn't own (ancestor inline
  styles) — behind a small, independently reasoned-about module rather
  than folding it into the generic video-discovery loop in `content.js`.
- No `drag.js` in this slice — deferred per Requirements.md's Out of Scope.
  The file layout leaves room for it (§7 of the design doc already reserves
  the name) so the follow-up drag spec adds a file rather than restructuring
  existing ones.

**Why a shadow-root sibling overlay, not a wrapper element:** the design
doc's core fix over earlier drafts was moving from "wrap the video in a new
`<div>`" (crashes SPA reconciliation because React/Vue don't expect a
foreign node inside a subtree they own) to "one sibling node appended to
`<body>`, visually glued via `getBoundingClientRect()`". This plan keeps
that decision as-is — it is the reason this design doc exists — and does
not revisit it.

**Why fill-mode is the design doc's `fd-fill-active` CSS class again, plus
ancestor neutralization — not the Fullscreen API:** an earlier iteration of
this slice used `video.requestFullscreen()` specifically to escape a real
target site's clipping ancestors (x.com/Twitter nests its `<video>` inside
`overflow: hidden` wrapper divs plus a `transform`-bearing ancestor).
Manual testing then showed that trade-off — true OS-level fullscreen,
hiding the browser's own tab/address-bar chrome — wasn't what the product
actually wants; "Fill" is meant to fill the tab, not leave it. The CSS
class approach is back, with the design doc's own §4 "ancestor traversal"
option (originally set aside as too risky) added on top: on entering fill
mode, walk the video's ancestors and neutralize, per-ancestor and only as
needed, whatever would clip the video (non-`visible` `overflow`), become
its `position: fixed` containing block (`transform`/`filter`/
`perspective`/`contain`/`clip-path`/`will-change: transform`), or trap it
inside a nested stacking context that outranks its `z-index` regardless of
value (`position: fixed`/`sticky`; a positioned ancestor with a `z-index`;
`opacity`/`mix-blend-mode`/`isolation: isolate`) — this last category was
added after manual testing on x.com showed the video reaching the true
viewport but still rendering *behind* the site's own fixed header/sidebar,
since one of its ancestors created a stacking context our first pass
didn't account for. Each ancestor's full `style.cssText` is saved
beforehand so exit restores it exactly. This is a property write on
existing elements, not a tree-structure change, so it doesn't carry the
wrapper-`<div>`/moved-node reconciliation risk — but it can still
visibly disturb a host page's own CSS animations or layout on that
ancestor for as long as fill mode is active, which is the accepted risk
recorded in Requirements.md's Open Questions and the Risk Assessment below.

**Why the ancestor walk stops at a shared ancestor for clipping, but not
for stacking (FR12, FR17):** on x.com's infinite-scroll timeline, the
original unbounded walk reached a container shared by multiple tweets and
un-clipped/re-stacked every video under it, not just the one being filled
— other timeline videos started appearing on top of the filled one. The
fix is a cheap, structural check rather than trying to enumerate every
site's specific markup: stop applying clipping overrides the instant an
ancestor contains more than one `<video>` (`querySelectorAll("video")
.length > 1`), since by construction any ancestor above that point also
contains more than one video and overriding its `overflow`/`transform`
would reveal or reposition every video under it, not just the target one.

That fix alone then reintroduced the *previous* regression: on x.com the
ancestor that actually creates the stacking context trapping the video
below the sidebar sits *above* the shared-timeline boundary (the whole
timeline, sidebar included, lives under one common layout wrapper) — so
stopping the walk there meant the stacking-context fix could no longer
reach it. The two override sets need different stopping rules because
they have different blast radii: overriding a shared ancestor's `overflow`
reveals sibling video content (a real regression), but overriding its
`z-index`/`position`/`opacity` only changes *paint order* — it never makes
another video visible, resized, or repositioned. So `fillTab.js` computes
clipping and stacking overrides as two separate functions
(`computeClippingOverrides`/`computeStackingOverrides`); the walk applies
both below the shared-ancestor boundary and only the stacking set above
it, tracked with a single `pastSharedAncestor` flag that flips (and stays
flipped) the first time `isSharedAncestor(el)` is true. The per-tweet
wrapper responsible for the original clip still sits below that boundary
in every case observed so far, so neither fix undoes the other.

**Why Play/Pause and Mute buttons (FR18–FR19):** fill mode already hides
the video's native `controls` (§4's original behavior, unchanged), which
means once filled there was no way to play/pause or mute/unmute — a real
usability gap, not just a missing nice-to-have. Rather than re-adding
native `controls` (which would reintroduce the sizing/positioning the
design doc's `fd-fill-active` class deliberately overrides), `content.js`
adds two small buttons to the existing row, hidden by default and shown
only while that specific video is filled. They operate directly on the
video's own `play()`/`pause()`/`muted` — no new state machine — and stay
in sync via the video's own `play`/`pause`/`volumechange` events, so they
reflect reality even if playback state changes some other way (the host
page's own script, a keyboard shortcut, etc.).

**Testability, and why automated tests were added mid-slice:** manual
testing alone had already let one fix (FR17) silently undo a previous one
(FR12's stacking-context fix) without anyone noticing until the next
manual pass on x.com — exactly the kind of regression an automated
regression suite exists to catch. `tests/` adds a Playwright suite that
runs entirely inside Docker (see Dependencies) and loads the real
`extension/*.js` files as plain `<script>` tags against purpose-built
fixture pages that reproduce the actual DOM shapes each bug was found on
(a per-video clipping wrapper nested in a multi-video shared container
nested in a stacking-context-creating layout wrapper, and a Shadow-DOM
video). This works because the content script has no `chrome.*`
dependency and no messaging (§1) — it runs identically as a page script or
as a loaded extension, so no extension-loading harness is needed to test
it faithfully in a real browser engine (chosen over jsdom specifically
because `getComputedStyle`, `ResizeObserver`, real layout, and real
stacking-context/paint-order behavior — which FR12's fix depends on
entirely — aren't meaningfully emulated by jsdom). See
`tests/e2e/clipping-stacking.spec.js` for the regression tests covering
FR12/FR17 directly, and Validation.md for the full test-case mapping.
`fillTab.js`'s state transitions are still kept free of unnecessary direct
DOM query calls where possible, so the on/off logic stays easy to reason
about independently of the positioning logic in `content.js`.

**No new dependencies:** everything uses browser-native APIs
(`MutationObserver`, `ResizeObserver`, Shadow DOM, `chrome.*` is not even
needed since this is a pure content script with no messaging). No npm
packages, no bundler, no background service worker — consistent with the
design doc's explicit "no background worker needed" (§1) and this spec's
NFR against remote code/network dependencies.

**Why video discovery recurses into Shadow DOM:** manual testing on Reddit
found its video player rendered inside an open Shadow DOM, invisible to
plain `document.querySelectorAll("video")` and to a `MutationObserver`
scoped to `document.body` — neither crosses a shadow boundary. `content.js`
generalizes its scan/observe step into a single `observeRoot(root)`
function usable on `document.body` or any open `shadowRoot` alike: each
root is scanned once for existing videos and other open shadow roots
inside it, then given its own `MutationObserver` so later additions are
still caught. A `WeakSet` of already-observed roots keeps this idempotent
if the same shadow root is reachable via more than one discovery path. A
*closed* shadow root's contents are permanently inaccessible to a content
script (`element.shadowRoot` reads as `null`) — not a scoping choice, a
platform restriction, per FR16.

## Component Breakdown

**Existing files to modify** (created in an earlier pass of this same
slice; each subsequent revision below is an update to them, not a new
file: CSS fill mode + ancestor neutralization; Shadow DOM discovery;
stopping the ancestor walk at a shared ancestor; Play/Pause + Mute
controls; splitting the ancestor walk into clipping vs. stacking override
sets with independent stop conditions):

- `extension/manifest.json` — MV3 manifest per §1: single content script,
  `matches: ["<all_urls>"]`, `run_at: "document_idle"`, `fillTab.js` listed
  before `content.js` in `js` so `content.js` can call into
  `window.__fdExt` (the shared namespace both files attach to, chosen over
  bare globals to avoid colliding with the host page's own globals) as
  soon as it loads.
- `extension/content.js` — overlay host + shadow root creation (§2);
  recursive light-DOM-and-open-Shadow-DOM video discovery via
  `observeRoot(root)` (FR15–FR16); `attachButtonRow(video)` per §3 (row
  creation, `ResizeObserver`, scroll/resize sync, `syncPosition`); creates
  and wires the Play/Pause and Mute buttons per video (FR18–FR19),
  including the `play`/`pause`/`volumechange` listeners that keep their
  labels in sync regardless of what changed the video's state; tags each
  button with a `data-fd-role` attribute (`fill`/`play-pause`/`mute`) so
  the Playwright suite (see below) can target them without depending on
  DOM order or text content; `videoState` `WeakMap` (§6, FR11); wires each
  row's Fill button `click` to `fillTab.js`'s `toggleFill(video,
  controls)`, where `controls` is `{ fillBtn, playPauseBtn, muteBtn }`;
  calls `FD.forceExitIfActive(video)` before cleaning up a removed video's
  row (FR10).
- `extension/fillTab.js` — `toggleFill(video, controls)`: toggles the
  `fd-fill-active` class (FR6), `dataset.fdControls` bookkeeping (FR6,
  FR8), the `Escape` keydown handler added on entry and removed on exit by
  any means (FR7), ancestor neutralization on entry and exact restoration
  on exit — `computeClippingOverrides`/`computeStackingOverrides` as two
  separate functions, only the former bounded by FR17's shared-ancestor
  stop (FR12, FR17) — the attribute-guard `MutationObserver` (FR13/FR14),
  showing/hiding `controls.playPauseBtn`/`controls.muteBtn` on enter/exit
  (FR18–FR19), and a one-time `injectFillStyle()` that appends the
  `.fd-fill-active` `<style>` block to `document.head` (FR9). Only one
  video's state is tracked at a time (module-level variables, not a
  `WeakMap`), matching the constraint that only one video can be filled at
  once.

**New files created (this revision) — automated regression tests:**

- `tests/Dockerfile` — builds from `mcr.microsoft.com/playwright:v1.47.0-jammy`
  (Chromium pre-installed, version-matched to `@playwright/test`); installs
  `tests/package.json`'s one dependency before copying source, so editing
  `extension/*.js` or a spec file doesn't invalidate the install layer.
- `tests/package.json` / `tests/playwright.config.js` — pins
  `@playwright/test@1.47.0`; single `chromium` project; `testDir:
  ./e2e`.
- `tests/fixtures/plain.html` — one plain `<video controls>`, loads
  `fillTab.js`/`content.js` as plain `<script>` tags (works unmodified
  since the content script has no `chrome.*` dependency, per §1).
- `tests/fixtures/clipping-stacking.html` — reproduces the exact x.com
  shape behind FR12/FR17: a per-video `overflow:hidden` clipping wrapper,
  inside a shared `#timeline` holding **two** videos (exercises FR17's
  boundary), inside an `#app` wrapper with its own `z-index` stacking
  context shared with a simulated fixed `#sidebar` (exercises FR12's
  stacking-context fix reaching *above* that boundary).
- `tests/fixtures/shadow-dom.html` — a custom element with an open
  `shadowRoot` containing a `<video>`, reproducing the Reddit shape behind
  FR15.
- `tests/e2e/fill-basic.spec.js` — Fill/Exit/Escape lifecycle, native
  `controls` restore, Play/Pause + Mute visibility and wiring (FR6–FR9,
  FR18–FR19).
- `tests/e2e/clipping-stacking.spec.js` — the direct regression tests for
  FR12/FR17: filled video reaches the true viewport; paints above a fixed
  sidebar; does not affect a sibling video sharing the same ancestor;
  stacking overrides above the shared boundary are applied and restored
  correctly.
- `tests/e2e/shadow-dom.spec.js` — FR15: Fill/Exit works for a
  Shadow-DOM-nested video.

## Dependencies

- Chrome (or another Manifest V3–compatible Chromium browser) with
  Developer Mode / "Load unpacked" available for manual testing — no
  Chrome Web Store publishing in this slice.
- No runtime services, databases, or environment variables.
- No build tooling required to run the extension itself; "build" is
  `zip`-equivalent packaging, out of scope per Requirements.md.
- Running the automated test suite requires only Docker and `make` on the
  host — no Node, npm, or browser install. `tests/Dockerfile` is built
  from `mcr.microsoft.com/playwright:v1.47.0-jammy`, which ships Chromium
  already matching the `@playwright/test` version pinned in
  `tests/package.json`, so no browser download happens inside the
  container either. `make test` builds the image and runs the suite;
  nothing touches the host beyond the Docker build cache.

## External / Vendor Documentation Evidence

Not applicable — this feature is built entirely on standard, long-stable
web platform APIs (`MutationObserver`, `ResizeObserver`, Shadow DOM,
`getBoundingClientRect`) and the Chrome Extensions Manifest V3 content
script format, which the design doc already specifies concretely (matches
pattern, `run_at`, no background worker). No vendor-specific design
decision in this slice required verification against current Microsoft/
Azure/AWS documentation, and no matching official-docs MCP tool applies to
Chrome extension APIs, so none was consulted.

## Flow

```mermaid
sequenceDiagram
    participant Page as Host Page DOM
    participant CS as content.js
    participant FT as fillTab.js
    participant User

    CS->>Page: observeRoot(document.body): scan for videos + open shadow roots
    CS->>Page: create overlayHost + shadow root (append to body)
    loop for each video found (incl. inside open shadow roots)
        CS->>CS: attachButtonRow(video) -> row in shadow root
        CS->>CS: ResizeObserver.observe(video); syncPosition()
    end
    Note over CS,Page: each open shadow root discovered gets its own<br/>MutationObserver, so later shadow-DOM additions are caught too (FR15)

    User->>CS: clicks "Fill" button
    CS->>FT: toggleFill(video, { fillBtn, playPauseBtn, muteBtn })
    FT->>Page: video.classList.add("fd-fill-active")
    FT->>Page: remove controls attribute (store prior state)
    FT->>Page: neutralizeClippingAncestors(video)
    Note over FT,Page: walk stops at the first ancestor containing<br/>more than one video (FR17), so sibling videos are never touched
    FT->>Page: save + override each remaining clipping/stacking ancestor's inline style
    FT->>FT: add Escape keydown listener
    FT->>FT: start attribute-guard MutationObserver on video
    FT-->>User: button label -> "Exit"; show Play/Pause + Mute buttons

    User->>CS: clicks Play/Pause or Mute
    CS->>Page: video.play()/pause() or video.muted = !video.muted
    Page->>CS: "play"/"pause"/"volumechange" event
    CS-->>User: button label updates to match actual video state

    Note over Page: host page re-renders and strips the class (e.g. YouTube)
    Page->>FT: attribute MutationObserver fires
    FT->>Page: re-apply fd-fill-active class

    User->>FT: clicks "Exit" or presses Escape
    FT->>Page: video.classList.remove("fd-fill-active")
    FT->>Page: restore controls attribute if it was present
    FT->>Page: restore every neutralized ancestor's saved style.cssText
    FT->>FT: remove Escape listener; disconnect attribute-guard MutationObserver
    FT-->>User: button label -> "Fill"

    Page->>CS: video element removed from DOM (SPA nav / recycling)
    CS->>FT: forceExitIfActive(video) (if it was filled, exit first)
    CS->>CS: cleanup() -> disconnect ResizeObserver, remove listeners, remove row
```

## Risk Assessment

| Risk | Evidence | Mitigation |
| --- | --- | --- |
| Neutralizing a clipping/transform/stacking-context ancestor's inline style can visibly disturb that ancestor's own layout, CSS animation, transition, or z-order for as long as fill mode is active | This is exactly the risk the design doc's §4 "ancestor traversal" option, and this spec's own discovery step, originally flagged and set aside in favor of the (later rejected) Fullscreen API | Every overridden ancestor's full `style.cssText` is saved before any change and restored verbatim on exit (FR12), so the disturbance is bounded to "while filled" and never persists; the video itself covers the full viewport while filled, so most layout disturbance underneath is not visible anyway; accepted as a known trade-off, recorded in Requirements.md's Open Questions, not yet manually verified against an animation-heavy page (Validation.md) |
| Overriding `overflow`/`transform`/etc. alone is not sufficient to paint the video above the host page's own fixed UI — a nested ancestor stacking context (position:fixed/sticky, a positioned z-index, opacity<1, mix-blend-mode, isolation:isolate) can still outrank the video's z-index regardless of its numeric value, since z-index only competes within a shared stacking context | Observed directly during manual testing on x.com: the video reached the true viewport but rendered behind the site's own fixed header/sidebar | FR12 additionally detects and neutralizes stacking-context-creating ancestor properties (not just clipping/containing-block ones), computed per-ancestor so only what's actually needed is overridden |
| `Escape` listener leaking or double-firing if entered/exited through different paths | Design doc's original §4 snippet registers `keydown` with `{once: true}` on every Fill click, which — if exit instead happens via the "Exit" button — leaves that listener attached to fire (incorrectly) on a later, unrelated `Escape` press | This plan's `fillTab.js` explicitly adds the listener on entry and removes it on exit through *either* path (FR7), rather than relying on `{once: true}`, closing that gap in the original snippet |
| The attribute-guard `MutationObserver` (FR13) re-applying the class could itself trigger another mutation callback, looping | `fillTab.js`'s guard observes `class`/`style` on the video while fill-active | Guard only calls `classList.add` when the class is actually missing, so a re-application that succeeds doesn't itself re-trigger unbounded callbacks (NFR in Requirements.md) |
| Script load order between `content.js` and `fillTab.js` if `manifest.json` lists them as classic (non-module) scripts | MV3 `content_scripts.js` array loads files in listed order as separate global-scope classic scripts by default | `fillTab.js` is listed before `content.js` in the manifest's `js` array so `window.__fdExt.toggleFill`/`injectFillStyle` exist before `content.js` references them; confirmed via manual "Load unpacked" test (Validation.md) rather than a vendor doc lookup |
| Memory/listener leaks if a video is removed without the `MutationObserver` catching it (e.g. removed via `innerHTML =` on an ancestor without triggering `childList` on the observed subtree) | `MutationObserver` with `{childList: true, subtree: true}` on each observed root should catch this, but SPA frameworks sometimes batch DOM writes in ways that could be missed | `WeakMap`-keyed state (FR11) means an unreachable video is still garbage-collected even if `cleanup()` never runs; the row DOM node would leak until then — accepted as-is for this slice, revisit only if observed in manual testing |
| Scanning every element (`querySelectorAll("*")`) on each newly discovered root to find nested open shadow roots (FR15) has a real but bounded cost | Runs once per discovered root (tracked via `WeakSet`, not repeated), and once per batch of `MutationObserver`-reported additions | Accepted as-is for this slice; only worth optimizing if observed to matter on a specific heavy page during manual testing |
| Unbounded ancestor neutralization on a page where many videos share a common ancestor (e.g. an infinite-scroll timeline) un-clips every video under that shared ancestor, not just the target one | Observed directly during manual testing on x.com: filling one tweet's video made other timeline videos appear on top of it | FR17: clipping overrides stop the instant the walk reaches an ancestor containing more than one `<video>` (light-DOM `querySelectorAll` check); regression-tested in `tests/e2e/clipping-stacking.spec.js` (sibling video's ancestor/class untouched after fill) — not yet verified against every possible site structure (Requirements.md's Open Questions) |
| Fixing FR17 by stopping the *entire* ancestor walk at the shared boundary silently undid FR12's stacking-context fix, since the real stacking-context-creating ancestor on x.com sits above that boundary | Found only on a follow-up manual pass on x.com — no automated test existed yet to catch it, which is exactly why one was added afterward | FR12 splits into two override sets with independent stop conditions (clipping bounded by FR17, stacking not); `tests/e2e/clipping-stacking.spec.js` asserts both fixes hold simultaneously (full-viewport reach, paints above a simulated sidebar, sibling video unaffected) in one suite, and was confirmed to fail when the split was manually reverted during development |
| Hiding native `controls` in fill mode leaves no way to play/pause or mute/unmute | Direct consequence of FR6/§4's original design — `fd-fill-active` was always meant to replace native sizing, which implicitly drops native controls too | FR18–FR19: dedicated Play/Pause and Mute buttons, shown only while filled, operate directly on `video.play()`/`pause()`/`muted` and stay in sync via the video's own `play`/`pause`/`volumechange` events regardless of what changed that state |
