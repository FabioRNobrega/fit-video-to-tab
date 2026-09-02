// Reddit cross-origin iframe embed fill. Many Reddit video posts embed a
// third-party player (RedGIFs primarily, also Imgur/Streamable) inside a
// cross-origin <iframe>, so the <video> lives in a document the generic
// fillTab.js/drag.js/content.js path never sees (that path's own
// content_scripts entry has no all_frames, matching only the top frame —
// see extension/manifest.json). Even with visibility into that iframe,
// filling the <video> directly wouldn't work: position:fixed inside a
// cross-origin iframe only reaches that iframe's own rendered box, not the
// tab's real viewport. So this script fills the <iframe> element itself
// instead, coordinated across the frame boundary via postMessage.
//
// This one file is loaded into every frame matched by its own
// content_scripts entry (all_frames: true, scoped to reddit.com + known
// embed-provider domains) and plays one of two roles depending on which
// frame it finds itself in — see initTopFrame/initEmbedFrame below. See
// Specs/20260902124537-reddit-iframe-embed-fill/.
(function () {
  const FD = (window.__fdExt = window.__fdExt || {});
  const MESSAGE_TYPE = "fd-reddit-fill";
  const ROW_HEIGHT = 28;

  // Origins this script is willing to accept fill requests from. Kept in
  // sync with extension/manifest.json's second content_scripts entry —
  // RedGIFs is the primary target; Imgur/Streamable are best-effort
  // secondary coverage (see Requirements.md's Open Questions).
  const EMBED_ORIGIN_RE =
    /^https:\/\/([a-z0-9-]+\.)*(redgifs\.com|imgur\.com|streamable\.com)$/i;

  if (window.top === window.self) {
    initTopFrame();
  } else {
    initEmbedFrame();
  }

  // ------------------------------------------------------------------
  // Top frame (reddit.com): owns fill state for whichever embed iframe is
  // currently filled, mirroring fillTab.js's single-active shape but
  // targeting an <iframe> element instead of a <video>.
  // ------------------------------------------------------------------
  function initTopFrame() {
    let activeIframe = null;
    let activeIframePrevCssText = null;
    let activeAncestors = null;
    let escapeHandler = null;

    // Applied as inline style, not a class backed by a stylesheet on
    // document.head — an open Shadow DOM is a separate style scope, so an
    // outer-document stylesheet rule never reaches an iframe nested inside
    // one (real Reddit nests the embed iframe inside its own player
    // wrapper's shadow root). Inline styles apply regardless of shadow
    // nesting. The class is still added/removed alongside it purely as a
    // stable hook for tests and any future styling.
    const FILL_STYLE =
      "position: fixed !important; inset: 0 !important; width: 100vw !important; " +
      "height: 100vh !important; border: 0 !important; margin: 0 !important; " +
      "z-index: 2147483647 !important; background: #000;";

    function enterFrameFill(iframeEl) {
      if (FD.requestExclusiveFill) FD.requestExclusiveFill(exitFrameFill);

      activeIframePrevCssText = iframeEl.style.cssText;
      iframeEl.style.cssText = activeIframePrevCssText
        ? `${activeIframePrevCssText}; ${FILL_STYLE}`
        : FILL_STYLE;
      iframeEl.classList.add("fd-reddit-frame-fill");
      activeIframe = iframeEl;
      activeAncestors = FD.neutralizeAncestors(iframeEl);

      escapeHandler = (e) => {
        if (e.key === "Escape") exitFrameFill();
      };
      window.addEventListener("keydown", escapeHandler);
    }

    // notifyEmbed defaults to true: the embed iframe's button row needs to
    // hear back so it can reset to "Fill", whether the exit was requested
    // by the iframe itself, by Escape in this top frame, or by another
    // fill mechanism evicting this one via FD.requestExclusiveFill.
    function exitFrameFill(notifyEmbed) {
      if (!activeIframe) return;
      const iframeEl = activeIframe;

      if (escapeHandler) {
        window.removeEventListener("keydown", escapeHandler);
        escapeHandler = null;
      }
      iframeEl.classList.remove("fd-reddit-frame-fill");
      iframeEl.style.cssText = activeIframePrevCssText || "";
      activeIframePrevCssText = null;
      FD.restoreAncestors(activeAncestors);
      activeAncestors = null;
      activeIframe = null;

      if (notifyEmbed !== false && iframeEl.contentWindow) {
        iframeEl.contentWindow.postMessage(
          { type: MESSAGE_TYPE, action: "exited" },
          "*"
        );
      }
    }

    // Real Reddit nests the embed <iframe> inside a custom element's open
    // Shadow DOM (its player wrapper), so a plain document.querySelectorAll
    // never finds it — same reason content.js's video discovery has to
    // walk shadow roots explicitly. Collected fresh on every message
    // rather than cached, so newly-loaded posts (infinite scroll) are
    // covered without needing a MutationObserver here.
    function collectIframes(root, results) {
      if (!root.querySelectorAll) return;
      root.querySelectorAll("iframe").forEach((el) => results.push(el));
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) collectIframes(el.shadowRoot, results);
      });
    }

    function findIframeForSource(source) {
      const iframes = [];
      collectIframes(document.body, iframes);
      for (const iframeEl of iframes) {
        if (iframeEl.contentWindow === source) return iframeEl;
      }
      return null;
    }

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.type !== MESSAGE_TYPE) return;
      if (!EMBED_ORIGIN_RE.test(event.origin)) return;

      const iframeEl = findIframeForSource(event.source);
      if (!iframeEl) return;

      if (data.action === "enter") {
        if (activeIframe === iframeEl) return;
        if (activeIframe) exitFrameFill();
        enterFrameFill(iframeEl);
      } else if (data.action === "exit") {
        if (activeIframe !== iframeEl) return;
        exitFrameFill(false);
      }
    });
  }

  // ------------------------------------------------------------------
  // Embed iframe (redgifs.com, etc.): discovers <video> elements in its own
  // document and attaches a button row, same data-fd-role convention as
  // content.js. Fill/Exit clicks postMessage the top frame instead of
  // touching the video's own styles; Play/Pause and Mute act on the local
  // video directly.
  // ------------------------------------------------------------------
  function initEmbedFrame() {
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

    const videoState = new WeakMap(); // video -> { row, resizeObserver, filled, cleanup }
    let filledVideo = null;

    function sendToTop(action) {
      if (window.top) {
        window.top.postMessage({ type: MESSAGE_TYPE, action }, "*");
      }
    }

    function setFilledLabel(entry, filled) {
      entry.row.dataset.fdFilled = filled ? "1" : "0";
      entry.fillBtn.textContent = filled ? "Exit" : "Fill";
      entry.playPauseBtn.hidden = !filled;
      entry.muteBtn.hidden = !filled;
    }

    function requestEnter(video, entry) {
      if (filledVideo && filledVideo !== video) {
        const prevEntry = videoState.get(filledVideo);
        if (prevEntry) setFilledLabel(prevEntry, false);
      }
      filledVideo = video;
      setFilledLabel(entry, true);
      sendToTop("enter");
    }

    function requestExit(video, entry) {
      if (filledVideo !== video) return;
      filledVideo = null;
      setFilledLabel(entry, false);
      sendToTop("exit");
    }

    // The top frame's own Escape listener, or an eviction via
    // FD.requestExclusiveFill on that side, exits without this iframe
    // asking first — reset the button row to match.
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.type !== MESSAGE_TYPE) return;
      if (data.action === "exited" && filledVideo) {
        const entry = videoState.get(filledVideo);
        if (entry) setFilledLabel(entry, false);
        filledVideo = null;
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !filledVideo) return;
      const entry = videoState.get(filledVideo);
      if (entry) requestExit(filledVideo, entry);
    });

    function attachButtonRow(video) {
      if (videoState.has(video)) return;

      const row = document.createElement("div");
      row.className = "fd-row";

      const fillBtn = document.createElement("button");
      fillBtn.type = "button";
      fillBtn.textContent = "Fill";
      fillBtn.dataset.fdRole = "fill";
      row.appendChild(fillBtn);

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

      const entry = {
        row,
        fillBtn,
        playPauseBtn,
        muteBtn,
        resizeObserver,
        cleanup() {
          if (filledVideo === video) requestExit(video, entry);
          resizeObserver.disconnect();
          window.removeEventListener("scroll", syncPosition, true);
          window.removeEventListener("resize", syncPosition);
          video.removeEventListener("play", updatePlayPauseLabel);
          video.removeEventListener("pause", updatePlayPauseLabel);
          video.removeEventListener("volumechange", updateMuteLabel);
          row.remove();
          videoState.delete(video);
        },
      };

      fillBtn.addEventListener("click", () => {
        if (filledVideo === video) requestExit(video, entry);
        else requestEnter(video, entry);
      });

      videoState.set(video, entry);
    }

    function detachButtonRow(video) {
      const entry = videoState.get(video);
      if (entry) entry.cleanup();
    }

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
  }
})();
