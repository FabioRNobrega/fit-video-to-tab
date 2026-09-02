# Validation: Reddit Cross-Origin Iframe Embed Fill (RedGIFs & friends)

## Table of Contents

- [Acceptance Criteria](#acceptance-criteria)
- [Test Cases](#test-cases)
- [Manual Verification](#manual-verification)
- [Definition of Done](#definition-of-done)
- [Rollback Plan](#rollback-plan)

## Acceptance Criteria

| Requirement | Acceptance Criterion |
| --- | --- |
| FR1 | With the extension loaded, a fixture page served from a `redgifs.com`-matching origin and embedded via `<iframe>` on a `reddit.com`-matching top page has `reddit_fill.js` running in both frames; the generic `<all_urls>` entry's files are unchanged and still load in the top frame only. |
| FR2 | `tests/e2e/clipping-stacking.spec.js` passes unmodified against the refactored `fillTab.js` + new `ancestorOverrides.js`; a new unit-style check confirms `FD.neutralizeAncestors`/`FD.restoreAncestors` exist on `window.__fdExt` and are used by both `fillTab.js` and `reddit_fill.js`. |
| FR3 | In the embed-iframe fixture, a `<video>` gets a `[data-fd-role="fill"]` button, discoverable the same way `shadow-dom.spec.js` already asserts for the generic path. |
| FR4 | Clicking Fill in the iframe does not add any fill class to the `<video>` itself; a `message` event with `type: "fd-reddit-fill", action: "enter"` is observed arriving at the top frame. |
| FR5 | A forged `postMessage` from an unlisted origin (simulated via a third fixture frame not in the domain list) is ignored — no class is ever applied to any `<iframe>` in response. |
| FR6 | After a valid `enter` message, the target `<iframe>` element (not the video inside it) gains the fixed/inset/100vw/100vh fill treatment, and its clipping/stacking ancestors on the Reddit page are neutralized exactly like `clipping-stacking.spec.js` already verifies for a video's ancestors. |
| FR7 | After a valid `exit` message, the `<iframe>`'s fill class is removed and every neutralized ancestor's `style.cssText` is restored to its pre-fill value. |
| FR8 | With both a generic-path video and a Reddit-embedded video present on the same fixture page, filling one while the other is already filled results in exactly one `fd-fill-active`/`fd-reddit-frame-fill` element at any time — never both. |
| FR9 | Pressing `Escape` with focus inside the embed iframe exits the fill; pressing `Escape` with focus in the top frame (e.g. after clicking elsewhere) also exits an active Reddit-iframe fill. |
| FR10 | Play/Pause and Mute buttons in the iframe's button row toggle that frame's own `<video>` play state / muted property directly, observable via the video's own `paused`/`muted` properties in that frame. |
| FR11 | Removing the `<video>` from the iframe's DOM while filled results in the top frame's iframe fill being exited (no stuck fixed/full-viewport `<iframe>`). |

## Test Cases

**Fixtures (new, following `tests/fixtures/*.html`'s existing pattern of
reproducing a real DOM shape, per `AGENTS.md`'s Coding Conventions):**

- `tests/fixtures/reddit-top.html` — a minimal Reddit-like top page
  containing an `<iframe>` pointing at `reddit-embed.html`, plus (for
  FR8's cross-mechanism test) one same-document `<video>` wired to the
  generic path, loading `ancestorOverrides.js`, `fillTab.js`, `drag.js`,
  `content.js`, and `reddit_fill.js` in the correct order.
- `tests/fixtures/reddit-embed.html` — the embed-provider-side fixture: a
  `<video>` plus `ancestorOverrides.js` and `reddit_fill.js` only (no
  `content.js`/`fillTab.js` — those never load in a real embed iframe
  under this design).
- A third minimal fixture (or an inline `page.evaluate`-injected iframe)
  representing an *unlisted* origin, for the FR5 spoofed-message test.
- ⚠️ TODO: These two fixtures must be served from genuinely distinct
  local origins (not both `file://`, which Playwright/Chromium treats as
  same-opaque-origin-per-file in a way that doesn't exercise real
  `event.origin` cross-origin validation) — use Playwright's
  `page.route`/a local static server bound to two ports (e.g.
  `http://127.0.0.1:PORT_A` standing in for `reddit.com`,
  `http://127.0.0.1:PORT_B` standing in for `redgifs.com`), with the
  manifest's match patterns relaxed only in the *test* fixture loading
  (not in `extension/manifest.json` itself) or with `reddit_fill.js`'s
  origin-list check made data-driven enough that the test can inject an
  equivalent list — confirm the exact mechanism during implementation,
  since this repo's existing suite has not needed multi-origin fixtures
  before.

**End-to-end tests (Playwright, matching `tests/e2e/*.spec.js` conventions):**

- `tests/e2e/reddit-iframe-fill.spec.js`:
  - a video inside the embed iframe gets a Fill button (FR3).
  - clicking Fill in the iframe fills the top-level `<iframe>` element,
    not the video (FR4, FR6): assert the iframe element gains the fill
    class/style and the video inside never does.
  - `Escape` from within the iframe exits the fill (FR9).
  - `Escape` dispatched in the top frame while a Reddit-iframe fill is
    active also exits it (FR9).
  - ancestor neutralization applies to the iframe's Reddit-page ancestors
    the same way `clipping-stacking.spec.js` verifies for a video's
    ancestors — reuse that spec's fixture shape (wrapping `overflow:
    hidden`/`transform` ancestor) around the `<iframe>` instead of a
    `<video>` (FR7).
  - removing the iframe's `<video>` from its DOM while filled exits the
    top-frame fill (FR11).
- `tests/e2e/reddit-iframe-security.spec.js`:
  - a `postMessage` from a frame whose origin is not in the domain list
    is ignored — no fill is ever applied (FR5).
- `tests/e2e/reddit-cross-mechanism-exclusivity.spec.js`:
  - filling the generic-path video first, then filling the Reddit-embed
    video, results in the generic video's fill being exited and only the
    iframe's fill remaining active — and vice versa (FR8).
- Existing specs unaffected: `tests/e2e/clipping-stacking.spec.js`,
  `tests/e2e/drag.spec.js`, `tests/e2e/fill-basic.spec.js`,
  `tests/e2e/shadow-dom.spec.js` all continue to pass unmodified,
  confirming the generic path (FR2's NFR) truly didn't change.

**Integration tests:**

- None beyond the Playwright suite above — this extension has no backend/
  database/queue to integration-test; the Dockerized Playwright run
  (`make test`) against real Chromium is this repo's integration layer,
  consistent with the two prior specs.

## Manual Verification

Starting from a clean state, per `README.md`'s existing unpacked-install
workflow:

1. Load `extension/` unpacked (`chrome://extensions` → Developer mode →
   Load unpacked) after implementation, and reload it (⟳) if it was
   already loaded from before this change.
2. Open a real Reddit post known to embed a RedGIFs video (e.g. the post
   inspected in this spec's discovery session) in a Chromium-based
   browser.
3. Confirm a Fill button appears next to the embedded video.
4. Click Fill — confirm the video visually fills the entire browser tab
   (not just a small box matching the embed's original preview size),
   the tab/address-bar chrome stays visible, and Play/Pause + Mute
   controls work.
5. Press `Escape` — confirm the page returns to its original layout with
   no leftover fixed-position iframe.
6. Repeat step 4, then click Exit (rather than pressing `Escape`) —
   confirm the same clean restoration.
7. On the same Reddit session, open a post using Reddit's own native
   player (Shadow-DOM based, already-working case) and confirm it still
   fills correctly — regression check for the generic path.
8. ⚠️ TODO (per Requirements.md's Open Questions): repeat steps 2–6 for
   an Imgur or Streamable-embedded Reddit post if a real example is
   found before this ships; not required for RedGIFs-only completion.

## Definition of Done

- Requirements, Plan, and Validation docs in this spec folder reflect the
  as-built implementation (update if reality diverges during
  implementation, per `AGENTS.md`'s "treat a spec as a living document").
- All existing tests (`fill-basic`, `clipping-stacking`, `drag`,
  `shadow-dom`) still pass unmodified.
- New tests listed above pass, covering FR3–FR11.
- `AGENTS.md`'s Repository Map / Architecture Summary / Coding
  Conventions are updated to document `ancestorOverrides.js` and
  `reddit_fill.js` and the cross-frame mechanism, matching this repo's
  existing practice of keeping AGENTS.md current with each shipped spec.
- `README.md`'s "How it works" section gains a short note on the Reddit
  cross-origin embed case, matching its existing level of detail for the
  Shadow-DOM case.
- Manual verification steps 1–7 above completed against a real Reddit
  RedGIFs post.

## Rollback Plan

- The new mechanism is fully additive and isolated to its own
  `content_scripts` entry and two new files. To roll back, remove the
  second `content_scripts` entry from `extension/manifest.json` (or
  delete `extension/reddit_fill.js` from its `js` array) — the generic
  path is unaffected and continues working exactly as before this spec,
  since `fillTab.js`'s only change (delegating to
  `extension/ancestorOverrides.js`, and the one `FD.requestExclusiveFill`
  call) has no dependency on `reddit_fill.js` existing or running.
- If the `ancestorOverrides.js` extraction itself is suspected of a
  regression independent of the Reddit feature, it can be reverted alone
  by restoring `fillTab.js`'s inlined
  `computeClippingOverrides`/`computeStackingOverrides`/
  `isSharedAncestor`/walk-loop from before this spec and removing the new
  file and its `manifest.json` script-array entry — `reddit_fill.js`
  would then need its own private copy until re-extracted.
