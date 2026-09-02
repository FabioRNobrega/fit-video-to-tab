// Video discovery, the sibling shadow-DOM overlay, and per-video button-row
// lifecycle. Never touches the host page's own DOM tree structure beyond
// appending one sibling node to <body> and setting attributes on the
// <video> elements themselves (see the design doc for why).
(function () {
  const FD = (window.__fdExt = window.__fdExt || {});
  const ROW_HEIGHT = 28;

  FD.injectFillStyle();

  const overlayHost = document.createElement("div");
  overlayHost.style.cssText =
    "position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147483647;";
  document.body.appendChild(overlayHost);
  const shadow = overlayHost.attachShadow({ mode: "open" });

  const rowStyle = document.createElement("style");
  rowStyle.textContent = [
    ".fd-row {",
    "  position: fixed;",
    "  pointer-events: auto;",
    "  display: flex;",
    "  gap: 4px;",
    "  z-index: 2147483647;",
    "}",
    ".fd-row button {",
    "  font: 12px sans-serif;",
    "  padding: 2px 8px;",
    "  cursor: pointer;",
    "}",
    ".fd-row [hidden] {",
    "  display: none;",
    "}",
  ].join("\n");
  shadow.appendChild(rowStyle);

  const videoState = new WeakMap(); // video -> { row, resizeObserver, cleanup }

  function attachButtonRow(video) {
    if (videoState.has(video)) return;

    const row = document.createElement("div");
    row.className = "fd-row";

    const fillBtn = document.createElement("button");
    fillBtn.type = "button";
    fillBtn.textContent = "Fill";
    fillBtn.dataset.fdRole = "fill";
    row.appendChild(fillBtn);

    // Native controls are hidden while filled, so these two stand in for
    // play/pause and mute — only shown while this video is filled (FD
    // toggles their `hidden` state on enter/exit).
    const playPauseBtn = document.createElement("button");
    playPauseBtn.type = "button";
    playPauseBtn.dataset.fdRole = "play-pause";
    playPauseBtn.hidden = true;
    row.appendChild(playPauseBtn);

    const muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.dataset.fdRole = "mute";
    muteBtn.hidden = true;
    row.appendChild(muteBtn);

    shadow.appendChild(row);

    function syncPosition() {
      const rect = video.getBoundingClientRect();
      row.style.left = `${rect.left}px`;
      row.style.top = `${Math.max(0, rect.top - ROW_HEIGHT)}px`;
      row.style.width = `${rect.width}px`;
    }

    const resizeObserver = new ResizeObserver(syncPosition);
    resizeObserver.observe(video);

    // scroll doesn't bubble, so listen on window in the capture phase to
    // catch scrolling inside nested scroll containers too, not just window
    window.addEventListener("scroll", syncPosition, true);
    window.addEventListener("resize", syncPosition);
    syncPosition();

    function updatePlayPauseLabel() {
      playPauseBtn.textContent = video.paused ? "▶" : "⏸";
    }
    function updateMuteLabel() {
      muteBtn.textContent = video.muted ? "🔇" : "🔊";
    }
    updatePlayPauseLabel();
    updateMuteLabel();
    video.addEventListener("play", updatePlayPauseLabel);
    video.addEventListener("pause", updatePlayPauseLabel);
    video.addEventListener("volumechange", updateMuteLabel);

    playPauseBtn.addEventListener("click", () => {
      if (video.paused) video.play();
      else video.pause();
    });
    muteBtn.addEventListener("click", () => {
      video.muted = !video.muted;
    });

    const controls = { fillBtn, playPauseBtn, muteBtn };
    fillBtn.addEventListener("click", () => FD.toggleFill(video, controls));

    videoState.set(video, {
      row,
      resizeObserver,
      cleanup() {
        resizeObserver.disconnect();
        window.removeEventListener("scroll", syncPosition, true);
        window.removeEventListener("resize", syncPosition);
        video.removeEventListener("play", updatePlayPauseLabel);
        video.removeEventListener("pause", updatePlayPauseLabel);
        video.removeEventListener("volumechange", updateMuteLabel);
        row.remove();
        videoState.delete(video);
      },
    });
  }

  function detachButtonRow(video) {
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
      root.querySelectorAll("video").forEach(attachButtonRow);
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
    if (node.tagName === "VIDEO") attachButtonRow(node);
    if (node.shadowRoot) observeRoot(node.shadowRoot);
    if (node.querySelectorAll) {
      node.querySelectorAll("video").forEach(attachButtonRow);
      node.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) observeRoot(el.shadowRoot);
      });
    }
  }

  function scanRemoved(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === "VIDEO") detachButtonRow(node);
    if (node.querySelectorAll) {
      node.querySelectorAll("video").forEach(detachButtonRow);
    }
  }

  observeRoot(document.body);
})();
