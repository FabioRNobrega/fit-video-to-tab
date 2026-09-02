// Fill-mode state for one video at a time. Fills the video within the tab
// (position: fixed, viewport-sized) rather than using the browser's native
// Fullscreen API, so the tab/address-bar chrome stays visible. To reach the
// true viewport, and to paint above the host page's own UI (e.g. x.com's
// fixed header/sidebar), on sites that nest the video inside clipping,
// containing-block, or stacking-context-creating ancestors, any such
// ancestor is temporarily neutralized while filled and restored exactly on
// exit. Native `controls` are hidden while filled, so content.js's Play/Pause
// and Mute buttons are shown in their place for the duration.
(function () {
  const FD = (window.__fdExt = window.__fdExt || {});

  let styleInjected = false;
  let activeVideo = null;
  let activeControls = null; // { fillBtn, playPauseBtn, muteBtn }
  let activeAncestors = null; // [{ el, prevCssText }]
  let escapeHandler = null;
  let attrObserver = null;

  function injectFillStyle() {
    if (styleInjected) return;
    const style = document.createElement("style");
    style.textContent = [
      ".fd-fill-active {",
      "  position: fixed !important;",
      "  inset: 0 !important;",
      "  width: 100vw !important;",
      "  height: 100vh !important;",
      "  object-fit: cover !important;",
      "  z-index: 2147483647 !important;",
      "  background: #000;",
      "}",
    ].join("\n");
    document.head.appendChild(style);
    styleInjected = true;
  }

  // An ancestor with non-visible overflow clips the video, and an ancestor
  // with a transform/filter/perspective/contain/will-change:transform
  // becomes a containing block for position:fixed, pulling the video's
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
  // mix-blend-mode, or isolation:isolate) can trap the video's z-index
  // inside that context, so it loses to sibling UI elsewhere on the page
  // (e.g. x.com's own fixed header/sidebar) no matter how high the video's
  // z-index is set. These are the STACKING overrides. Unlike clipping
  // overrides, resetting z-index/position/opacity on a shared ancestor
  // does not reveal or reposition sibling videos — it only changes paint
  // order — so these stay safe to apply even past a shared ancestor.
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
  // being filled (observed on x.com: filling one tweet's video made other
  // timeline videos appear on top of it). Stacking-context ancestors can
  // still sit *above* this boundary (e.g. the page's overall layout
  // wrapper, shared by the whole timeline and the sidebar alike) — also
  // observed on x.com, where the sidebar still painted over the filled
  // video until stacking overrides were allowed to keep climbing past this
  // point.
  function isSharedAncestor(el) {
    return !!(el.querySelectorAll && el.querySelectorAll("video").length > 1);
  }

  function neutralizeClippingAncestors(video) {
    const overridden = [];
    let el = video.parentElement;
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
      el = el.parentElement;
    }
    return overridden;
  }

  function restoreAncestors(overridden) {
    if (!overridden) return;
    overridden.forEach(({ el, prevCssText }) => {
      el.style.cssText = prevCssText;
    });
  }

  function enterFill(video, controls) {
    video.dataset.fdControls = video.hasAttribute("controls") ? "1" : "0";
    video.removeAttribute("controls");
    video.classList.add("fd-fill-active");

    activeVideo = video;
    activeControls = controls;
    activeAncestors = neutralizeClippingAncestors(video);
    controls.fillBtn.textContent = "Exit";
    controls.playPauseBtn.hidden = false;
    controls.muteBtn.hidden = false;

    escapeHandler = (e) => {
      if (e.key === "Escape") exitFill();
    };
    window.addEventListener("keydown", escapeHandler);

    // Residual risk (design doc §4): some sites (e.g. YouTube's player)
    // actively re-render and can strip our class/inline styles off the
    // video. Re-apply if that happens while we still consider it filled.
    attrObserver = new MutationObserver(() => {
      if (!video.classList.contains("fd-fill-active")) {
        video.classList.add("fd-fill-active");
      }
    });
    attrObserver.observe(video, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }

  function exitFill() {
    if (!activeVideo) return;
    const video = activeVideo;
    const controls = activeControls;

    if (attrObserver) {
      attrObserver.disconnect();
      attrObserver = null;
    }
    if (escapeHandler) {
      window.removeEventListener("keydown", escapeHandler);
      escapeHandler = null;
    }

    video.classList.remove("fd-fill-active");
    video.style.objectPosition = ""; // drop any crop offset from a future drag feature
    if (video.dataset.fdControls === "1") {
      video.setAttribute("controls", "");
    }
    delete video.dataset.fdControls;

    restoreAncestors(activeAncestors);
    activeAncestors = null;

    controls.fillBtn.textContent = "Fill";
    controls.playPauseBtn.hidden = true;
    controls.muteBtn.hidden = true;
    activeVideo = null;
    activeControls = null;
  }

  function toggleFill(video, controls) {
    if (activeVideo === video) {
      exitFill();
      return;
    }
    if (activeVideo) exitFill(); // only one video fills at a time
    enterFill(video, controls);
  }

  // Called by content.js before it tears down a video's button row (e.g.
  // the video was removed from the page) so fill state never dangles.
  function forceExitIfActive(video) {
    if (activeVideo === video) exitFill();
  }

  FD.toggleFill = toggleFill;
  FD.injectFillStyle = injectFillStyle;
  FD.forceExitIfActive = forceExitIfActive;
})();
