// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");

// Regression test for Reddit's native v.redd.it player: <shreddit-media-ui>
// sits on top of the real <video> inside the same shadow root, with its own
// .controls layer re-enabling pointer-events to catch clicks for its own
// play/pause toggle. Real mouse input (not el.dispatchEvent, which bypasses
// hit-testing entirely) is used here specifically to prove pointer events
// actually reach the video and not Reddit's overlay.
const FIXTURE = "file://" + path.join(__dirname, "..", "fixtures", "reddit-native-player.html");

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test("filling a native Reddit player hides its own control overlay", async ({ page }) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await video.hover();
  await fillBtn.click();

  const mediaUiDisplay = await page.evaluate(
    () => getComputedStyle(document.querySelector("shreddit-player").shadowRoot.querySelector("shreddit-media-ui")).display
  );
  expect(mediaUiDisplay).toBe("none");

  await page.keyboard.press("Escape");

  const mediaUiDisplayAfterExit = await page.evaluate(
    () => getComputedStyle(document.querySelector("shreddit-player").shadowRoot.querySelector("shreddit-media-ui")).display
  );
  expect(mediaUiDisplayAfterExit).not.toBe("none");
});

test("dragging a filled native Reddit video repositions it instead of hitting Reddit's own overlay", async ({
  page,
}) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await video.hover();
  await fillBtn.click();

  const rect = await video.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  await video.evaluate((el, { videoWidth, videoHeight }) => {
    Object.defineProperty(el, "videoWidth", { value: videoWidth, configurable: true });
    Object.defineProperty(el, "videoHeight", { value: videoHeight, configurable: true });
  }, { videoWidth: rect.width * 2, videoHeight: rect.height });

  const centerY = rect.top + rect.height / 2;
  await page.mouse.move(rect.left + rect.width * 0.7, centerY);
  await page.mouse.down();
  await page.mouse.move(rect.left + rect.width * 0.3, centerY, { steps: 5 });
  await page.mouse.up();

  const objectPosition = await video.evaluate((el) => el.style.objectPosition);
  expect(objectPosition).not.toBe("");

  // Reddit's own overlay handler must never have fired — the drag landed on
  // the real <video>, not the hidden .controls layer.
  expect(await page.evaluate(() => window.__nativeToggleCount)).toBe(0);
});

test("a plain click on a filled native Reddit video does not trigger Reddit's own overlay handler", async ({
  page,
}) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await video.hover();
  await fillBtn.click();

  const rect = await video.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  await page.mouse.click(rect.left + rect.width / 2, rect.top + rect.height / 2);

  expect(await page.evaluate(() => window.__nativeToggleCount)).toBe(0);
});
