// Reddit's native v.redd.it player (<shreddit-player>) renders its real
// <video> and its own control overlay (<shreddit-media-ui>) as siblings
// inside the same open Shadow DOM. That overlay sits visually on top of the
// video with pointer-events re-enabled on its own .controls/play-button
// elements, so the browser's hit-test resolves every press to Reddit's own
// overlay instead of the video underneath — drag.js's video-attached
// pointer listeners never fire, and Reddit's click-to-toggle-playback
// handler fires instead. fillTab.js hides whatever FD.collectFillChrome
// returns while filled (same "hide the site's own chrome" idea
// redGifFill.js already applies to RedGIFs' player), which removes the
// overlay from hit-testing entirely and lets drag/pointer events reach the
// real <video>.
(function () {
  const FD = (window.__fdExt = window.__fdExt || {});

  FD.collectFillChrome = function (video) {
    const root = video.getRootNode();
    if (!(root instanceof ShadowRoot) || root.host.tagName !== "SHREDDIT-PLAYER") {
      return [];
    }
    const mediaUi = root.querySelector("shreddit-media-ui");
    return mediaUi ? [mediaUi] : [];
  };
})();
