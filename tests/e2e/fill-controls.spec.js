// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");

// Regression tests for the fill-mode bottom control bar
// (extension/fillControls.js): scrubber, play/pause, mute, playback speed,
// standard repeat, A/B loop, exit, and the hover/idle auto-hide behavior.
// See Specs/20260902151129-fill-mode-control-bar/ and
// Specs/20260903123733-playback-speed-control/.
//
// The fixture video has no decodable source, so duration/currentTime are
// stubbed the same way fill-basic.spec.js and drag.spec.js already stub
// paused/videoWidth/videoHeight — a settable `currentTime` whose setter
// dispatches a real `timeupdate` event, so fillControls.js's actual
// event-driven wiring (not a mock of it) is what's under test.
const FIXTURE = "file://" + path.join(__dirname, "..", "fixtures", "plain.html");

async function stubMedia(page, duration) {
  await page.locator("#v1").evaluate((el, duration) => {
    let currentTime = 0;
    Object.defineProperty(el, "duration", { get: () => duration, configurable: true });
    Object.defineProperty(el, "currentTime", {
      get: () => currentTime,
      set: (value) => {
        currentTime = value;
        el.dispatchEvent(new Event("timeupdate"));
      },
      configurable: true,
    });
    el.dispatchEvent(new Event("loadedmetadata"));
  }, duration);
}

async function enterFill(page) {
  await page.locator("#v1").hover();
  await page.locator('[data-fd-role="fill"]').click();
}

