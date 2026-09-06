// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { serveRepoAtOrigin } = require("./helpers/serveRepoAtOrigin");

// Reproduces the real-Reddit regression: the embed <iframe> lives inside a
// custom element's open Shadow DOM (Reddit's own player-wrapper component),
// not as a direct child of <body>. redditFill.js's top-frame role must
// find it there (a plain document.querySelectorAll("iframe") never would)
// and must be able to walk back OUT of that shadow root to reach the
// page's own clipping/stacking ancestors further up the light DOM. See
// Specs/20260902124537-reddit-iframe-embed-fill/.
const FIXTURE =
  "file://" + path.join(__dirname, "..", "fixtures", "reddit-top-shadow-embed.html");

test.beforeEach(async ({ page }) => {
  await serveRepoAtOrigin(page, "https://www.redgifs.com/**");
  await page.goto(FIXTURE);
});

function embedFrame(page) {
  return page.frameLocator("#embed");
}

test("a video inside a shadow-nested embed iframe gets a Fill button", async ({ page }) => {
  await expect(embedFrame(page).locator('[data-fd-role="fill"]')).toHaveAttribute(
    "aria-label",
    "Fill video"
  );
});

test("Fill actually fills a shadow-nested embed iframe to the viewport", async ({ page }) => {
  const iframeEl = page.locator("#embed");

  await embedFrame(page).locator("#v1").hover();
  await embedFrame(page).locator('[data-fd-role="fill"]').click();

  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);
  const box = await iframeEl.boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeCloseTo(viewport.width, 0);
  expect(box.height).toBeCloseTo(viewport.height, 0);
});

test("filling a shadow-nested embed iframe neutralizes a light-DOM ancestor above the shadow host", async ({
  page,
}) => {
  const wrapper = page.locator("#wrapper");

  const overflowBefore = await wrapper.evaluate((el) => el.style.overflow);
  expect(overflowBefore).toBe("hidden");

  await embedFrame(page).locator("#v1").hover();
  await embedFrame(page).locator('[data-fd-role="fill"]').click();
  const overflowDuring = await wrapper.evaluate((el) => el.style.overflow);
  expect(overflowDuring).toBe("visible");

  await embedFrame(page).locator("body").press("Escape");
  const overflowAfter = await wrapper.evaluate((el) => el.style.overflow);
  expect(overflowAfter).toBe("hidden");
});
