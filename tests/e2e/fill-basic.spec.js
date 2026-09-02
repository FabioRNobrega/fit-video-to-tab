// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");

const FIXTURE = "file://" + path.join(__dirname, "..", "fixtures", "plain.html");

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test("Fill button appears as an icon over the video's corner", async ({ page }) => {
  const fillBtn = page.locator('[data-fd-role="fill"]');
  await expect(fillBtn).toHaveAttribute("aria-label", "Fill video");
  await expect(fillBtn.locator("svg")).toBeVisible();
});

test("clicking Fill fills the viewport, hides native controls, and hides the floating fill icon", async ({
  page,
}) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await fillBtn.click();

  // The bottom bar has its own Exit control once filled, so the floating
  // icon (which would otherwise sit over the video's corner) hides for
  // the duration rather than flipping to an "exit" icon.
  await expect(fillBtn).toBeHidden();
  await expect(video).toHaveClass(/fd-fill-active/);
  await expect(video).not.toHaveAttribute("controls", "");

  const box = await video.boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeCloseTo(viewport.width, 0);
  expect(box.height).toBeCloseTo(viewport.height, 0);
});

test("Escape exits fill mode, restores controls, and reveals the floating fill icon again", async ({
  page,
}) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await fillBtn.click();
  await expect(video).toHaveClass(/fd-fill-active/);
  await expect(fillBtn).toBeHidden();

  await page.keyboard.press("Escape");

  await expect(fillBtn).toBeVisible();
  await expect(fillBtn).toHaveAttribute("aria-label", "Fill video");
  await expect(video).not.toHaveClass(/fd-fill-active/);
  await expect(video).toHaveAttribute("controls", "");
});

test("clicking the bar's Exit button also exits fill mode", async ({ page }) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');
  const exitBtn = page.locator('[data-fd-role="exit"]');

  await fillBtn.click();
  // The bar is hidden (pointer-events: none) until the pointer moves over
  // it, per FR9 — reveal it first or the click hit-tests through to the
  // video underneath.
  await video.dispatchEvent("mousemove");
  await exitBtn.click();

  await expect(fillBtn).toBeVisible();
  await expect(fillBtn).toHaveAttribute("aria-label", "Fill video");
  await expect(video).not.toHaveClass(/fd-fill-active/);
});

test("control bar (Play/Pause, Mute) is absent until filled, then present", async ({ page }) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');
  const playPauseBtn = page.locator('[data-fd-role="play-pause"]');
  const muteBtn = page.locator('[data-fd-role="mute"]');

  await expect(playPauseBtn).toBeHidden();
  await expect(muteBtn).toBeHidden();

  await fillBtn.click();

  await expect(playPauseBtn).toBeVisible();
  await expect(muteBtn).toBeVisible();

  await page.keyboard.press("Escape"); // exit — fillBtn is hidden while filled

  await expect(playPauseBtn).toBeHidden();
  await expect(muteBtn).toBeHidden();
});

test("Mute button toggles video.muted and updates its label", async ({ page }) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');
  const muteBtn = page.locator('[data-fd-role="mute"]');

  await fillBtn.click();
  expect(await video.evaluate((el) => el.muted)).toBe(false);

  // The bar is hidden (pointer-events: none) until the pointer moves over
  // it, per FR9 — reveal it first or the click hit-tests through to the
  // video underneath.
  await video.dispatchEvent("mousemove");

  await muteBtn.click();
  expect(await video.evaluate((el) => el.muted)).toBe(true);
  await expect(muteBtn).toHaveText("🔇");

  await muteBtn.click();
  expect(await video.evaluate((el) => el.muted)).toBe(false);
  await expect(muteBtn).toHaveText("🔊");
});

test("Play/Pause button calls video.play()/pause() and its icon follows real play/pause events", async ({
  page,
}) => {
  const fillBtn = page.locator('[data-fd-role="fill"]');
  const playPauseBtn = page.locator('[data-fd-role="play-pause"]');

  // The fixture video has no decodable source, so play()/pause() are
  // stubbed here to avoid relying on real media decode inside the
  // container — this still exercises the extension's actual click wiring
  // and its "paused"/"play"/"pause" event-driven icon sync.
  await page.locator("#v1").evaluate((el) => {
    let paused = true;
    Object.defineProperty(el, "paused", { get: () => paused });
    el.play = () => {
      paused = false;
      el.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    el.pause = () => {
      paused = true;
      el.dispatchEvent(new Event("pause"));
    };
  });

  await fillBtn.click();
  await expect(playPauseBtn).toHaveAttribute("aria-label", "Play");

  // The bar is hidden (pointer-events: none) until the pointer moves over
  // it, per FR9 — reveal it first or the click hit-tests through to the
  // video underneath.
  await page.locator("#v1").dispatchEvent("mousemove");

  await playPauseBtn.click();
  await expect(playPauseBtn).toHaveAttribute("aria-label", "Pause");

  await playPauseBtn.click();
  await expect(playPauseBtn).toHaveAttribute("aria-label", "Play");
});
