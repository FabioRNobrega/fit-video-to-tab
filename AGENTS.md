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
  `content.js` (video discovery, the shadow-DOM overlay, button-row
  lifecycle), `fillTab.js` (fill-mode state machine, ancestor
  neutralization, Play/Pause + Mute wiring).
- `tests/` — a self-contained Playwright regression suite (Dockerized —
  see Execution Environment). `tests/fixtures/*.html` reproduce the actual
  DOM shapes behind real bugs found on x.com and Reddit; `tests/e2e/*.spec.js`
  are the corresponding tests; `tests/package.json`/`playwright.config.js`
  are scoped to `tests/` only, not the repo root.
- `Specs/` — SDD-style spec folders (`<14-digit-timestamp>-<slug>/`), each
  with `Requirements.md`, `Plan.md`, `Validation.md`. Currently one spec:
  `20260902101903-chrome-extension-fill-video/`, covering the Fill-only
  slice (drag-to-reposition is a deliberately separate, not-yet-written
  follow-up spec).
- `CHROME_EXTENSION_FILL_DRAG_REVISED.md` — the original hand-written
  design doc this project's first spec was based on. Several of its
  original mechanisms (the CSS-only fill approach, the ancestor-traversal
  option) were revisited after real-site testing — see the spec's
  Requirements.md Problem Statement for the full history of what changed
  and why before treating this doc as current behavior.
- `README.md` — user-facing: what the extension does, how it works, how
  to install it unpacked, how to run the tests.
- `Makefile` — orchestrates the test suite via Docker (`test`,
  `test-build`, `test-clean`).

## Architecture Summary

Two plain, unbundled IIFE scripts, loaded by the manifest in this order —
`fillTab.js` then `content.js` — and communicating through one shared
namespace object, `window.__fdExt` (chosen over bare globals specifically
to avoid colliding with the host page's own global scope):

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
  own fixed UI (e.g. a site's fixed sidebar), it walks the video's
  ancestor chain computing two independent override sets —
  `computeClippingOverrides` (overflow/transform/filter/perspective/
  contain/clip-path/will-change) and `computeStackingOverrides`
  (position:fixed/sticky, z-index, opacity, mix-blend-mode, isolation) —
  saving/restoring each touched ancestor's exact `style.cssText`. Only the
  clipping set is bounded by a shared-ancestor stop (`isSharedAncestor`:
  any ancestor containing more than one `<video>`); the stacking set is
  not, since it only changes paint order and can never reveal a sibling
  video's content. This split exists because a single stop point for both
  sets could not satisfy both constraints on real pages (x.com) — see
  `Specs/20260902101903-chrome-extension-fill-video/Requirements.md`'s
  Problem Statement, fifth finding, for the incident that drove this.

### Fill lifecycle

`content.js`'s Fill button calls `fillTab.js`'s `toggleFill(video,
controls)`, where `controls` is `{ fillBtn, playPauseBtn, muteBtn }`.
Entering fill mode: adds the class, snapshots/removes native `controls`,
runs the ancestor walk, shows Play/Pause + Mute, adds an `Escape` keydown
listener (added on entry, removed on exit through *either* path — a
correctness fix over the original design doc's one-shot listener, which
could otherwise misfire later), and starts a `MutationObserver` on the
video's own `class`/`style` attributes that re-applies `fd-fill-active` if
an external script strips it (observed on YouTube). Exiting (by any
means — Exit click, Escape, or the video being removed from the DOM, via
`content.js` calling `FD.forceExitIfActive(video)` before cleanup) reverses
all of the above and restores every neutralized ancestor exactly.

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
  makes the test suite possible: both scripts run identically whether
  loaded as an extension or as plain `<script>` tags on a fixture page.
- Both files are IIFEs attaching only to `window.__fdExt`; never add a
  bare global.
- `fillTab.js` before `content.js` in `manifest.json`'s `js` array is load
  order, not incidental — `content.js` calls into `window.__fdExt` as soon
  as it runs.
- The extension must never insert, move, wrap, or remove any existing
  host-page DOM node. It may only: set attributes/classes/inline styles on
  the `<video>` it targets, temporarily override specific inline-style
  properties on the video's *existing* ancestors (always saved/restored
  exactly), and append its own single sibling `overlayHost` to `<body>`.
- Interactive elements the extension adds get a `data-fd-role` attribute
  (`fill`, `play-pause`, `mute`) rather than relying on button text or DOM
  order for identification — this is what the test suite targets.
- Test fixtures under `tests/fixtures/` are built to reproduce the actual
  DOM shape of a real bug (documented in each fixture's own comments),
  not just arbitrary sample markup — keep that pattern for new fixtures.

## Constraints

- Spec folders are named `<14-digit-timestamp>-<slug>/` and must sort
  strictly after any existing one — see the Spec-Kit Workflow section.
- Drag-to-reposition is explicitly out of scope for the current spec;
  don't fold drag work into the Fill-only implementation without a new (or
  amended) spec.
- Do not reintroduce the native Fullscreen API for fill mode — it was
  deliberately tried and rejected (see Requirements.md's Problem
  Statement) because it hides browser chrome, which is not the intended
  behavior.
- Any change to the ancestor-neutralization logic in `fillTab.js` should
  come with an update to `tests/e2e/clipping-stacking.spec.js` — this
  exact code has already regressed once from an under-tested change (see
  Architecture Summary).

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
- [CHROME_EXTENSION_FILL_DRAG_REVISED.md](CHROME_EXTENSION_FILL_DRAG_REVISED.md)
  — the original design doc (historical reference; several mechanisms it
  describes were superseded — see the spec's Problem Statement).
- [Specs/20260902101903-chrome-extension-fill-video/](Specs/20260902101903-chrome-extension-fill-video/)
  — the current spec: `Requirements.md`, `Plan.md`, `Validation.md`.
