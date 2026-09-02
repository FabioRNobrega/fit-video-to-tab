# Agent Context

## Table of Contents

- [Agent Context](#agent-context)
  - [Project Overview](#project-overview)
  - [Repository Map](#repository-map)
  - [Architecture Summary](#architecture-summary)
  - [Execution Environment](#execution-environment)
  - [Coding Conventions](#coding-conventions)
  - [Constraints](#constraints)
  - [Available Commands](#available-commands)
  - [Spec-Kit Workflow](#spec-kit-workflow)
  - [Key Documentation](#key-documentation)

## Project Overview

Fill Video is a Manifest V3 Chrome extension: a single content script that
adds a small "Fill" button next to every `<video>` on any page, letting a
viewer expand that video to fill the browser tab (not true OS fullscreen)
without restructuring the host page's DOM. It's a greenfield, plain-JS
project — no bundler, no framework, no `package.json` at the repo root.
The only npm dependency in the repo (`@playwright/test`) belongs to the
isolated test suite under `tests/`, not to the extension itself.

## Repository Map

- `extension/` — the shipped Manifest V3 extension: `manifest.json`,
  `ancestorOverrides.js` (shared ancestor clipping/stacking-override walk
  and the cross-module fill-exclusivity arbiter), `content.js` (video
  discovery, the shadow-DOM overlay, button-row lifecycle), `fillTab.js`
  (fill-mode state machine, Play/Pause + Mute wiring), `drag.js`
  (horizontal drag-to-reposition for the currently-filled video, wired
  into `fillTab.js`'s enter/exit lifecycle), `reddit_fill.js` (Reddit
  cross-origin embed-iframe fill — RedGIFs primarily, also Imgur/
  Streamable — a separate mechanism loaded only on those domains; see
  Architecture Summary).
- `tests/` — a self-contained Playwright regression suite (Dockerized —
  see Execution Environment). `tests/fixtures/*.html` reproduce the actual
  DOM shapes behind real bugs found on x.com and Reddit (plus one, `drag.html`,
  that stubs known intrinsic video dimensions for deterministic drag-math
  assertions; and `reddit-top.html`/`reddit-embed.html`/
  `reddit-top-untrusted-embed.html`, the cross-origin-iframe fixture pair
  for the Reddit embed mechanism — see `tests/e2e/helpers/serveRepoAtOrigin.js`
  for how they're served from a genuinely distinct origin);
  `tests/e2e/*.spec.js` are the corresponding tests;
  `tests/package.json`/`playwright.config.js` are scoped to `tests/` only,
  not the repo root.
- `Specs/` — SDD-style spec folders (`<14-digit-timestamp>-<slug>/`), each
  with `Requirements.md`, `Plan.md`, `Validation.md`. Three specs so far:
  `20260902101903-chrome-extension-fill-video/` (the Fill-only slice),
  `20260902121618-drag-to-reposition-fill-video/` (horizontal
  drag-to-reposition; vertical dragging remains a further follow-up — see
  that spec's Out of Scope), and
  `20260902124537-reddit-iframe-embed-fill/` (Reddit cross-origin embed
  iframe fill — RedGIFs primarily, also Imgur/Streamable).
- `README.md` — user-facing: what the extension does, how it works, how
  to install it unpacked, how to run the tests.
- `Makefile` — orchestrates the test suite via Docker (`test`,
  `test-build`, `test-clean`).

## Architecture Summary

`extension/manifest.json` declares two `content_scripts` entries. The
first matches `<all_urls>` (default `all_frames: false`, so it only ever
runs in a tab's top-level document) and loads four plain, unbundled IIFE
scripts in this order — `ancestorOverrides.js`, `fillTab.js`, `drag.js`,
then `content.js` — communicating through one shared namespace object,
`window.__fdExt` (chosen over bare globals specifically to avoid
colliding with the host page's own global scope). The second entry
matches only `reddit.com` plus known embed-provider domains
(`redgifs.com`, `imgur.com`, `streamable.com`), sets `all_frames: true`,
and loads `ancestorOverrides.js` + `reddit_fill.js` — see "Reddit
cross-origin embed fill" below for why this is a second, independent
entry rather than an extension of the first.

- **`ancestorOverrides.js`** holds the ancestor clipping/stacking-override
  walk (`FD.neutralizeAncestors(startElement)` /
  `FD.restoreAncestors(overridden)`) shared by `fillTab.js` (walking from
  a `<video>`'s parent) and `reddit_fill.js` (walking from an `<iframe>`
  element's parent), plus a small cross-module exclusivity arbiter,
  `FD.requestExclusiveFill(exitOthers)` — see "Cross-mechanism
  exclusivity" below.
- **`content.js`** is the orchestrator: it appends one sibling `<div>`
  (`overlayHost`, with an open Shadow DOM) directly to `<body>`, then
  recursively discovers every `<video>` on the page — including inside
  *open* Shadow DOM subtrees (`observeRoot(root)`, generalized to work on
  `document.body` or any discovered `shadowRoot` alike, tracked via a
  `WeakSet` so each root is only scanned/observed once). For each video it
  creates a button row (Fill/Exit, Play/Pause, Mute — tagged with
  `data-fd-role` attributes for testability) inside the shared shadow
  root, kept glued to the video via `ResizeObserver` + scroll/resize
  listeners computing `getBoundingClientRect()`. Per-video state (row,
  `ResizeObserver`, `cleanup()`) lives in a `WeakMap`.
- **`fillTab.js`** owns fill-mode's state machine for whichever single
  video is currently filled (module-level variables, not a `WeakMap` — the
  design only ever supports one filled video at a time). Filling toggles a
  `fd-fill-active` CSS class (`position: fixed`, viewport-sized,
  `object-fit: cover`) directly on the video — deliberately *not* the
  native Fullscreen API, which was tried and rejected because it hides the
  browser's own tab/address-bar chrome. To reach the true viewport past a
  page's own clipping/transform ancestors, and to paint above the page's
  own fixed UI (e.g. a site's fixed sidebar), `enterFill` calls
  `ancestorOverrides.js`'s `FD.neutralizeAncestors(video)`, which computes
  two independent override sets while walking the ancestor chain —
  clipping (overflow/transform/filter/perspective/contain/clip-path/
  will-change) and stacking (position:fixed/sticky, z-index, opacity,
  mix-blend-mode, isolation) — saving/restoring each touched ancestor's
  exact `style.cssText`. Only the clipping set is bounded by a
  shared-ancestor stop (any ancestor containing more than one `<video>`);
  the stacking set is not, since it only changes paint order and can never
  reveal a sibling video's content. This split exists because a single
  stop point for both sets could not satisfy both constraints on real
  pages (x.com) — see
  `Specs/20260902101903-chrome-extension-fill-video/Requirements.md`'s
  Problem Statement, fifth finding, for the incident that drove this.
  `enterFill` also calls `FD.requestExclusiveFill(exitFill)` so a Reddit
  cross-origin embed fill (below) can't be active at the same time.
- **`drag.js`** owns horizontal drag-to-reposition for whichever single
  video is currently filled (module-level `session`/`activeVideo`, same
  single-video-at-a-time shape as `fillTab.js`'s own state). Exposes
  `attachDrag(video)`/`detachDrag(video)`, called by `fillTab.js`'s
  `enterFill`/`exitFill` — never runs on a video that isn't filled.
  `pointerdown` captures the pointer and records a drag session (start
  `clientX`, start `object-position` X, the video's rendered viewport rect,
  and its intrinsic `videoWidth`/`videoHeight`); `pointermove`, once past a
  6px threshold, recomputes the crop position using the same
  cover-scale/overflow math as
  `home/deck/Documents/Projects/video-manager`'s `VideoFrameState.ApplyDrag`
  (`scale = max(viewportW/videoW, viewportH/videoH)`, `overflowX = max(0,
  videoW*scale - viewportW)`, clamped `[0, 100]`), restricted to the X axis
  only — Y always stays `50%`. Ported conceptually (not literally) from
  that Blazor/WebAssembly reference project — see
  `Specs/20260902121618-drag-to-reposition-fill-video/`.

### Fill lifecycle

`content.js`'s Fill button calls `fillTab.js`'s `toggleFill(video,
controls)`, where `controls` is `{ fillBtn, playPauseBtn, muteBtn }`.
Entering fill mode: adds the class, snapshots/removes native `controls`,
runs the ancestor walk, calls `FD.attachDrag(video)`, shows Play/Pause +
Mute, adds an `Escape` keydown listener (added on entry, removed on exit
through *either* path — a correctness fix over the original design doc's
one-shot listener, which could otherwise misfire later), and starts a
`MutationObserver` on the video's own `class`/`style` attributes that
re-applies `fd-fill-active` if an external script strips it (observed on
YouTube). Exiting (by any means — Exit click, Escape, or the video being
removed from the DOM, via `content.js` calling `FD.forceExitIfActive(video)`
before cleanup) reverses all of the above — including `FD.detachDrag(video)`
and clearing `object-position` back to center — and restores every
neutralized ancestor exactly.

### Reddit cross-origin embed fill

Many Reddit video posts embed a third-party player (RedGIFs primarily,
also Imgur/Streamable) inside a cross-origin `<iframe>`, so the `<video>`
lives in a document the `<all_urls>` entry never sees (`all_frames`
defaults to `false`), and even with visibility, `position: fixed` inside
a cross-origin iframe only reaches that iframe's own rendered box, not
the tab's real viewport. `reddit_fill.js` is a single IIFE loaded into
every frame matched by its own `content_scripts` entry, branching once on
`window.top === window.self` into one of two roles that never both run in
the same frame:

- **Embed-iframe role** (`redgifs.com`/`imgur.com`/`streamable.com`):
  discovers `<video>` elements in its own document (same Shadow-DOM-aware
  traversal shape as `content.js`'s `observeRoot`) and attaches its own
  button row, scoped to its own document (its own shadow-DOM sibling
  appended to its own `<body>` — never touches the top frame's DOM). Fill/
  Exit clicks don't touch the video's styles; they `postMessage` the top
  frame (`{ type: "fd-reddit-fill", action: "enter" | "exit" }`) and
  optimistically flip the row's own label. Play/Pause and Mute act on the
  local `<video>` directly. `Escape` inside this frame also sends `exit`.
- **Top-frame role** (`reddit.com`): listens for `message` events,
  validates `event.origin` against the embed-provider allowlist before
  acting, resolves which `<iframe>` element sent it by recursively
  searching `document.body` *and every open shadow root* for one whose
  `contentWindow === event.source` (real Reddit nests the embed iframe
  inside its own player-wrapper custom element's shadow root — a plain
  `document.querySelectorAll("iframe")` never finds it there; found via
  manual testing against a real post, not anticipated in the original
  Plan). On a match, applies the fill sizing (fixed/inset/100vw/100vh,
  `border: 0`, high `z-index`) as an **inline style** on the `<iframe>`
  element itself (saving/restoring its prior `style.cssText`) — not a
  class backed by a `document.head` stylesheet, because an open Shadow
  DOM is its own style scope and a stylesheet rule in the outer document
  never reaches an element nested inside one; a `fd-reddit-frame-fill`
  class is still added/removed alongside it purely as a test/styling
  hook, not as what actually produces the visual fill. Also calls
  `FD.neutralizeAncestors(iframeEl)`/`FD.restoreAncestors(...)` from
  `ancestorOverrides.js`, whose ancestor walk itself now crosses back out
  of a shadow root via `shadowRoot.host` (plain `.parentElement` stops at
  a shadow boundary) so it can keep escaping the page's *light-DOM*
  ancestors above the shadow host, not just the ones inside it. Also
  listens for `Escape` independently (so it works regardless of which
  frame has focus) and notifies the embed iframe via `postMessage` on any
  exit path so that frame's button row resets too.

**Cross-mechanism exclusivity**: both `fillTab.js`'s `enterFill` and
`reddit_fill.js`'s top-frame `enter` handler call
`FD.requestExclusiveFill(<their own exit function>)` before applying
their own fill. The arbiter (in `ancestorOverrides.js`) evicts whichever
exit function was previously registered if it differs from the new one,
so only one video — via either mechanism — is ever filled at a time
tab-wide. Both exit functions are idempotent (safe to call when nothing
of theirs is active), which is what makes this safe to call
unconditionally. See
`Specs/20260902124537-reddit-iframe-embed-fill/`.

## Execution Environment

The extension itself needs no build step — load `extension/` unpacked via
`chrome://extensions` (Developer Mode → Load unpacked). See README.md.

The test suite runs only inside Docker; nothing is installed on the host
beyond Docker and `make`:

```bash
make test          # build the test image, then run the Playwright suite
make test-build     # build only
make test-clean      # remove the built image
```

`tests/Dockerfile` builds from `mcr.microsoft.com/playwright:v1.47.0-jammy`
(Chromium pre-installed, version-matched to the pinned `@playwright/test`
in `tests/package.json`), installs test dependencies before copying
source so editing `extension/*.js` or a spec file doesn't invalidate the
install layer, then runs `npx playwright test` from `tests/`.

## Coding Conventions

- No `chrome.*` API usage anywhere in the extension — this is intentional
  (§1 of the design doc: "no background worker needed") and is also what
  makes the test suite possible: all scripts run identically whether
  loaded as an extension or as plain `<script>` tags on a fixture page.
- Every file is an IIFE attaching only to `window.__fdExt`; never add a
  bare global.
- `ancestorOverrides.js` before `fillTab.js`, then `drag.js`, then
  `content.js` in the `<all_urls>` entry's `js` array is load order, not
  incidental — `fillTab.js` calls `FD.neutralizeAncestors`/
  `FD.requestExclusiveFill` from `ancestorOverrides.js` and `FD.attachDrag`/
  `FD.detachDrag` from `drag.js` as soon as fill mode toggles, and
  `content.js` calls into `window.__fdExt` as soon as it runs. Likewise
  `ancestorOverrides.js` before `reddit_fill.js` in the Reddit-scoped
  entry. Any new test fixture that loads `fillTab.js` must also load
  `ancestorOverrides.js` first, or `enterFill` throws (`FD.neutralizeAncestors`
  is undefined) the moment Fill is clicked.
- The extension must never insert, move, wrap, or remove any existing
  host-page DOM node. It may only: set attributes/classes/inline styles on
  the `<video>` (or, for the Reddit embed-iframe mechanism, the `<iframe>`)
  it targets, temporarily override specific inline-style properties on
  that element's *existing* ancestors (always saved/restored exactly), and
  append its own single sibling `overlayHost` to `<body>` — in whichever
  document it's running in, never a different document.
- Interactive elements the extension adds get a `data-fd-role` attribute
  (`fill`, `play-pause`, `mute`) rather than relying on button text or DOM
  order for identification — this is what the test suite targets.
- Test fixtures under `tests/fixtures/` are built to reproduce the actual
  DOM shape of a real bug (documented in each fixture's own comments),
  not just arbitrary sample markup — keep that pattern for new fixtures.

## Constraints

- Spec folders are named `<14-digit-timestamp>-<slug>/` and must sort
  strictly after any existing one — see the Spec-Kit Workflow section.
- Vertical dragging is explicitly out of scope for the current drag spec
  (`Specs/20260902121618-drag-to-reposition-fill-video/`); `drag.js` only
  ever writes the X component of `object-position`, Y stays `50%` — don't
  fold vertical-axis work into it without a new (or amended) spec.
- Do not reintroduce the native Fullscreen API for fill mode — it was
  deliberately tried and rejected (see Requirements.md's Problem
  Statement) because it hides browser chrome, which is not the intended
  behavior.
- Any change to the ancestor-neutralization logic in `ancestorOverrides.js`
  should come with an update to `tests/e2e/clipping-stacking.spec.js` (the
  generic path) and `tests/e2e/reddit-iframe-fill.spec.js` (the Reddit
  iframe path, which shares this code) — this exact logic has already
  regressed once from an under-tested change (see Architecture Summary).
- `reddit_fill.js`'s embed-provider allowlist (`EMBED_ORIGIN_RE`) must
  stay in sync with `manifest.json`'s second `content_scripts` entry's
  `matches` list — a domain added to one without the other either can
  never send a trusted `postMessage` (regex omitted) or loads a script
  that can never actually run there (manifest match omitted).

## Available Commands

| Command | Purpose |
| --- | --- |
| `make test` | Build the Docker test image and run the full Playwright suite |
| `make test-build` | Build the Docker test image only |
| `make test-clean` | Remove the built Docker test image |

There is no build/lint/format command for the extension itself — it is
loaded unpacked as-is (see README.md's Install section).

## Spec-Kit Workflow

Specs live under `Specs/<timestamp>-<slug>/` with three files
(`Requirements.md`, `Plan.md`, `Validation.md`); `/new-spec` creates one
and `/implement-spec` implements the most recent one (highest timestamp
prefix). Requirements use numbered `FR` labels referenced by Plan.md and
Validation.md. Treat a spec as a living document: when real-world testing
changes the implementation (as happened repeatedly in the current spec —
Fullscreen API tried and reverted, ancestor neutralization added, Shadow
DOM discovery added, the clipping/stacking split), update the spec's three
files to match, don't just fix the code.

## Key Documentation

- [README.md](README.md) — what the extension does, how to install and
  test it.
- [Specs/20260902101903-chrome-extension-fill-video/](Specs/20260902101903-chrome-extension-fill-video/)
  — the Fill-only spec: `Requirements.md`, `Plan.md`, `Validation.md`.
- [Specs/20260902121618-drag-to-reposition-fill-video/](Specs/20260902121618-drag-to-reposition-fill-video/)
  — the horizontal drag-to-reposition spec: `Requirements.md`, `Plan.md`,
  `Validation.md`.
- [Specs/20260902124537-reddit-iframe-embed-fill/](Specs/20260902124537-reddit-iframe-embed-fill/)
  — the Reddit cross-origin embed iframe fill spec: `Requirements.md`,
  `Plan.md`, `Validation.md`.
