// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");

// Regression test: X/Twitter and Instagram both render their own full-size
// overlay <div> directly on top of the <video> element for their own
// play/pause and ad-detection UI. Hover-reveal must not depend on the
// <video> element itself being the one that receives real pointer events —
// see content.js's coordinate-based hoverEntries.
const FIXTURE =
  "file://" + path.join(__dirname, "..", "fixtures", "overlay-occluded-video.html");

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test("Fill button reveals on hover even when a host overlay div sits on top of the video", async ({
  page,
}) => {
  const overlay = page.locator(".overlay");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await expect(fillBtn).toBeHidden();

  // A real user's pointer lands on the host page's own overlay div, not
  // the <video> underneath it — hovering the overlay (the element real
  // pointer input actually reaches) must still reveal the button.
  await overlay.hover();
  await expect(fillBtn).toBeVisible();

  // The player sits flush at the page's top-left corner, so move well
  // clear of it rather than to (0, 0), which would still land inside it.
  await page.mouse.move(700, 500);
  await expect(fillBtn).toBeHidden();
});
