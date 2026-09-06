// RedGIF-specific inner-frame fill. redditFill.js still expands the
// cross-origin iframe from Reddit's top frame; this module takes over the
// RedGIF document inside that iframe so the real <video> fills the expanded
// viewport and RedGIF's own player chrome gets out of the way. See
// Specs/20260906160538-redgif-direct-video-fill/.
(function () {
  const FD = (window.__fdExt = window.__fdExt || {});
  const REDGIF_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*redgifs\.com$/i;

  if (window.top === window.self || !REDGIF_ORIGIN_RE.test(window.location.origin)) {
    return;
  }

  let active = null;
  let dragSession = null;

  function saveStyle(el, touched) {
    if (!el || touched.some((entry) => entry.el === el)) return;
    touched.push({
      el,
      cssText: el.style.cssText,
      className: el.className,
      href: el.getAttribute("href"),
      target: el.getAttribute("target"),
      rel: el.getAttribute("rel"),
    });
  }

  function appendStyle(el, cssText, touched) {
    if (!el) return;
    saveStyle(el, touched);
    el.style.cssText = el.style.cssText ? `${el.style.cssText}; ${cssText}` : cssText;
  }

  function restoreTouched(touched) {
    touched.forEach(({ el, cssText, className, href, target, rel }) => {
      el.style.cssText = cssText || "";
      if (typeof className === "string") el.className = className;
      restoreAttr(el, "href", href);
      restoreAttr(el, "target", target);
      restoreAttr(el, "rel", rel);
    });
  }

  function restoreAttr(el, name, value) {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  function isExtensionElement(el) {
    return !!el.closest("[data-fd-extension-root]");
  }

  function collectRedGifChrome(video, player) {
    const chrome = new Set();
    const selectors = [
      ".Player-Poster",
      ".Player-OverLayer",
      ".backdropWrap",
      ".logo",
      ".playerBottom",
      ".sidebar",
      ".userInfo",
      "[class*='Poster']",
      "[class*='OverLayer']",
      "[class*='Overlay']",
      "[class*='Controls']",
      "[class*='Control']",
      "[class*='Brand']",
      "[class*='Logo']",
      "[class*='Avatar']",
      "[class*='User']",
      "[class*='Share']",
      "[class*='Quality']",
      "[class*='Fullscreen']",
      "[aria-label*='Share' i]",
      "[aria-label*='Quality' i]",
      "[aria-label*='Fullscreen' i]",
    ];

    const root = player || document.body;
    selectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((el) => {
        if (el === video || el.contains(video) || isExtensionElement(el)) return;
        chrome.add(el);
      });
    });

    if (player) {
      Array.from(player.children).forEach((el) => {
        if (el === video || el.contains(video) || isExtensionElement(el)) return;
        if (!el.matches(".Player-Video")) chrome.add(el);
      });
    }

    return Array.from(chrome);
  }

  function eventHitsExtension(event) {
    return event.composedPath().some((el) => {
      return el instanceof Element && isExtensionElement(el);
    });
  }

  function currentPositionX(video) {
    const raw = video.style.objectPosition;
    if (!raw) return 50;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 50;
  }

  function startDocumentDrag(event) {
    if (!active || !event.isPrimary || dragSession || eventHitsExtension(event)) return;
    const video = active.video;
    if (!video.videoWidth || !video.videoHeight) return;

    const rect = video.getBoundingClientRect();
    dragSession = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startPositionX: currentPositionX(video),
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      hasMoved: false,
    };
  }

  function moveDocumentDrag(event) {
    if (!active || !dragSession || dragSession.pointerId !== event.pointerId) return;
    const video = active.video;
    const deltaX = event.clientX - dragSession.startClientX;

    if (!dragSession.hasMoved) {
      if (Math.abs(deltaX) < 6) return;
      dragSession.hasMoved = true;
      video.classList.add("fd-dragging");
    }

    const scale = Math.max(
      dragSession.viewportWidth / dragSession.videoWidth,
      dragSession.viewportHeight / dragSession.videoHeight
    );
    const overflowX = Math.max(0, dragSession.videoWidth * scale - dragSession.viewportWidth);
    const nextPositionX =
      overflowX > 0
        ? Math.min(100, Math.max(0, dragSession.startPositionX - (deltaX / overflowX) * 100))
        : dragSession.startPositionX;

    video.style.objectPosition = nextPositionX.toFixed(2) + "% 50%";
  }

  function endDocumentDrag(event) {
    if (!active || !dragSession || dragSession.pointerId !== event.pointerId) return;
    active.video.classList.remove("fd-dragging");
    dragSession = null;
  }

  function attachDocumentDrag() {
    document.addEventListener("pointerdown", startDocumentDrag, true);
    document.addEventListener("pointermove", moveDocumentDrag, true);
    document.addEventListener("pointerup", endDocumentDrag, true);
    document.addEventListener("pointercancel", endDocumentDrag, true);
  }

  function detachDocumentDrag() {
    document.removeEventListener("pointerdown", startDocumentDrag, true);
    document.removeEventListener("pointermove", moveDocumentDrag, true);
    document.removeEventListener("pointerup", endDocumentDrag, true);
    document.removeEventListener("pointercancel", endDocumentDrag, true);
    dragSession = null;
  }

  function disableWrappingLinks(video, touched) {
    const links = [];
    let current = video.parentElement;
    while (current && current !== document.body) {
      if (current.tagName === "A") links.push(current);
      current = current.parentElement;
    }

    links.forEach((link) => {
      appendStyle(link, "cursor: grab !important; text-decoration: none !important;", touched);
      link.removeAttribute("href");
      link.removeAttribute("target");
      link.removeAttribute("rel");
    });
  }

  function fillVideo(video, shadowRoot, onExit) {
    if (active && active.video === video) return true;
    if (active) exitFill();

    const touched = [];
    const player = video.closest(".Player") || video.closest(".embeddedPlayer") || video.parentElement;
    const playerVideo = video.closest(".Player-Video") || video.closest(".videoLink") || video.parentElement;

    appendStyle(document.documentElement, "margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #000 !important;", touched);
    appendStyle(document.body, "margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #000 !important;", touched);
    appendStyle(player, "position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; margin: 0 !important; padding: 0 !important; border: 0 !important; overflow: hidden !important; background: #000 !important; z-index: 2147483645 !important;", touched);
    appendStyle(playerVideo, "position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; margin: 0 !important; padding: 0 !important; border: 0 !important; overflow: hidden !important; background: #000 !important; z-index: 2147483646 !important;", touched);
    appendStyle(video, "position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; object-fit: cover !important; object-position: 50% 50%; background: #000 !important; z-index: 2147483646 !important;", touched);
    disableWrappingLinks(video, touched);
    video.classList.add("fd-redgif-video-fill");

    collectRedGifChrome(video, player).forEach((el) => {
      appendStyle(el, "display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important;", touched);
    });

    FD.attachControls(video, { shadowRoot, onExit });
    if (FD.attachDrag) FD.attachDrag(video);
    attachDocumentDrag();

    active = { video, touched };
    return true;
  }

  function exitFill(video) {
    if (!active || (video && active.video !== video)) return false;
    const previous = active;
    active = null;

    if (FD.detachDrag) FD.detachDrag(previous.video);
    detachDocumentDrag();
    FD.detachControls(previous.video);
    previous.video.classList.remove("fd-redgif-video-fill", "fd-dragging");
    restoreTouched(previous.touched);
    return true;
  }

  function isActive(video) {
    return !!active && (!video || active.video === video);
  }

  FD.redGifFill = {
    enter: fillVideo,
    exit: exitFill,
    isActive,
  };
})();
