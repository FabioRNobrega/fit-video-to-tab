// Instagram-specific route-assisted fill. Feed/timeline videos are often
// controlled by Instagram's virtualized timeline player, so filling them in
// place can trigger pauses, remounts, and scroll jumps. Instead, a Fill click
// on the timeline opens the video post, auto-fills the post-page video, then
// returns with history.back() on exit so Instagram/browser history restores
// the original feed position.
(function () {
  if (!/(\.|^)instagram\.com$/i.test(location.hostname)) return;

  const FD = (window.__fdExt = window.__fdExt || {});
  const PENDING_KEY = "fdInstagramPendingFill";
  const PENDING_TTL_MS = 1000 * 60;
  const POST_PATH_RE = /^\/(?:p|reel|reels)\//;
  const previousBeforeFillToggle = FD.beforeFillToggle;
  const previousOnFillEnter = FD.onFillEnter;
  const previousOnFillExit = FD.onFillExit;
  const previousOnFillControlExit = FD.onFillControlExit;
  let activeRouteFill = null;

  function normalizePath(path) {
    if (!path) return "";
    try {
      return new URL(path, location.href).pathname.replace(/\/$/, "");
    } catch (_) {
      return String(path).replace(/\/$/, "");
    }
  }

  function currentPostPath() {
    return POST_PATH_RE.test(location.pathname) ? normalizePath(location.pathname) : "";
  }

  function findPostLink(video) {
    const article = video.closest("article") || video.parentElement;
    if (!article) return null;
    const links = Array.from(article.querySelectorAll('a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]'));
    return links.find((link) => POST_PATH_RE.test(new URL(link.getAttribute("href"), location.href).pathname)) || null;
  }

  function savePendingFill(video, href) {
    const targetUrl = new URL(href, location.href);
    const pending = {
      targetHref: targetUrl.href,
      targetPath: normalizePath(targetUrl.pathname),
      sourceHref: location.href,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      muted: video.muted,
      playbackRate: video.playbackRate,
      wasPlaying: !video.paused,
      createdAt: Date.now(),
    };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    return pending;
  }

  function readPendingFill() {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    try {
      const pending = JSON.parse(raw);
      if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
        sessionStorage.removeItem(PENDING_KEY);
        return null;
      }
      return pending;
    } catch (err) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
  }

  function findPostPageVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return null;
    return videos
      .slice()
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return bRect.width * bRect.height - aRect.width * aRect.height;
      })[0];
  }

  function restoreVideoState(video, pending) {
    video.muted = pending.muted;
    video.playbackRate = pending.playbackRate || 1;
    if (Number.isFinite(pending.currentTime) && pending.currentTime > 0 && video.readyState > 0) {
      try {
        video.currentTime = pending.currentTime;
      } catch (_) {}
    }
  }

  function autoFillPendingPost() {
    const pending = readPendingFill();
    if (!pending) return;
    if (normalizePath(location.pathname) !== pending.targetPath) {
      return;
    }

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const video = findPostPageVideo();
      if (video && FD.fillVideo) {
        clearInterval(timer);
        restoreVideoState(video, pending);
        activeRouteFill = pending;
        FD.fillVideo(video);
        if (pending.wasPlaying) {
          const playResult = video.play();
          if (playResult && playResult.catch) playResult.catch(() => {});
        }
        return;
      }

      if (attempts >= 80) {
        clearInterval(timer);
        sessionStorage.removeItem(PENDING_KEY);
      }
    }, 250);
  }

  FD.beforeFillToggle = function (video, controls) {
    if (previousBeforeFillToggle && previousBeforeFillToggle(video, controls)) return true;
    const postPath = currentPostPath();
    if (postPath) {
      return false;
    }

    const link = findPostLink(video);
    if (!link) {
      return false;
    }

    const pending = savePendingFill(video, link.href || link.getAttribute("href"));
    location.assign(pending.targetHref);
    return true;
  };

  FD.onFillEnter = function (video) {
    if (previousOnFillEnter) previousOnFillEnter(video);
  };

  FD.onFillExit = function (video) {
    if (previousOnFillExit) previousOnFillExit(video);
  };

  FD.onFillControlExit = function (video) {
    if (previousOnFillControlExit) previousOnFillControlExit(video);
    if (!activeRouteFill) return;
    const pending = activeRouteFill;
    activeRouteFill = null;
    sessionStorage.removeItem(PENDING_KEY);
    setTimeout(() => {
      history.back();
    }, 80);
  };

  autoFillPendingPost();
})();
