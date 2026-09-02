// YouTube-specific cleanup: while a video on this page is filled (via
// fillTab.js's generic .fd-fill-active mechanism), hide YouTube's own page
// chrome that can end up visible behind or around the filled video instead
// of staying out of the way — the classic-layout column container, and the
// masthead's own container/background. Each is restored exactly as found
// the moment fill exits.
(function () {
  const TARGET_SELECTORS = [
    "#columns.style-scope.ytd-watch-flexy, #columns",
    "#container.style-scope.ytd-masthead",
    "#background.style-scope.ytd-masthead",
  ];
  const FILLED_SELECTOR = ".fd-fill-active";

  let hidden = null; // [{ el, prevDisplay }] while active, else null

  function applyHide() {
    if (hidden) return;
    hidden = [];
    TARGET_SELECTORS.forEach((selector) => {
      const el = document.querySelector(selector);
      if (!el) return;
      hidden.push({ el, prevDisplay: el.style.display });
      el.style.setProperty("display", "none", "important");
    });
  }

  function removeHide() {
    if (!hidden) return;
    hidden.forEach(({ el, prevDisplay }) => {
      if (prevDisplay) {
        el.style.display = prevDisplay;
      } else {
        el.style.removeProperty("display");
      }
    });
    hidden = null;
  }

  function sync() {
    if (document.querySelector(FILLED_SELECTOR)) applyHide();
    else removeHide();
  }

  // No direct enter/exit hook is exposed by fillTab.js, so this watches for
  // the same .fd-fill-active class it toggles — consistent with how
  // fillTab.js itself self-heals against class/style stripping.
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true,
  });

  sync();
})();
