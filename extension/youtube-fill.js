// YouTube-specific cleanup: while a video on this page is filled (via
// fillTab.js's generic .fd-fill-active mechanism), hide YouTube's own
// #columns.style-scope.ytd-watch-flexy container. That element holds
// YouTube's alternate/classic layout (title, recommendations, related
// thumbnails, etc.) and can end up visible behind or around the filled
// video instead of staying out of the way, which is what showed through
// in the screenshots this was written to fix. Restored exactly as found
// the moment fill exits.
(function () {
  const TARGET_SELECTOR = "#columns.style-scope.ytd-watch-flexy, #columns";
  const FILLED_SELECTOR = ".fd-fill-active";

  let hiddenEl = null;
  let prevDisplay = null;

  function applyHide() {
    if (hiddenEl) return;
    const el = document.querySelector(TARGET_SELECTOR);
    if (!el) return;
    prevDisplay = el.style.display;
    el.style.setProperty("display", "none", "important");
    hiddenEl = el;
  }

  function removeHide() {
    if (!hiddenEl) return;
    if (prevDisplay) {
      hiddenEl.style.display = prevDisplay;
    } else {
      hiddenEl.style.removeProperty("display");
    }
    hiddenEl = null;
    prevDisplay = null;
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