// The bar is hidden (opacity 0, pointer-events: none) until the viewer
// moves the pointer, per FR9 — real .click()s on its buttons must reveal it
// first, the same way a real user's mouse movement would, or the click
// hit-tests through to the video underneath instead.
async function revealBar(page) {
  await page.locator("#v1").dispatchEvent("mousemove");
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test("scrubber reflects duration and seeks the video on drag/click", async ({ page }) => {
  await enterFill(page);
  await stubMedia(page, 120);

  const scrub = page.locator('[data-fd-role="scrub"]');
  await expect(scrub).not.toBeDisabled();
  expect(await scrub.getAttribute("max")).toBe("120");

  await scrub.fill("30"); // Playwright's fill() triggers an input event

  expect(await page.locator("#v1").evaluate((el) => el.currentTime)).toBe(30);
});

test("scrubber tracks currentTime via timeupdate while not being dragged", async ({ page }) => {
  await enterFill(page);
  await stubMedia(page, 100);

  await page.locator("#v1").evaluate((el) => {
    el.currentTime = 42;
  });

  await expect(page.locator('[data-fd-role="scrub"]')).toHaveValue("42");
});

test("Set point A / Set point B are disabled until duration is known", async ({ page }) => {
  await enterFill(page);

  await expect(page.locator('[data-fd-role="marker-a"]')).toBeDisabled();
  await expect(page.locator('[data-fd-role="marker-b"]')).toBeDisabled();

  await stubMedia(page, 60);

  await expect(page.locator('[data-fd-role="marker-a"]')).toBeEnabled();
  await expect(page.locator('[data-fd-role="marker-b"]')).toBeEnabled();
});

test("A-B loop enables only once both markers are set with A < B, and clear resets it", async ({
  page,
}) => {
  await enterFill(page);
  await stubMedia(page, 60);
  await revealBar(page);
  const video = page.locator("#v1");
  const markerA = page.locator('[data-fd-role="marker-a"]');
  const markerB = page.locator('[data-fd-role="marker-b"]');
  const abLoop = page.locator('[data-fd-role="ab-loop"]');
  const clearLoop = page.locator('[data-fd-role="clear-loop"]');
  const markerAIndicator = page.locator('[data-fd-role="marker-a-indicator"]');
  const markerBIndicator = page.locator('[data-fd-role="marker-b-indicator"]');

  await expect(abLoop).toBeDisabled();
  await expect(clearLoop).toBeDisabled();
  await expect(markerAIndicator).toBeHidden();
  await expect(markerBIndicator).toBeHidden();

  await video.evaluate((el) => (el.currentTime = 10));
  await markerA.click();
  await expect(abLoop).toBeDisabled(); // only A set
  await expect(markerAIndicator).toBeVisible();
  expect(
    parseFloat(await markerAIndicator.evaluate((el) => el.style.left))
  ).toBeCloseTo((10 / 60) * 100, 1);

  await video.evaluate((el) => (el.currentTime = 20));
  await markerB.click();
  await expect(abLoop).toBeEnabled();
  await expect(clearLoop).toBeEnabled();
  await expect(markerBIndicator).toBeVisible();
  expect(
    parseFloat(await markerBIndicator.evaluate((el) => el.style.left))
  ).toBeCloseTo((20 / 60) * 100, 1);

  await clearLoop.click();
  await expect(abLoop).toBeDisabled();
  await expect(clearLoop).toBeDisabled();
  await expect(markerAIndicator).toBeHidden();
  await expect(markerBIndicator).toBeHidden();
});

test("A-B loop seeks back to A once playback passes B", async ({ page }) => {
  await enterFill(page);
  await stubMedia(page, 60);
  await revealBar(page);
  const video = page.locator("#v1");

  await video.evaluate((el) => (el.currentTime = 5));
  await page.locator('[data-fd-role="marker-a"]').click();
  await video.evaluate((el) => (el.currentTime = 15));
  await page.locator('[data-fd-role="marker-b"]').click();
  await page.locator('[data-fd-role="ab-loop"]').click();

  await video.evaluate((el) => (el.currentTime = 15));
  expect(await video.evaluate((el) => el.currentTime)).toBe(5);
});

test("standard repeat and A-B loop are mutually exclusive", async ({ page }) => {
  await enterFill(page);
  await stubMedia(page, 60);
  await revealBar(page);
  const video = page.locator("#v1");
  const repeat = page.locator('[data-fd-role="repeat"]');
  const abLoop = page.locator('[data-fd-role="ab-loop"]');

  await video.evaluate((el) => (el.currentTime = 5));
  await page.locator('[data-fd-role="marker-a"]').click();
  await video.evaluate((el) => (el.currentTime = 15));
  await page.locator('[data-fd-role="marker-b"]').click();

  await repeat.click();
  expect(await video.evaluate((el) => el.loop)).toBe(true);
  await expect(repeat).toHaveClass(/is-active/);

  await abLoop.click();
  expect(await video.evaluate((el) => el.loop)).toBe(false);
  await expect(repeat).not.toHaveClass(/is-active/);
  await expect(abLoop).toHaveClass(/is-active/);

  await repeat.click();
  expect(await video.evaluate((el) => el.loop)).toBe(true);
  await expect(abLoop).not.toHaveClass(/is-active/);
});

test("markers and loop mode reset when fill mode is exited and re-entered", async ({ page }) => {
  const fillBtn = page.locator('[data-fd-role="fill"]');
  await enterFill(page);
  await stubMedia(page, 60);
  await revealBar(page);
  const video = page.locator("#v1");

  await video.evaluate((el) => (el.currentTime = 5));
  await page.locator('[data-fd-role="marker-a"]').click();
  await video.evaluate((el) => (el.currentTime = 15));
  await page.locator('[data-fd-role="marker-b"]').click();
  await page.locator('[data-fd-role="repeat"]').click();

  await page.keyboard.press("Escape"); // exit — fillBtn is hidden while filled
  await video.hover();
  await fillBtn.click(); // re-enter same video
  await stubMedia(page, 60);

  expect(await video.evaluate((el) => el.loop)).toBe(false);
  await expect(page.locator('[data-fd-role="ab-loop"]')).toBeDisabled();
  await expect(page.locator('[data-fd-role="clear-loop"]')).toBeDisabled();
  await expect(page.locator('[data-fd-role="repeat"]')).not.toHaveClass(/is-active/);
});

test("control bar fades in on movement and fades out after idling", async ({ page }) => {
  await page.clock.install();
  await enterFill(page);

  const bar = page.locator(".fd-controls");
  await expect(bar).not.toHaveClass(/is-visible/);

  await page.locator("#v1").dispatchEvent("mousemove");
  await expect(bar).toHaveClass(/is-visible/);

  await page.clock.fastForward(2500);
  await expect(bar).not.toHaveClass(/is-visible/);
});

test("control bar stays visible through an active scrubber drag, even past the idle delay", async ({
  page,
}) => {
  await page.clock.install();
  await enterFill(page);
  await stubMedia(page, 60);

  const bar = page.locator(".fd-controls");
  const scrub = page.locator('[data-fd-role="scrub"]');

  await scrub.dispatchEvent("pointerdown");
  await expect(bar).toHaveClass(/is-visible/);

  await page.clock.fastForward(2500);
  await expect(bar).toHaveClass(/is-visible/); // still dragging, must not hide

  await scrub.dispatchEvent("pointerup");
  await page.clock.fastForward(2500);
  await expect(bar).not.toHaveClass(/is-visible/);
});

test("dragging the scrubber does not move the filled video's object-position (no drag.js interference)", async ({
  page,
}) => {
  await enterFill(page);
  await stubMedia(page, 60);
  const video = page.locator("#v1");
  const scrub = page.locator('[data-fd-role="scrub"]');

  await scrub.dispatchEvent("pointerdown", { clientX: 100 });
  await scrub.fill("30");
  await scrub.dispatchEvent("pointerup", { clientX: 100 });

  const objectPosition = await video.evaluate((el) => el.style.objectPosition);
  expect(objectPosition).toBe("");
});

test("speed select has the expected presets and starts at 1x", async ({ page }) => {
  await enterFill(page);

  const speed = page.locator('[data-fd-role="speed"]');
  const options = await speed.locator("option").evaluateAll((els) =>
    els.map((el) => ({ value: el.getAttribute("value"), label: el.textContent }))
  );
  expect(options).toEqual([
    { value: "0.25", label: "0.25x" },
    { value: "0.5", label: "0.5x" },
    { value: "1", label: "1x" },
    { value: "1.5", label: "1.5x" },
    { value: "2", label: "2x" },
  ]);
  await expect(speed).toHaveValue("1");
  expect(await page.locator("#v1").evaluate((el) => el.playbackRate)).toBe(1);
});

test("selecting a preset sets video.playbackRate", async ({ page }) => {
  await enterFill(page);
  await revealBar(page);

  await page.locator('[data-fd-role="speed"]').selectOption("1.5");

  expect(await page.locator("#v1").evaluate((el) => el.playbackRate)).toBe(1.5);
});

test("external ratechange syncs the speed select", async ({ page }) => {
  await enterFill(page);

  await page.locator("#v1").evaluate((el) => {
    el.playbackRate = 2;
    el.dispatchEvent(new Event("ratechange"));
  });

  await expect(page.locator('[data-fd-role="speed"]')).toHaveValue("2");
});

test("re-filling the same video resets playback speed to 1x", async ({ page }) => {
  const fillBtn = page.locator('[data-fd-role="fill"]');
  await enterFill(page);
  await revealBar(page);
  await page.locator('[data-fd-role="speed"]').selectOption("2");

  await page.keyboard.press("Escape"); // exit — fillBtn is hidden while filled
  await page.locator("#v1").hover();
  await fillBtn.click(); // re-enter same video

  await expect(page.locator('[data-fd-role="speed"]')).toHaveValue("1");
  expect(await page.locator("#v1").evaluate((el) => el.playbackRate)).toBe(1);
});

test("detaching controls removes the ratechange listener without error", async ({ page }) => {
  await enterFill(page);
  const video = page.locator("#v1");

  await page.keyboard.press("Escape"); // exit fill — tears down the bar

  await video.evaluate((el) => {
    el.playbackRate = 2;
    el.dispatchEvent(new Event("ratechange")); // must not throw once detached
  });

  await expect(page.locator('[data-fd-role="speed"]')).toHaveCount(0);
});
