// Fill-mode state for one video at a time. Fills the video within the tab
// (position: fixed, viewport-sized) rather than using the browser's native
// Fullscreen API, so the tab/address-bar chrome stays visible. To reach the
// true viewport, and to paint above the host page's own UI (e.g. x.com's
// fixed header/sidebar), on sites that nest the video inside clipping,
// containing-block, or stacking-context-creating ancestors, any such
// ancestor is temporarily neutralized while filled and restored exactly on
// exit. Native `controls` are hidden while filled, so fillControls.js's
// bottom control bar (play/pause, mute, scrubber, A/B loop, repeat, exit) is
// attached in its place for the duration.
(function () {
  const FD = (window.__fdExt = window.__fdExt || {});

  let styleInjected = false;
  let activeVideo = null;
  let activeControls = null; // { fillBtn, shadowRoot }
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

  // Ancestor clipping/stacking-override computation and the
  // fill-exclusivity arbiter live in ancestorOverrides.js, shared with
  // reddit_fill.js's iframe-element fill path — see
  // Specs/20260902124537-reddit-iframe-embed-fill/.

  function enterFill(video, controls) {
    video.dataset.fdControls = video.hasAttribute("controls") ? "1" : "0";
    video.removeAttribute("controls");
    video.classList.add("fd-fill-active");

    if (FD.requestExclusiveFill) FD.requestExclusiveFill(exitFill);

    activeVideo = video;
    activeControls = controls;
    activeAncestors = FD.neutralizeAncestors(video);
    FD.attachDrag(video);
    FD.attachControls(video, controls);
    // fillControls.js's bottom bar has its own Exit control, so the
    // floating icon button is redundant (and, positioned over the video's
    // corner, visually in the way) once filled — hide it for the duration.
    controls.fillBtn.hidden = true;

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

    FD.detachControls(video);
    FD.detachDrag(video);
    video.classList.remove("fd-fill-active");
    video.style.objectPosition = ""; // reset drag.js's crop offset back to center
    if (video.dataset.fdControls === "1") {
      video.setAttribute("controls", "");
    }
    delete video.dataset.fdControls;

    FD.restoreAncestors(activeAncestors);
    activeAncestors = null;

    controls.fillBtn.hidden = false;
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
