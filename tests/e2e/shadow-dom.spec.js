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

test("a video inside an open Shadow DOM gets a Fill button", async ({ page }) => {
  // Playwright's CSS engine pierces open shadow roots by default, matching
  // what a real viewer sees — this mirrors that a person interacting with
  // the page has no trouble reaching into the shadow root either.
  await expect(page.locator('[data-fd-role="fill"]')).toHaveText("Fill");
});

test("Fill/Exit works for a Shadow DOM video", async ({ page }) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await fillBtn.click();
  await expect(video).toHaveClass(/fd-fill-active/);
  await expect(fillBtn).toHaveText("Exit");

  await page.keyboard.press("Escape");
  await expect(video).not.toHaveClass(/fd-fill-active/);
  await expect(fillBtn).toHaveText("Fill");
});
