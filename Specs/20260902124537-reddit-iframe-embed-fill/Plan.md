# Plan: Reddit Cross-Origin Iframe Embed Fill (RedGIFs & friends)

## Table of Contents

- [Summary](#summary)
- [Technical Approach](#technical-approach)
- [Component Breakdown](#component-breakdown)
- [Dependencies](#dependencies)
- [External / Vendor Documentation Evidence](#external--vendor-documentation-evidence)
- [Flow](#flow)
- [Risk Assessment](#risk-assessment)

## Summary

Add a second, narrowly-scoped `content_scripts` entry (`reddit_fill.js`,
`all_frames: true`, matched only to Reddit + known embed-provider
domains) that fills a cross-origin embedded `<video>`'s *iframe element*
from the top Reddit frame via `postMessage` coordination, reusing a newly
extracted shared ancestor-override helper so the existing generic path
(`fillTab.js`/`drag.js`/`content.js`, unchanged, still matching
`<all_urls>` with the MV3 default `all_frames: false`) is not touched.

## Technical Approach

This extends the existing per-concern module split (`content.js` =
discovery/UI chrome, `fillTab.js` = fill-mode state machine, `drag.js` =
drag-to-reposition, all communicating through `window.__fdExt`) with two
new pieces rather than modifying that split:

- **`extension/ancestorOverrides.js`** (new, shared) — a straight
  extraction of `fillTab.js`'s existing `computeClippingOverrides`,
  `computeStackingOverrides`, `isSharedAncestor`, and the ancestor-walk
  loop currently inlined in `neutralizeClippingAncestors`, made
  target-agnostic (it already only reads `el.parentElement` and
  `getComputedStyle(el)` — nothing in it actually assumes the starting
  element is a `<video>`). Exposes `FD.neutralizeAncestors(startElement)`
  / `FD.restoreAncestors(overridden)` on `window.__fdExt`. `fillTab.js`'s
  `neutralizeClippingAncestors(video)` becomes a thin call to
  `FD.neutralizeAncestors(video)` — no behavior change, verified by the
  existing `tests/e2e/clipping-stacking.spec.js` continuing to pass
  unmodified.
- **`extension/reddit_fill.js`** (new, site-scoped) — a single IIFE
  loaded into *every* frame matched by its own `content_scripts` entry
  (the top `reddit.com` document and any `redgifs.com`/embed-provider
  iframe on that page), branching once at the top on
  `window.top === window.self` into two roles that never both run in the
  same frame:
  - **Iframe role** (`window.top !== window.self`): reuses the same
    video-discovery shape as `content.js`'s `observeRoot` (querySelectorAll
    + open-Shadow-DOM traversal + `MutationObserver`), but scoped to its
    own document, and attaches a button row identical in spirit to
    `content.js`'s (`data-fd-role="fill"/"play-pause"/"mute"`, its own
    shadow-DOM sibling appended to *its own* `<body>` — iframes have their
    own `document`, so this doesn't touch the top frame's DOM at all,
    keeping the "never insert/move/remove a host node" constraint
    file-scoped correctly). Play/Pause and Mute act on the local `<video>`
    directly (FR10); Fill/Exit instead send `postMessage(window.top, {type:
    "fd-reddit-fill", action, requestId}, "*")` — origin restriction on
    *receipt* happens on the top-frame side (FR5's `event.origin` check);
    the iframe doesn't need to (and generally can't reliably) know the
    top frame's origin in advance, matching the standard
    `postMessage`-to-parent pattern.
  - **Top-frame role** (`window.top === window.self`, on `reddit.com`):
    listens for `message` events, validates `event.origin` against the
    FR1 domain list, resolves the sending `<iframe>` via
    `event.source === iframeEl.contentWindow` (iterating
    `document.querySelectorAll("iframe")`), and owns a small fill-state
    machine parallel to `fillTab.js`'s but targeting the resolved
    `<iframe>` element: adds/removes a `fd-reddit-frame-fill` class
    (mirroring `.fd-fill-active`'s fixed/inset/100vw/100vh/z-index rules,
    defined in its own injected `<style>`, same pattern as `fillTab.js`'s
    `injectFillStyle`), calls `FD.neutralizeAncestors(iframeEl)` /
    `FD.restoreAncestors(...)` from the shared helper, and listens for its
    own `Escape` keydown as a fallback path (FR9).
  - **Cross-mechanism exclusivity (FR8)** — since both `fillTab.js` and
    `reddit_fill.js`'s top-frame role run in the *same* top frame and
    already share `window.__fdExt`, this doesn't need `postMessage` at
    all: add one small arbitration function to the shared namespace,
    `FD.requestExclusiveFill(exitOthers)`, where `exitOthers` is a
    callback the caller provides to undo its own fill. Both
    `fillTab.js`'s `enterFill` and `reddit_fill.js`'s top-frame `enter`
    handler call `FD.requestExclusiveFill(<their own exit fn>)` before
    applying their own fill; the namespace tracks whichever `exitOthers`
    callback is currently "active" and invokes+clears the previous one
    (if any) before recording the new one. This is the same shape as
    `fillTab.js`'s existing internal "only one video fills at a time"
    check in `toggleFill` (`if (activeVideo) exitFill();`), just lifted
    one level so two independent modules can share it.

No existing file's *public* behavior changes for the generic path; the
only edit to an existing file is `fillTab.js`'s internal
`neutralizeClippingAncestors` delegating to the new shared helper instead
of computing overrides inline, plus its `enterFill` gaining the one-line
`FD.requestExclusiveFill(exitFill)` call for FR8.

## Component Breakdown

**Existing files to modify:**

- `extension/manifest.json` — add the second `content_scripts` entry
  (FR1): `matches` covering `reddit.com`/`www.reddit.com` plus
  `redgifs.com`, `imgur.com`/`i.imgur.com`, `streamable.com`;
  `all_frames: true`; `js: ["ancestorOverrides.js", "reddit_fill.js"]`.
  The existing entry's `js` array gains `ancestorOverrides.js` at the
  front (before `fillTab.js`, since `fillTab.js` now calls into it):
  `["ancestorOverrides.js", "fillTab.js", "drag.js", "content.js"]`.
- `extension/fillTab.js` — remove the inlined
  `computeClippingOverrides`/`computeStackingOverrides`/`isSharedAncestor`
  and the walk loop from `neutralizeClippingAncestors`; replace with a
  call to `FD.neutralizeAncestors(video)` / `FD.restoreAncestors(...)`
  from the new shared file. Add one `FD.requestExclusiveFill(exitFill)`
  call near the top of `enterFill` (FR8).
- `AGENTS.md` — Repository Map / Architecture Summary gain the new files
  and the cross-frame mechanism description once implemented (per this
  repo's own documented practice of keeping AGENTS.md in sync — see its
  own "Spec-Kit Workflow" section); tracked here so `/implement-spec`
  doesn't skip it, not restated as a separate requirement.

**New files to create:**

- `extension/ancestorOverrides.js` — shared, target-agnostic ancestor
  clipping/stacking-override walk, extracted from `fillTab.js` (FR2).
- `extension/reddit_fill.js` — the Reddit-specific mechanism described
  above: iframe-role video discovery/button-row/postMessage sender, and
  top-frame-role message handler/iframe-fill state machine, plus the
  shared `FD.requestExclusiveFill` arbitration function (FR3–FR9, FR11).

## Dependencies

- No new runtime dependency. Test-side: the existing Playwright suite
  (`tests/@playwright/test`, Dockerized via `make test`) is extended with
  new fixtures/specs (see Validation.md); Playwright already supports
  multi-frame pages and `postMessage` natively, no new tooling needed to
  simulate the top-frame/iframe split.
- Simulating a genuinely *cross-origin* iframe in a local Playwright
  fixture (needed so `event.origin` validation is exercised for real, not
  bypassed by same-origin defaults) requires two fixture files served
  from two distinct local origins rather than two `file://` documents
  (browsers treat every `file://` document as its own unique opaque
  origin, which would make the origin check trivially "cross-origin" by
  accident and not representative) — see Validation.md's Manual
  Verification and Test Cases for how this is handled with Playwright's
  built-in static server / route interception instead of relying on
  `file://` semantics.

## External / Vendor Documentation Evidence

Not applicable — this feature uses only standard, long-stable Web
Platform APIs already in use elsewhere in this codebase
(`MutationObserver`, `ResizeObserver`, Pointer Events, Shadow DOM) plus
`window.postMessage`/`MessageEvent.origin`/`MessageEvent.source`, all
baseline-stable cross-browser APIs with no vendor-specific behavior
relevant to this design. No official-docs MCP tool lookup was needed.

## Flow

```mermaid
sequenceDiagram
    participant User
    participant EmbedIframe as reddit_fill.js (iframe role, redgifs.com)
    participant TopFrame as reddit_fill.js (top-frame role, reddit.com)
    participant Shared as window.__fdExt (top frame)
    participant FillTab as fillTab.js (top frame, generic path)

    User->>EmbedIframe: Click "Fill" on embedded video
    EmbedIframe->>TopFrame: postMessage({type: "fd-reddit-fill", action: "enter"})
    TopFrame->>TopFrame: Validate event.origin against domain list
    TopFrame->>TopFrame: Resolve <iframe> via event.source === iframeEl.contentWindow
    TopFrame->>Shared: FD.requestExclusiveFill(exitReddit)
    Shared->>FillTab: (if active) invoke stored exitFill, clear it
    TopFrame->>TopFrame: Add fd-reddit-frame-fill class to <iframe>
    TopFrame->>Shared: FD.neutralizeAncestors(iframeEl)
    TopFrame-->>EmbedIframe: (no reply needed; iframe already shows Exit locally)
    User->>EmbedIframe: Press Escape (focus inside iframe)
    EmbedIframe->>TopFrame: postMessage({type: "fd-reddit-fill", action: "exit"})
    TopFrame->>TopFrame: Remove fd-reddit-frame-fill class
    TopFrame->>Shared: FD.restoreAncestors(overridden)
    TopFrame-->>EmbedIframe: postMessage({type: "fd-reddit-fill", action: "exited"})
    EmbedIframe->>EmbedIframe: Reset button row to "Fill"
```

## Risk Assessment

| Risk | Evidence | Mitigation |
| --- | --- | --- |
| A malicious or unrelated iframe on a Reddit page could `postMessage` a forged `fd-reddit-fill` request to resize an `<iframe>` it doesn't own. | `postMessage`'s `event.origin`/`event.source` are the only trust boundary; without validation any frame could spoof the message type. | FR5 requires validating `event.origin` against the exact FR1 domain list before acting, and resolving the target `<iframe>` strictly via `event.source === iframeEl.contentWindow` rather than any request-supplied identifier. |
| Extracting ancestor-override logic into a shared file could silently change the generic path's behavior (this exact code "regressed once from an under-tested change" per `AGENTS.md`'s Constraints). | `AGENTS.md` explicitly calls out prior regression risk in this code and requires a `clipping-stacking.spec.js` update for any change here. | FR2's NFR requires `tests/e2e/clipping-stacking.spec.js` to keep passing unmodified against the extracted version before this ships; the extraction is a pure move, not a rewrite. |
| Two independent state machines (`fillTab.js` and `reddit_fill.js`'s top-frame role) both wanting to be "the one filled video" could race or leave a stale fill applied if `FD.requestExclusiveFill` isn't called consistently. | New coordination surface, no existing precedent beyond `fillTab.js`'s single-video internal check. | FR8 requires *both* entry points to call `FD.requestExclusiveFill` before applying their own fill; Validation.md adds a cross-mechanism test asserting only one fill class (`fd-fill-active` or `fd-reddit-frame-fill`) is ever present at once. |
| RedGIFs (or another embed provider) changes its iframe host/path, or a provider's embed sits behind an additional nested iframe, silently breaking discovery with no visible error to the user. | Noted as an Open Question in Requirements.md — the RedGIFs path was observed from one real post, not exhaustively verified. | Documented as an accepted limitation (Out of Scope); no code can fully mitigate a third party changing their embed shape. Revisit the domain list if reports come in. |
| `all_frames: true` on the new entry runs `reddit_fill.js` in *every* iframe on a matched page, including ones with no video at all (e.g. ads, if any exist on an embed-provider domain in some other context). | `all_frames: true` has no built-in "only if this frame has a video" filter. | The iframe-role discovery (FR3) is a no-op scan/observe if no `<video>` is ever found — matches `content.js`'s existing behavior on pages with no video, no new failure mode introduced. |
