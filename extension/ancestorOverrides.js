// Shared ancestor clipping/stacking-override walk, plus a small
// cross-module fill-exclusivity arbiter. Extracted out of fillTab.js so
// both fillTab.js (walking up from a <video>) and reddit_fill.js (walking
// up from an <iframe> element hosting a cross-origin embedded video) share
// one implementation instead of two copies. Loaded before both callers in
// extension/manifest.json's two content_scripts entries. See
// Specs/20260902124537-reddit-iframe-embed-fill/.
(function () {
  const FD = (window.__fdExt = window.__fdExt || {});

  // An ancestor with non-visible overflow clips the target, and an ancestor
  // with a transform/filter/perspective/contain/will-change:transform
  // becomes a containing block for position:fixed, pulling the target's
  // "viewport" in to that ancestor's box instead of the real one. These are
  // the CLIPPING overrides. Overriding them reveals whatever else that
  // ancestor was hiding/confining — safe only while that ancestor is not
  // shared with another video (see isSharedAncestor below).
  function computeClippingOverrides(computed) {
    const overrides = {};
    if (computed.overflow !== "visible") overrides.overflow = "visible";
    if (computed.overflowX !== "visible") overrides.overflowX = "visible";
    if (computed.overflowY !== "visible") overrides.overflowY = "visible";
    if (computed.transform !== "none") overrides.transform = "none";
    if (computed.filter !== "none") overrides.filter = "none";
    if (computed.perspective !== "none") overrides.perspective = "none";
    if (computed.contain !== "none") overrides.contain = "none";
    if (computed.clipPath && computed.clipPath !== "none") {
      overrides.clipPath = "none";
    }
    if (computed.willChange && computed.willChange.indexOf("transform") !== -1) {
      overrides.willChange = "auto";
    }
    return overrides;
  }

  // An ancestor that establishes its own *stacking context* (position:
  // fixed/sticky, a positioned element with a z-index, opacity<1, a
  // mix-blend-mode, or isolation:isolate) can trap the target's z-index
  // inside that context, so it loses to sibling UI elsewhere on the page
  // no matter how high the target's z-index is set. These are the STACKING
  // overrides. Unlike clipping overrides, resetting z-index/position/
  // opacity on a shared ancestor does not reveal or reposition sibling
  // videos — it only changes paint order — so these stay safe to apply
  // even past a shared ancestor.
  function computeStackingOverrides(computed) {
    const overrides = {};
    if (computed.position === "fixed" || computed.position === "sticky") {
      overrides.position = "static";
    }
    if (computed.position !== "static" && computed.zIndex !== "auto") {
      overrides.zIndex = "auto";
    }
    if (computed.opacity !== "1") overrides.opacity = "1";
    if (computed.mixBlendMode !== "normal") overrides.mixBlendMode = "normal";
    if (computed.isolation === "isolate") overrides.isolation = "auto";
    return overrides;
  }

  // An ancestor containing more than one <video> — e.g. an infinite-scroll
  // timeline's shared column/list wrapper — is where clipping overrides
  // must stop: overriding overflow/transform/etc. there would un-clip or
  // reposition every other video sharing that ancestor, not just the one
  // being filled. Stacking-context ancestors can still sit *above* this
  // boundary, since they only change paint order. This only ever sees
  // videos reachable in the walking document's own DOM — a cross-origin
  // embed iframe's video is never visible to this check from the top
  // frame, which is fine: the boundary still protects same-document
  // siblings, the only case a shared ancestor can arise in practice today.
  function isSharedAncestor(el) {
    return !!(el.querySelectorAll && el.querySelectorAll("video").length > 1);
  }

  // Like `el.parentElement`, but continues out of an open Shadow DOM
  // instead of stopping at its root — a shadow root's "parent" is its
  // host element, not something `parentElement` itself ever reaches.
  // Needed because Reddit nests both its own native player and (on real
  // pages) the RedGIFs embed iframe inside shadow-DOM wrapper elements;
  // without this, the ancestor walk stops at the shadow boundary and
  // never reaches the page's own fixed header/sidebar ancestors above it.
  function parentAcrossShadow(el) {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function neutralizeAncestors(startElement) {
    const overridden = [];
    let el = parentAcrossShadow(startElement);
    let pastSharedAncestor = false;
    while (el && el !== document.documentElement) {
      if (!pastSharedAncestor && isSharedAncestor(el)) {
        pastSharedAncestor = true;
      }
      const computed = getComputedStyle(el);
      const overrides = pastSharedAncestor
        ? computeStackingOverrides(computed)
        : Object.assign(
            {},
            computeClippingOverrides(computed),
            computeStackingOverrides(computed)
          );
      const props = Object.keys(overrides);
      if (props.length) {
        overridden.push({ el, prevCssText: el.style.cssText });
        props.forEach((prop) => {
          el.style[prop] = overrides[prop];
        });
      }
      el = parentAcrossShadow(el);
    }
    return overridden;
  }

  function restoreAncestors(overridden) {
    if (!overridden) return;
    overridden.forEach(({ el, prevCssText }) => {
      el.style.cssText = prevCssText;
    });
  }

  // Lets two independent fill mechanisms (fillTab.js's generic path,
  // reddit_fill.js's iframe-fill path) share the "only one video fills at
  // a time" guarantee tab-wide. Each caller passes its own exit function
  // before applying its own fill; if another mechanism's fill is already
  // active, that one is evicted first. Exit functions are expected to be
  // idempotent (safe to call when nothing is active), matching how each
  // module's own exit already behaves.
  function requestExclusiveFill(exitOthers) {
    const previous = FD._activeExclusiveExit;
    if (previous && previous !== exitOthers) {
      FD._activeExclusiveExit = null;
      previous();
    }
    FD._activeExclusiveExit = exitOthers;
  }

  FD.neutralizeAncestors = neutralizeAncestors;
  FD.restoreAncestors = restoreAncestors;
  FD.requestExclusiveFill = requestExclusiveFill;
})();
