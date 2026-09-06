// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");

// Reproduces the Reddit/redgifs regression: a <video> rendered inside an
// open Shadow DOM must still be discovered and get a working Fill button,
// even though plain querySelectorAll/MutationObserver never cross a shadow
// boundary on their own.
const FIXTURE = "file://" + path.join(__dirname, "..", "fixtures", "shadow-dom.html");

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test("a video inside an open Shadow DOM gets a hover-revealed Fill button", async ({ page }) => {
  // Playwright's CSS engine pierces open shadow roots by default, matching
  // what a real viewer sees — this mirrors that a person interacting with
  // the page has no trouble reaching into the shadow root either.
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await expect(fillBtn).toHaveAttribute("aria-label", "Fill video");
  await expect(fillBtn).toBeHidden();

  await video.hover();
  await expect(fillBtn).toBeVisible();

  await page.mouse.move(0, 0);
  await expect(fillBtn).toBeHidden();
});

test("Fill/Exit works for a Shadow DOM video", async ({ page }) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await video.hover();
  await fillBtn.click();
  await expect(video).toHaveClass(/fd-fill-active/);
  // The floating icon hides once filled — the bar's own Exit control
  // takes over.
  await expect(fillBtn).toBeHidden();

  // A shadow-nested video can't be reached by the document.head
  // stylesheet backing the fd-fill-active class (shadow DOM is a separate
  // style scope) — fillTab.js also applies the same declarations inline,
  // so assert the actual computed effect, not just the class marker.
  await expect(video).toHaveCSS("position", "fixed");
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  await expect(video).toHaveCSS("width", `${viewportWidth}px`);

  await page.keyboard.press("Escape");
  await expect(video).not.toHaveClass(/fd-fill-active/);
  await expect(video).not.toHaveCSS("position", "fixed");
  await expect(fillBtn).toBeVisible();
  await expect(fillBtn).toHaveAttribute("aria-label", "Fill video");
});
