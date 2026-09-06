// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { serveRepoAtOrigin } = require("./helpers/serveRepoAtOrigin");

// Reproduces the Reddit cross-origin embed regression: a <video> rendered
// inside a cross-origin iframe (RedGIFs primarily) is invisible to the
// generic content_scripts entry (all_frames defaults to false), and even
// with visibility, position:fixed inside that iframe can't reach the real
// tab viewport — so redditFill.js fills the <iframe> element itself
// instead, coordinated across the frame boundary via postMessage. See
// Specs/20260902124537-reddit-iframe-embed-fill/.
const FIXTURE = "file://" + path.join(__dirname, "..", "fixtures", "reddit-top.html");

test.beforeEach(async ({ page }) => {
  // The iframe's src is served "from" https://www.redgifs.com so
  // redditFill.js's real event.origin check is exercised, not bypassed by
  // file:// same-origin defaults.
  await serveRepoAtOrigin(page, "https://www.redgifs.com/**");
  await page.goto(FIXTURE);
});

function embedFrame(page) {
  return page.frameLocator("#embed");
}

async function stubEmbedMedia(page, duration) {
  await embedFrame(page).locator("#v1").evaluate((el, duration) => {
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

test("a video inside a cross-origin embed iframe gets a hover-revealed Fill button", async ({
  page,
}) => {
  const embed = embedFrame(page);
  const fillBtn = embed.locator('[data-fd-role="fill"]');

  await expect(fillBtn).toHaveAttribute("aria-label", "Fill video");
  await expect(fillBtn).toBeHidden();

  await embed.locator("#v1").hover();
  await expect(fillBtn).toBeVisible();

  await page.mouse.move(0, 0);
  await expect(fillBtn).toBeHidden();
});

test("Fill fills the <iframe> element itself, not the video inside it", async ({ page }) => {
  const iframeEl = page.locator("#embed");
  const embedVideo = embedFrame(page).locator("#v1");

  await embedVideo.hover();
  await embedFrame(page).locator('[data-fd-role="fill"]').click();

  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);
  await expect(embedVideo).not.toHaveClass(/fd-fill-active/);
  // The bar has its own Exit control once filled, so the floating icon
  // hides for the duration rather than flipping to an "exit" icon.
  await expect(embedFrame(page).locator('[data-fd-role="fill"]')).toBeHidden();

  const box = await iframeEl.boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeCloseTo(viewport.width, 0);
  expect(box.height).toBeCloseTo(viewport.height, 0);
});

test("Escape from within the embed iframe exits the fill", async ({ page }) => {
  const iframeEl = page.locator("#embed");

  await embedFrame(page).locator("#v1").hover();
  await embedFrame(page).locator('[data-fd-role="fill"]').click();
  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);

  await embedFrame(page).locator("body").press("Escape");

  await expect(iframeEl).not.toHaveClass(/fd-reddit-frame-fill/);
  // The pointer is still over the embedded video, so the button should
  // reappear.
  await expect(embedFrame(page).locator('[data-fd-role="fill"]')).toBeVisible();
});

test("Escape from the top frame exits an active embed-iframe fill", async ({ page }) => {
  const iframeEl = page.locator("#embed");

  await embedFrame(page).locator("#v1").hover();
  await embedFrame(page).locator('[data-fd-role="fill"]').click();
  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);

  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");

  await expect(iframeEl).not.toHaveClass(/fd-reddit-frame-fill/);
  // The top frame's Escape path notifies the iframe so its own fill icon
  // resets too (FR9) — not just the iframe element's class. The pointer
  // moved to the top frame, off the embedded video, so the button follows
  // that hover state and stays hidden rather than becoming visible.
  await expect(embedFrame(page).locator('[data-fd-role="fill"]')).toBeHidden();
});

test("filling the embed iframe neutralizes its own clipping ancestor and restores it on exit", async ({
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

test("removing the embedded video while filled exits the top-frame iframe fill", async ({
  page,
}) => {
  const iframeEl = page.locator("#embed");

  await embedFrame(page).locator("#v1").hover();
  await embedFrame(page).locator('[data-fd-role="fill"]').click();
  await expect(iframeEl).toHaveClass(/fd-reddit-frame-fill/);

  await embedFrame(page).locator("#v1").evaluate((video) => video.remove());

  await expect(iframeEl).not.toHaveClass(/fd-reddit-frame-fill/);
});

test("filling the embed iframe attaches the shared control bar (play/pause) to the local video", async ({
  page,
}) => {
  const embed = embedFrame(page);
  const video = embed.locator("#v1");
  const playPauseBtn = embed.locator('[data-fd-role="play-pause"]');

  // No decodable source in the fixture — stub paused/play/pause the same
  // way fill-basic.spec.js does for the generic path.
  await video.evaluate((el) => {
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

  await expect(playPauseBtn).toBeHidden();

  await video.hover();
  await embed.locator('[data-fd-role="fill"]').click();

  await expect(playPauseBtn).toBeVisible();
  await expect(playPauseBtn).toHaveAttribute("aria-label", "Play");

  // The bar is hidden (pointer-events: none) until the pointer moves over
  // it, per the control-bar spec's FR9.
  await video.dispatchEvent("mousemove");
  await playPauseBtn.click();
  await expect(playPauseBtn).toHaveAttribute("aria-label", "Pause");

  // The bar's own Exit control round-trips through this frame's
  // requestExit -> postMessage("exit"), not FD.toggleFill (unavailable in
  // this frame) — confirms controls.onExit was wired correctly.
  const exitBtn = embed.locator('[data-fd-role="exit"]');
  await exitBtn.click();

  await expect(page.locator("#embed")).not.toHaveClass(/fd-reddit-frame-fill/);
  // The pointer ended up over the (now-detached) Exit control, off both
  // the video and the fill icon, so the fill icon follows that hover
  // state and stays hidden.
  await expect(embed.locator('[data-fd-role="fill"]')).toBeHidden();
  await expect(playPauseBtn).toBeHidden();
});

test("embed iframe shared controls include skip buttons and saturation rail", async ({
  page,
}) => {
  const embed = embedFrame(page);
  const video = embed.locator("#v1");

  await video.hover();
  await embed.locator('[data-fd-role="fill"]').click();
  await stubEmbedMedia(page, 90);
  await video.dispatchEvent("mousemove");

  await video.evaluate((el) => (el.currentTime = 20));
  await embed.locator('[data-fd-role="skip-forward"]').click();
  expect(await video.evaluate((el) => el.currentTime)).toBe(30);

  await embed.locator('[data-fd-role="saturation"]').evaluate((el) => {
    el.value = "150";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(embed.locator('[data-fd-role="saturation-value"]')).toHaveText("150%");
  expect(await video.evaluate((el) => el.style.filter)).toBe("saturate(150%)");
});
