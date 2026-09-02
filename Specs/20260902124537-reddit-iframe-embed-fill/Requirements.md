# Requirements: Reddit Cross-Origin Iframe Embed Fill (RedGIFs & friends)

## Table of Contents

- [Problem Statement](#problem-statement)
- [User Stories](#user-stories)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Out of Scope](#out-of-scope)
- [Open Questions](#open-questions)

## Problem Statement

`extension/manifest.json`'s single `content_scripts` entry matches
`<all_urls>` and omits `all_frames`, which defaults to `false` in
Manifest V3 — so `fillTab.js`, `drag.js`, and `content.js` only ever run
in a tab's top-level document. `content.js`'s discovery already crosses
*open Shadow DOM* boundaries within that document (see
`tests/fixtures/shadow-dom.html`, which reproduces Reddit's own native
`<shreddit-player>` shape), but it can never cross a *frame* boundary —
that's a separate DOM concept `querySelectorAll`/`MutationObserver`
can't bridge regardless of `all_frames`, and no code in this repo
attempts it today.

Many Reddit video posts (verified via a real post's rendered DOM, session
2026-09-02) don't use Reddit's own player at all — they embed a
third-party player, most commonly **RedGIFs**, inside a cross-origin
`<iframe src="https://www.redgifs.com/ifr/...">`. The `<video>` lives in
that iframe's own document, so today's content script never discovers it
and no Fill button ever appears. Other providers Reddit is known to embed
the same way (Imgur `.gifv`/video posts, Streamable, and legacy Gfycat
links which now redirect to RedGIFs) have the identical shape: a
cross-origin iframe hosting the actual `<video>`.

Even granting the iframe-side script `all_frames: true` visibility into
that document is not sufficient by itself: `fillTab.js`'s `fd-fill-active`
class relies on `position: fixed` reaching the tab's real viewport, which
inside a cross-origin iframe only reaches *that iframe's own* viewport
(its rendered box on the Reddit page, typically sized to the post's
preview area, not the full tab). Filling the `<video>` directly inside
the iframe would therefore just blow it up to the iframe's own bounding
box, not the tab — a broken-looking partial fill, not the extension's
existing behavior.

Per discovery with the user, this is deliberately being built as an
**independent, narrowly-scoped mechanism** — a new `reddit_fill.js`,
loaded only on Reddit and known embed-provider domains — rather than
extending the generic `<all_urls>` path to `all_frames: true`. This
keeps the blast radius of the fix confined to Reddit's iframe-embed case
and leaves the already-working generic path (x.com, Instagram, YouTube,
Reddit's own Shadow-DOM player, and everything else `content.js` already
handles) completely untouched.

## User Stories

- Given a Reddit post whose video is embedded via a cross-origin RedGIFs
  iframe, when the viewer opens that post, then a Fill button appears
  next to the video (inside the iframe) just as it would for a
  same-document video.
- Given that Fill button, when the viewer clicks it, then the video
  visually fills the entire browser tab (not just the iframe's small
  preview box), matching the fill behavior already seen on x.com/YouTube,
  and the browser's own tab/address-bar chrome stays visible.
- Given a filled Reddit-embedded video, when the viewer presses `Escape`
  — regardless of whether keyboard focus is currently inside the embed
  iframe or on the outer Reddit page — then the video exits fill mode and
  the page returns to its original layout.
- Given a filled Reddit-embedded video, when the viewer clicks a
  generic-path Fill button elsewhere on the same tab (e.g. another
  same-document video, if one were reachable), then the two mechanisms do
  not fight — only one video is filled at a time, tab-wide, exactly as
  the existing single-active-video guarantee already promises for the
  generic path alone.
- Given a Reddit post embedding a provider other than RedGIFs (Imgur
  video, Streamable), when the viewer opens that post, then the same
  mechanism applies without needing separate site-specific code, so long
  as that provider's domain is covered by the manifest match list.

## Functional Requirements

1. FR1 — `extension/manifest.json` gains a second `content_scripts`
   entry, `all_frames: true`, matching `reddit.com`/`www.reddit.com`
   (Reddit's own top-level pages) plus a list of known Reddit
   embed-provider domains — `redgifs.com` (primary target; covers both
   the `www.redgifs.com` embed host and the `/ifr/` player path) plus
   `i.imgur.com`/`imgur.com` and `streamable.com` as secondary coverage —
   loading a new `extension/reddit_fill.js`. The existing `<all_urls>`
   entry (`fillTab.js`, `drag.js`, `content.js`) is not modified.
2. FR2 — The ancestor clipping/stacking-override computation currently
   private to `fillTab.js` (`computeClippingOverrides`,
   `computeStackingOverrides`, `isSharedAncestor`, and the ancestor-walk
   loop in `neutralizeClippingAncestors`) is extracted into a new shared
   file, `extension/ancestorOverrides.js`, exposing a
   target-agnostic walk (e.g. `FD.neutralizeAncestors(el)` /
   `FD.restoreAncestors(overridden)`) that both `fillTab.js` (walking
   from a `<video>`'s parent, as today) and `reddit_fill.js` (walking
   from an `<iframe>`'s parent) call identically. `fillTab.js` is updated
   to call the shared helper instead of its own private copy; its
   observable behavior for the generic path does not change. Load order
   in both `content_scripts` entries places `ancestorOverrides.js` before
   any file that calls it.
3. FR3 — `reddit_fill.js`, when executing inside an embed-provider iframe
   (i.e. `window.top !== window.self` and the frame's own origin is one
   of the embed-provider domains from FR1), discovers `<video>` elements
   in that frame's document (including inside open Shadow DOM, reusing
   the same traversal shape as `content.js`'s `observeRoot`) and attaches
   a button row (Fill/Exit, Play/Pause, Mute — same `data-fd-role`
   convention as `content.js`) scoped to that frame's own document.
4. FR4 — Clicking Fill in an embed iframe does not apply `fd-fill-active`
   to the `<video>` directly. Instead it `postMessage`s `window.top` a
   typed request (e.g. `{ type: "fd-reddit-fill", action: "enter" }`) and
   locally marks that video/button-row as the pending-active one so a
   second click (now labeled "Exit") can request exit symmetrically.
5. FR5 — `reddit_fill.js`, when executing in the top Reddit frame (i.e.
   `window.top === window.self` and the frame's own origin is
   `reddit.com`), listens for `fd-reddit-fill` messages, validates
   `event.origin` against the FR1 embed-provider domain list, and
   identifies the specific `<iframe>` element that sent the message via
   `event.source === iframeEl.contentWindow` (iterating the top frame's
   own `<iframe>` elements — never guessing by index or URL string
   matching, since a page can embed more than one).
6. FR6 — On a validated `enter` message, the top-frame script applies a
   fixed/inset/full-viewport treatment (new CSS class, e.g.
   `fd-reddit-frame-fill`, mirroring `fillTab.js`'s `.fd-fill-active`
   sizing/z-index rules) to the identified `<iframe>` element itself, and
   calls the FR2 shared helper to neutralize that iframe's own clipping/
   stacking ancestor chain on the Reddit page — the same category of
   fix `fillTab.js` already applies for a same-document video's
   ancestors, just targeting the iframe element instead.
7. FR7 — On a validated `exit` message (or on the conditions in FR9),
   the top-frame script reverses FR6 exactly: removes the fill class from
   the iframe element and restores every neutralized ancestor's original
   inline style via the FR2 shared helper.
8. FR8 — Mutual exclusion holds tab-wide across both mechanisms: before
   entering fill for a Reddit-embedded video, the top-frame script must
   first cause any currently-active generic-path fill
   (`window.__fdExt`'s `fillTab.js` state, running in the same top
   frame) to exit, and vice versa — before the generic path's
   `toggleFill` enters a new video, it must cause any currently-active
   Reddit-iframe fill to exit. This is coordinated through a small shared
   signal on the top frame's own `window.__fdExt` namespace (e.g.
   `FD.requestExclusiveFill(source)` called by both `fillTab.js`'s
   `enterFill` and `reddit_fill.js`'s top-frame message handler before
   each applies its own fill), so only one video — via either mechanism
   — is ever visually filled at a time.
9. FR9 — `Escape` exits a Reddit-iframe fill from either frame: the
   embed-iframe script listens for `Escape` and sends an `exit` message
   (covering the common case where focus is inside the iframe after
   clicking Fill); the top-frame script also listens for `Escape`
   independently and, if a Reddit-iframe fill is currently active,
   performs the FR7 exit directly and notifies the iframe via
   `postMessage` so its button row/state resets too. Both paths converge
   on the same idempotent exit so a double-trigger (e.g. both frames
   observing the same keypress via unrelated means) never errors.
10. FR10 — Play/Pause and Mute controls in the embed iframe's button row
    continue to operate directly on that frame's own `<video>` element
    (no cross-frame messaging needed for these two, since the iframe
    script has direct access to the video it discovered) — matching
    `content.js`'s existing wiring, just running inside the iframe's own
    document instead of the top frame's.
11. FR11 — If a Reddit-embedded video is removed from the iframe's DOM
    while filled (e.g. the user navigates away within an SPA-style
    embed), the iframe script detaches its button row and, if that
    video's fill was active, sends an `exit` message so the top frame
    doesn't leave the iframe stuck in its fixed/full-viewport state —
    mirroring `content.js`'s existing `forceExitIfActive` guard for the
    generic path.

## Non-Functional Requirements

- No new `chrome.*` API usage, no bundler, no new npm dependency — matches
  this repo's existing constraint (`AGENTS.md` Coding Conventions).
- The extension must continue to never insert, move, wrap, or remove any
  existing host-page DOM node in either frame. Applying a fill class and
  temporarily overriding inline style properties on an `<iframe>`
  element's *existing* ancestors (always saved/restored exactly via the
  FR2 shared helper) is the same permitted category of mutation the
  generic path already uses on a `<video>`'s ancestors — just extended to
  a different target element.
- `reddit_fill.js` is an IIFE attaching only to `window.__fdExt`,
  consistent with the existing three scripts — never a bare global. It is
  loaded into different frames simultaneously (top Reddit frame vs. embed
  iframe), so its top-of-file logic must branch cleanly on
  `window.top === window.self` and never assume a particular role.
- Cross-frame messages must validate `event.origin` against the known
  embed-provider domain list before acting on them — the top frame must
  not trust a `postMessage` from an arbitrary, unvalidated origin to
  resize/reposition one of its own `<iframe>` elements.
- The single-active-video guarantee (FR8) must not deadlock or drop a
  fill request if both mechanisms attempt to enter within the same tick
  (e.g. rapid double-click across two different videos) — last request
  wins, matching the existing generic-path behavior in `fillTab.js`'s
  `toggleFill` ("only one video fills at a time").
- The FR2 extraction must not change any existing observable behavior of
  the generic path — `tests/e2e/clipping-stacking.spec.js` must continue
  to pass unmodified (or with only mechanical updates if the refactor
  changes an internal function's location, not its behavior).

## Out of Scope

- Drag-to-reposition (`drag.js`) for Reddit-embedded videos. The embed
  iframe's `<video>` is never itself made `position: fixed` /
  viewport-sized (FR4/FR6 fill the `<iframe>` element instead), so the
  existing `drag.js` cover-scale math — which assumes the dragged
  element's own rendered box equals the fill viewport — does not apply
  directly. Extending drag to this case is a follow-up spec if wanted.
- Covering every conceivable Reddit embed provider exhaustively. RedGIFs
  is the primary, most common case and is fully specified here; Imgur and
  Streamable are included as secondary, best-effort coverage using the
  identical mechanism, but no fixture/manual verification beyond RedGIFs
  is required for this slice (see Validation.md).
- Native Reddit video posts using Reddit's own `<shreddit-player>` custom
  element with an *open* Shadow DOM. That case is already covered by the
  existing generic path today (`tests/fixtures/shadow-dom.html`) and
  needs no change.
- Closed shadow roots inside an embed iframe, or embed iframes nested
  more than one level deep, or embeds sandboxed in a way that blocks
  script injection — accepted, documented limitations, same category as
  the existing closed-shadow-root gap noted in `content.js`.
- Any UI change to the generic path's button row, Fill button label, or
  keyboard shortcuts beyond the FR8/FR9 coordination described above.

## Open Questions

- ⚠️ TODO: The exact RedGIFs iframe host/path was observed as
  `https://www.redgifs.com/ifr/...` in one real post's DOM (session
  2026-09-02) but not exhaustively confirmed across all RedGIFs embed
  variants — confirm the manifest match pattern (`*://*.redgifs.com/*`)
  covers every path RedGIFs actually serves embeds from before shipping.
- ⚠️ TODO: Imgur and Streamable embed DOM shapes were not inspected in
  this session (no real example gathered) — their inclusion in FR1's
  domain list is best-effort based on their being commonly-known Reddit
  embed providers, not verified against real markup. Flag for
  confirmation with a real example before relying on them working,
  or drop them from the first shipped version if that verification
  doesn't happen.
- ⚠️ TODO: Whether `old.reddit.com` and Reddit's mobile web host
  (`m.reddit.com` / `amp.reddit.com`, if still served) need to be in the
  FR1 match list wasn't discussed — confirm which Reddit hostnames the
  user actually browses before finalizing the match pattern.
