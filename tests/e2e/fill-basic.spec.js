// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");

const FIXTURE = "file://" + path.join(__dirname, "..", "fixtures", "plain.html");

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test("Fill button appears above the video", async ({ page }) => {
  await expect(page.locator('[data-fd-role="fill"]')).toHaveText("Fill");
});

test("clicking Fill fills the viewport and hides native controls", async ({ page }) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await fillBtn.click();

  await expect(fillBtn).toHaveText("Exit");
  await expect(video).toHaveClass(/fd-fill-active/);
  await expect(video).not.toHaveAttribute("controls", "");

  const box = await video.boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeCloseTo(viewport.width, 0);
  expect(box.height).toBeCloseTo(viewport.height, 0);
});

test("Escape exits fill mode and restores controls", async ({ page }) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await fillBtn.click();
  await expect(video).toHaveClass(/fd-fill-active/);

  await page.keyboard.press("Escape");

  await expect(fillBtn).toHaveText("Fill");
  await expect(video).not.toHaveClass(/fd-fill-active/);
  await expect(video).toHaveAttribute("controls", "");
});

test("clicking Exit also exits fill mode", async ({ page }) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await fillBtn.click();
  await fillBtn.click(); // now labeled "Exit"

  await expect(fillBtn).toHaveText("Fill");
  await expect(video).not.toHaveClass(/fd-fill-active/);
});

test("Play/Pause and Mute buttons are hidden until filled, then shown", async ({ page }) => {
  const fillBtn = page.locator('[data-fd-role="fill"]');
  const playPauseBtn = page.locator('[data-fd-role="play-pause"]');
  const muteBtn = page.locator('[data-fd-role="mute"]');

  await expect(playPauseBtn).toBeHidden();
  await expect(muteBtn).toBeHidden();

  await fillBtn.click();

  await expect(playPauseBtn).toBeVisible();
  await expect(muteBtn).toBeVisible();

  await fillBtn.click(); // exit

  await expect(playPauseBtn).toBeHidden();
  await expect(muteBtn).toBeHidden();
});

test("Mute button toggles video.muted and updates its label", async ({ page }) => {
  const video = page.locator("#v1");
  const fillBtn = page.locator('[data-fd-role="fill"]');
  const muteBtn = page.locator('[data-fd-role="mute"]');

  await fillBtn.click();
  expect(await video.evaluate((el) => el.muted)).toBe(false);

  await muteBtn.click();
  expect(await video.evaluate((el) => el.muted)).toBe(true);
  await expect(muteBtn).toHaveText("🔇");

  await muteBtn.click();
  expect(await video.evaluate((el) => el.muted)).toBe(false);
  await expect(muteBtn).toHaveText("🔊");
});

test("Play/Pause button calls video.play()/pause() and its label follows real play/pause events", async ({
  page,
}) => {
  const fillBtn = page.locator('[data-fd-role="fill"]');
  const playPauseBtn = page.locator('[data-fd-role="play-pause"]');

  // The fixture video has no decodable source, so play()/pause() are
  // stubbed here to avoid relying on real media decode inside the
  // container — this still exercises the extension's actual click wiring
  // and its "paused"/"play"/"pause" event-driven label sync.
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
  await expect(playPauseBtn).toHaveText("▶");

  await playPauseBtn.click();
  await expect(playPauseBtn).toHaveText("⏸");

  await playPauseBtn.click();
  await expect(playPauseBtn).toHaveText("▶");
});
