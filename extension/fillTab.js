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
  let prevHtmlOverflow = null;
  let prevBodyOverflow = null;
  let prevVideoCssText = null;
  let activeChrome = null; // [{ el, prevCssText }]

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
      "  z-index: 2147483646 !important;",
      "  background: #000;",
      "}",
    ].join("\n");
    document.head.appendChild(style);
    styleInjected = true;
  }

  // The rule above only reaches videos in the light DOM. A <video> nested
  // inside an open Shadow DOM (e.g. Reddit's native v.redd.it player, whose
  // <shreddit-player> renders its <video> in its own shadow root) is a
  // separate style scope that document.head's stylesheet can never cross —
  // classList.add("fd-fill-active") alone silently does nothing visible
  // there. Applying the same declarations as inline !important styles works
  // regardless of shadow nesting, so this runs unconditionally alongside the
  // class toggle: redundant (harmless) for ordinary light-DOM sites, load-
  // bearing for shadow-nested ones. Mirrors the inline-style approach
  // redditFill.js already uses for its iframe-fill path, for the same
  // reason.
  function applyFillOverrides(video) {
    video.style.setProperty("position", "fixed", "important");
    video.style.setProperty("inset", "0", "important");
    video.style.setProperty("width", "100vw", "important");
    video.style.setProperty("height", "100vh", "important");
    video.style.setProperty("object-fit", "cover", "important");
    video.style.setProperty("z-index", "2147483646", "important");
    video.style.setProperty("background", "#000", "important");
  }

  // Ancestor clipping/stacking-override computation and the
  // fill-exclusivity arbiter live in ancestorOverrides.js, shared with
  // redditFill.js's iframe-element fill path — see
  // Specs/20260902124537-reddit-iframe-embed-fill/.

  function enterFill(video, controls) {
    video.dataset.fdControls = video.hasAttribute("controls") ? "1" : "0";
    video.removeAttribute("controls");
    prevVideoCssText = video.style.cssText;
    video.classList.add("fd-fill-active");
    applyFillOverrides(video);

    if (FD.requestExclusiveFill) FD.requestExclusiveFill(exitFill);

    // Neutralizing clipping ancestors (below) can expose the video's
    // fixed, viewport-sized box to a page/root scrollbar it would
    // otherwise never trigger. Suppress scrolling on the document while
    // filled and restore whatever was there on exit.
    prevHtmlOverflow = document.documentElement.style.overflow;
    prevBodyOverflow = document.body ? document.body.style.overflow : "";
    document.documentElement.style.setProperty("overflow", "hidden", "important");
    if (document.body) {
      document.body.style.setProperty("overflow", "hidden", "important");
    }

    activeVideo = video;
    activeControls = controls;
    activeAncestors = FD.neutralizeAncestors(video);

    // Some sites render their own control overlay directly on top of the
    // video (e.g. Reddit's native player's <shreddit-media-ui>), which
    // intercepts pointer events meant for drag.js and the video itself.
    // FD.collectFillChrome is an optional site-specific hook (see
    // redditNativeFill.js) — hide whatever it returns for the duration.
    activeChrome = [];
    if (FD.collectFillChrome) {
      FD.collectFillChrome(video).forEach((el) => {
        activeChrome.push({ el, prevCssText: el.style.cssText });
        el.style.setProperty("display", "none", "important");
      });
    }

    FD.attachDrag(video);
    FD.attachControls(video, controls);
    // fillControls.js's bottom bar has its own Exit control, so the
    // floating icon button is redundant (and, positioned over the video's
    // corner, visually in the way) once filled — hide it for the duration.
    // content.js owns hover-reveal visibility, so report fill state through
    // setFilled rather than writing fillBtn.hidden directly.
    if (controls.setFilled) controls.setFilled(true);
    else controls.fillBtn.hidden = true;

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
        applyFillOverrides(video);
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
    // Restores the video's pre-fill inline style wholesale, which also
    // resets drag.js's crop offset back to center (it was never part of
    // prevVideoCssText, captured before drag could touch the video).
    video.style.cssText = prevVideoCssText || "";
    prevVideoCssText = null;
    if (video.dataset.fdControls === "1") {
      video.setAttribute("controls", "");
    }
    delete video.dataset.fdControls;

    FD.restoreAncestors(activeAncestors);
    activeAncestors = null;

    activeChrome.forEach(({ el, prevCssText }) => {
      el.style.cssText = prevCssText;
    });
    activeChrome = null;

    document.documentElement.style.overflow = prevHtmlOverflow;
    if (document.body) document.body.style.overflow = prevBodyOverflow;
    prevHtmlOverflow = null;
    prevBodyOverflow = null;

    // Restore the floating button to hover-dependent visibility rather
    // than forcing it visible — content.js's setFilled reflects whether
    // the pointer is still over the video/button.
    if (controls.setFilled) controls.setFilled(false);
    else controls.fillBtn.hidden = false;
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
