// Video discovery, the sibling shadow-DOM overlay, and per-video floating
// fill-icon-button lifecycle. The bottom control bar itself lives in
// fillControls.js, attached/detached by fillTab.js's enter/exit lifecycle —
// this file only owns the always-present fill/exit icon button. Never
// touches the host page's own DOM tree structure beyond appending one
// sibling node to <body> and setting attributes on the <video> elements
// themselves (see the design doc for why).
(function () {
  const FD = (window.__fdExt = window.__fdExt || {});
  const ICON_INSET = 8;

  FD.injectFillStyle();

  const overlayHost = document.createElement("div");
  overlayHost.style.cssText =
    "position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147483647;";
  document.body.appendChild(overlayHost);
  const shadow = overlayHost.attachShadow({ mode: "open" });
  FD.getOverlayShadowRoot = () => shadow;

  const fillBtnStyle = document.createElement("style");
  fillBtnStyle.textContent = [
    ".fd-fill-btn {",
    "  position: fixed;",
    "  pointer-events: auto;",
    "  z-index: 2147483647;",
    "  width: 32px;",
    "  height: 32px;",
    "  padding: 0;",
    "  border: none;",
    "  border-radius: 50%;",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: center;",
    "  background: rgba(0, 0, 0, 0.55);",
    "  color: #fff;",
    "  cursor: pointer;",
    "}",
    ".fd-fill-btn:hover {",
    "  background: rgba(0, 0, 0, 0.75);",
    "}",
    ".fd-fill-btn svg {",
    "  width: 18px;",
    "  height: 18px;",
    "}",
    ".fd-fill-btn[hidden] {",
    "  display: none;",
    "}",
  ].join("\n");
  shadow.appendChild(fillBtnStyle);

  const videoState = new WeakMap(); // video -> { fillBtn, resizeObserver, cleanup }

  // Hover-reveal is driven by raw pointer coordinates against each video's
  // live rect, not pointerenter/pointerleave targeted at the <video>
  // element itself. Real sites (X/Twitter, Instagram) render their own
  // full-size overlay <div> directly on top of the <video> for their own
  // play/pause and ad-detection UI, so the browser's hit-test always
  // resolves to that overlay — a listener on the video never sees the
  // pointer at all. Tracking raw coordinates against the rect sidesteps
  // hit-testing entirely and works regardless of what the host page has
  // stacked on top.
  const hoverEntries = new Set(); // { video, fillBtn, setHovering }

  // Remembered so a video's hover state can be recomputed when its rect
  // changes (e.g. entering/exiting fill mode drastically resizes it)
  // without waiting for the next actual pointer movement — otherwise a
  // video that covered the whole viewport while filled leaves every
  // button "hovering" the instant it shrinks back down on exit.
  let lastPointerX = null;
  let lastPointerY = null;

  function isPointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function recomputeHover(entry) {
    if (lastPointerX === null) return;
    const overVideo = isPointInRect(lastPointerX, lastPointerY, entry.video.getBoundingClientRect());
    const overButton =
      !entry.fillBtn.hidden &&
      isPointInRect(lastPointerX, lastPointerY, entry.fillBtn.getBoundingClientRect());
    entry.setHovering(overVideo || overButton);
  }

  function handlePointerMove(e) {
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    hoverEntries.forEach(recomputeHover);
  }
  window.addEventListener("pointermove", handlePointerMove, { passive: true });

  // The pointer leaving the browser window entirely stops pointermove
  // events without ever reporting the video as un-hovered otherwise.
  function handlePointerLeaveWindow(e) {
    if (e.relatedTarget) return;
    lastPointerX = null;
    lastPointerY = null;
    hoverEntries.forEach((entry) => entry.setHovering(false));
  }
  document.addEventListener("mouseout", handlePointerLeaveWindow);

  function attachFillButton(video) {
    if (videoState.has(video)) return;

    const fillBtn = document.createElement("button");
    fillBtn.type = "button";
    fillBtn.className = "fd-fill-btn";
    fillBtn.dataset.fdRole = "fill";
    fillBtn.setAttribute("aria-label", "Fill video");
    fillBtn.innerHTML = FD.ICONS.fullscreen;
    fillBtn.hidden = true;
    shadow.appendChild(fillBtn);

    // Hover-reveal: hidden until the pointer is over the video or the
    // button itself, and forced hidden while filled regardless of hover —
    // fillTab.js reports fill state through setFilled rather than touching
    // fillBtn.hidden directly, keeping fill-state ownership in fillTab.js
    // and hover-visibility ownership here.
    let isHovering = false;
    let isFilled = false;

    function syncVisibility() {
      fillBtn.hidden = isFilled || !isHovering;
    }

    function setFilled(filled) {
      isFilled = filled;
      // The video's own size/position just changed synchronously (fill
      // mode's class was already toggled by the time this is called) —
      // recompute against the last known pointer position immediately
      // rather than waiting for the ResizeObserver's async callback, so
      // exiting a fullscreen fill never leaves a stale "still hovering"
      // button visible even for one frame.
      recomputeHover(hoverEntry);
      syncVisibility();
    }

    function setHovering(hovering) {
      isHovering = hovering;
      syncVisibility();
    }

    const hoverEntry = { video, fillBtn, setHovering };
    hoverEntries.add(hoverEntry);

    function syncPosition() {
      const rect = video.getBoundingClientRect();
      fillBtn.style.left = `${rect.left + ICON_INSET}px`;
      fillBtn.style.top = `${rect.top + ICON_INSET}px`;
      // The video's rect can change size/position without any new pointer
      // movement (most notably: entering/exiting fill mode) — recompute
      // hover against the last known pointer position so a shrinking video
      // doesn't leave a stale "still hovering" button visible.
      recomputeHover(hoverEntry);
    }

    const resizeObserver = new ResizeObserver(syncPosition);
    resizeObserver.observe(video);

    // scroll doesn't bubble, so listen on window in the capture phase to
    // catch scrolling inside nested scroll containers too, not just window
    window.addEventListener("scroll", syncPosition, true);
    window.addEventListener("resize", syncPosition);
    syncPosition();

    const controls = { fillBtn, shadowRoot: shadow, setFilled };
    controls.onExit = () => FD.toggleFill(video, controls);
    fillBtn.addEventListener("click", () => FD.toggleFill(video, controls));

    videoState.set(video, {
      fillBtn,
      resizeObserver,
      cleanup() {
        resizeObserver.disconnect();
        window.removeEventListener("scroll", syncPosition, true);
        window.removeEventListener("resize", syncPosition);
        hoverEntries.delete(hoverEntry);
        fillBtn.remove();
        videoState.delete(video);
      },
    });
  }

  function detachFillButton(video) {
    const entry = videoState.get(video);
    if (entry) {
      FD.forceExitIfActive(video);
      entry.cleanup();
    }
  }

  // Some sites (e.g. Reddit's video player) render their <video> inside an
  // open Shadow DOM. querySelectorAll and MutationObserver never cross a
  // shadow boundary on their own, so each open shadow root discovered has
  // to be scanned and observed separately. Closed shadow roots are not
  // reachable from a content script at all — an accepted browser-level gap.
  const observedRoots = new WeakSet();

  function observeRoot(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);

    if (root.querySelectorAll) {
      root.querySelectorAll("video").forEach(attachFillButton);
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) observeRoot(el.shadowRoot);
      });
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(scanAdded);
        mutation.removedNodes.forEach(scanRemoved);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function scanAdded(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === "VIDEO") attachFillButton(node);
    if (node.shadowRoot) observeRoot(node.shadowRoot);
    if (node.querySelectorAll) {
      node.querySelectorAll("video").forEach(attachFillButton);
      node.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) observeRoot(el.shadowRoot);
      });
    }
  }

  function scanRemoved(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === "VIDEO") detachFillButton(node);
    if (node.querySelectorAll) {
      node.querySelectorAll("video").forEach(detachFillButton);
    }
  }

  observeRoot(document.body);
})();
