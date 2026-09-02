// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { serveRepoAtOrigin } = require("./helpers/serveRepoAtOrigin");

// Reproduces the Reddit cross-origin embed regression: a <video> rendered
// inside a cross-origin iframe (RedGIFs primarily) is invisible to the
// generic content_scripts entry (all_frames defaults to false), and even
// with visibility, position:fixed inside that iframe can't reach the real
// tab viewport — so reddit_fill.js fills the <iframe> element itself
// instead, coordinated across the frame boundary via postMessage. See
// Specs/20260902124537-reddit-iframe-embed-fill/.
const FIXTURE = "file://" + path.join(__dirname, "..", "fixtures", "reddit-top.html");

test.beforeEach(async ({ page }) => {
  // The iframe's src is served "from" https://www.redgifs.com so
  // reddit_fill.js's real event.origin check is exercised, not bypassed by
  // file:// same-origin defaults.
  await serveRepoAtOrigin(page, "https://www.redgifs.com/**");
  await page.goto(FIXTURE);
});

function embedFrame(page) {
  return page.frameLocator("#embed");
}

test("a video inside a cross-origin embed iframe gets a Fill button", async ({ page }) => {
  await expect(embedFrame(page).locator('[data-fd-role="fill"]')).toHaveText("Fill");
});

test("Fill fills the <iframe> element itself, not the video inside it", async ({ page }) => {
  const iframeEl = page.locator("#embed");
  const embedVideo = embedFrame(page).locator("#v1");

  await embedFrame(page).locator('[data-fd-role="fill"]').click();

  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);
  await expect(embedVideo).not.toHaveClass(/fd-fill-active/);
  await expect(embedFrame(page).locator('[data-fd-role="fill"]')).toHaveText("Exit");

  const box = await iframeEl.boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeCloseTo(viewport.width, 0);
  expect(box.height).toBeCloseTo(viewport.height, 0);
});

test("Escape from within the embed iframe exits the fill", async ({ page }) => {
  const iframeEl = page.locator("#embed");

  await embedFrame(page).locator('[data-fd-role="fill"]').click();
  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);

  await embedFrame(page).locator("body").press("Escape");

  await expect(iframeEl).not.toHaveClass(/fd-reddit-frame-fill/);
  await expect(embedFrame(page).locator('[data-fd-role="fill"]')).toHaveText("Fill");
});

test("Escape from the top frame exits an active embed-iframe fill", async ({ page }) => {
  const iframeEl = page.locator("#embed");

  await embedFrame(page).locator('[data-fd-role="fill"]').click();
  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);

  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");

  await expect(iframeEl).not.toHaveClass(/fd-reddit-frame-fill/);
  // The top frame's Escape path notifies the iframe so its own button row
  // resets too (FR9) — not just the iframe element's class.
  await expect(embedFrame(page).locator('[data-fd-role="fill"]')).toHaveText("Fill");
});

test("filling the embed iframe neutralizes its own clipping ancestor and restores it on exit", async ({
  page,
}) => {
  const wrapper = page.locator("#wrapper");

  const overflowBefore = await wrapper.evaluate((el) => el.style.overflow);
  expect(overflowBefore).toBe("hidden");

  await embedFrame(page).locator('[data-fd-role="fill"]').click();
  const overflowDuring = await wrapper.evaluate((el) => el.style.overflow);
  expect(overflowDuring).toBe("visible");

  await embedFrame(page).locator("body").press("Escape");
  const overflowAfter = await wrapper.evaluate((el) => el.style.overflow);
  expect(overflowAfter).toBe("hidden");
});

test("removing the embedded video while filled exits the top-frame iframe fill", async ({
  page,
}) => {
  const iframeEl = page.locator("#embed");

  await embedFrame(page).locator('[data-fd-role="fill"]').click();
  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);

  await embedFrame(page).locator("#v1").evaluate((video) => video.remove());

  await expect(iframeEl).not.toHaveClass(/fd-reddit-frame-fill/);
});
