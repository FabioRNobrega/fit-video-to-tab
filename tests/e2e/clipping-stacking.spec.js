// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");

// Reproduces two real regressions found testing against x.com and their
// fixes, so they can't silently come back:
//   1. A video nested inside overflow:hidden/stacking-context ancestors
//      must still reach the true viewport AND paint above the host page's
//      own fixed UI (e.g. a sidebar) — the ancestor-neutralization fix.
//   2. Neutralizing ancestors for one video must never affect a SIBLING
//      video that shares one of those ancestors (e.g. an infinite-scroll
//      timeline's shared list container) — the shared-ancestor-boundary
//      fix. The fixture's #timeline holds two videos to exercise this.
const FIXTURE =
  "file://" + path.join(__dirname, "..", "fixtures", "clipping-stacking.html");

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test("filling a clipped video reaches the true viewport", async ({ page }) => {
  const video = page.locator("#v1");
  await page.locator("#v1").hover();
  await page.locator('[data-fd-role="fill"]').first().click();

  await expect(video).toHaveClass(/fd-fill-active/);
  const box = await video.boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeCloseTo(viewport.width, 0);
  expect(box.height).toBeCloseTo(viewport.height, 0);
});

test("filled video paints above the page's own fixed sidebar", async ({ page }) => {
  await page.locator("#v1").hover();
  await page.locator('[data-fd-role="fill"]').first().click();

  // The sidebar covers x:0-60, y:0-100%. y:100 stays clear of the
  // extension's own button row (which sits along the very top edge).
  // Before the stacking-context fix, elementFromPoint here returned the
  // sidebar; after it, the video wins.
  const topElementId = await page.evaluate(() => {
    const el = document.elementFromPoint(10, 100);
    return el && el.id;
  });
  expect(topElementId).toBe("v1");
});

test("filling one video does not affect a sibling video sharing the timeline", async ({
  page,
}) => {
  const v1 = page.locator("#v1");
  const v2 = page.locator("#v2");
  const timeline = page.locator("#timeline");

  const timelineOverflowBefore = await timeline.evaluate((el) => el.style.overflow);
  expect(timelineOverflowBefore).toBe("");

  await page.locator("#v1").hover();
  await page.locator('[data-fd-role="fill"]').first().click();

  await expect(v1).toHaveClass(/fd-fill-active/);
  await expect(v2).not.toHaveClass(/fd-fill-active/);

  // The shared ancestor's own overflow must never be overridden — that's
  // exactly what let other videos leak into view in the regression.
  const timelineOverflowDuring = await timeline.evaluate((el) => el.style.overflow);
  expect(timelineOverflowDuring).toBe("");

  const v2Position = await v2.evaluate((el) => getComputedStyle(el).position);
  expect(v2Position).not.toBe("fixed");
});

test("stacking overrides on an ancestor above the shared boundary are restored on exit", async ({
  page,
}) => {
  const app = page.locator("#app");

  const zIndexBefore = await app.evaluate((el) => el.style.zIndex);
  expect(zIndexBefore).toBe("");

  await page.locator("#v1").hover();
  await page.locator('[data-fd-role="fill"]').first().click();
  const zIndexDuring = await app.evaluate((el) => el.style.zIndex);
  expect(zIndexDuring).toBe("auto");

  await page.keyboard.press("Escape");
  const zIndexAfter = await app.evaluate((el) => el.style.zIndex);
  expect(zIndexAfter).toBe("");
});
