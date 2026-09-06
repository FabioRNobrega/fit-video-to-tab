// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { serveRepoAtOrigin } = require("./helpers/serveRepoAtOrigin");

// Only one video may be filled at a time tab-wide, whether via the generic
// path (fillTab.js, for the same-document #native video) or the Reddit
// iframe path (redditFill.js, for the embedded video) — FR8. See
// Specs/20260902124537-reddit-iframe-embed-fill/.
const FIXTURE = "file://" + path.join(__dirname, "..", "fixtures", "reddit-top.html");

test.beforeEach(async ({ page }) => {
  await serveRepoAtOrigin(page, "https://www.redgifs.com/**");
  await page.goto(FIXTURE);
});

test("filling the embed iframe evicts an active generic-path fill", async ({ page }) => {
  const nativeVideo = page.locator("#native");
  const iframeEl = page.locator("#embed");
  const nativeFillBtn = page.locator('[data-fd-role="fill"]');
  const embedFrame = page.frameLocator("#embed");

  await nativeVideo.hover();
  await nativeFillBtn.click();
  await expect(nativeVideo).toHaveClass(/fd-fill-active/);

  // The native video's fullscreen overlay visually covers the iframe
  // entirely (the same reason it covers the rest of the page) — a real
  // user would Exit or press Escape first. A real (coordinate-based) click
  // would land on the occluding video instead of the button underneath, so
  // this invokes the button's own click() directly to exercise the
  // exclusivity/message-handling logic itself, independent of that
  // physical occlusion, which is an inherent property of any
  // full-viewport overlay, not a bug in this feature.
  await embedFrame.locator('[data-fd-role="fill"]').evaluate((el) => el.click());

  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);
  await expect(nativeVideo).not.toHaveClass(/fd-fill-active/);
  await expect(nativeFillBtn).toHaveAttribute("aria-label", "Fill video");
});

test("filling the generic-path video evicts an active embed-iframe fill", async ({ page }) => {
  const nativeVideo = page.locator("#native");
  const iframeEl = page.locator("#embed");
  const nativeFillBtn = page.locator('[data-fd-role="fill"]');
  const embedFrame = page.frameLocator("#embed");

  await embedFrame.locator("#v1").hover();
  await embedFrame.locator('[data-fd-role="fill"]').click();
  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);

  // The now-filled iframe covers the whole top-frame viewport (fixed,
  // top z-index), occluding the native video itself for real pointer
  // input — dispatch a synthetic pointermove at its coordinates instead,
  // the same kind of occlusion workaround as the evaluate()-click above.
  // Hover detection is coordinate-based (see content.js's hoverEntries),
  // so this reaches it the same way a real, unoccluded pointer move would.
  await page.evaluate(() => {
    const rect = document.querySelector("#native").getBoundingClientRect();
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      })
    );
  });
  await nativeFillBtn.click();

  await expect(nativeVideo).toHaveClass(/fd-fill-active/);
  await expect(iframeEl).not.toHaveClass(/fd-reddit-frame-fill/);
  await expect(embedFrame.locator('[data-fd-role="fill"]')).toHaveAttribute(
    "aria-label",
    "Fill video"
  );
});
