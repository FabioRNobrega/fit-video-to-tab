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

  function attachFillButton(video) {
    if (videoState.has(video)) return;

    const fillBtn = document.createElement("button");
    fillBtn.type = "button";
    fillBtn.className = "fd-fill-btn";
    fillBtn.dataset.fdRole = "fill";
    fillBtn.setAttribute("aria-label", "Fill video");
    fillBtn.innerHTML = FD.ICONS.fullscreen;
    shadow.appendChild(fillBtn);

    function syncPosition() {
      const rect = video.getBoundingClientRect();
      fillBtn.style.left = `${rect.left + ICON_INSET}px`;
      fillBtn.style.top = `${rect.top + ICON_INSET}px`;
    }

    const resizeObserver = new ResizeObserver(syncPosition);
    resizeObserver.observe(video);

    // scroll doesn't bubble, so listen on window in the capture phase to
    // catch scrolling inside nested scroll containers too, not just window
    window.addEventListener("scroll", syncPosition, true);
    window.addEventListener("resize", syncPosition);
    syncPosition();

    const controls = { fillBtn, shadowRoot: shadow };
    controls.onExit = () => FD.toggleFill(video, controls);
    fillBtn.addEventListener("click", () => FD.toggleFill(video, controls));

    videoState.set(video, {
      fillBtn,
      resizeObserver,
      cleanup() {
        resizeObserver.disconnect();
        window.removeEventListener("scroll", syncPosition, true);
        window.removeEventListener("resize", syncPosition);
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
