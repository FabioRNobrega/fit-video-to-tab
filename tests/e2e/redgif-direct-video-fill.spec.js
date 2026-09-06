// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { serveRepoAtOrigin } = require("./helpers/serveRepoAtOrigin");

const FIXTURE = "file://" + path.join(__dirname, "..", "fixtures", "reddit-top.html");

test.beforeEach(async ({ page }) => {
  await serveRepoAtOrigin(page, "https://www.redgifs.com/**");
  await page.goto(FIXTURE);
});

function embedFrame(page) {
  return page.frameLocator("#embed");
}

async function enterRedGifFill(page) {
  const embed = embedFrame(page);
  await embed.locator("#v1").hover();
  await embed.locator('[data-fd-role="fill"]').click();
  await expect(page.locator("#embed")).toHaveClass(/fd-reddit-frame-fill/);
  await expect(embed.locator("#v1")).toHaveClass(/fd-redgif-video-fill/);
}

async function stubIntrinsicSize(page, videoWidth, videoHeight) {
  await embedFrame(page).locator("#v1").evaluate(
    (el, { videoWidth, videoHeight }) => {
      Object.defineProperty(el, "videoWidth", { value: videoWidth, configurable: true });
      Object.defineProperty(el, "videoHeight", { value: videoHeight, configurable: true });
    },
    { videoWidth, videoHeight }
  );
}

async function dispatchPointer(page, type, opts) {
  await embedFrame(page).locator("#v1").evaluate(
    (el, { type, opts }) => {
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientY: 100,
          pointerType: "mouse",
          isPrimary: true,
          ...opts,
        })
      );
    },
    { type, opts }
  );
}

test("RedGIF fill expands the iframe and fills the real video to the viewport", async ({
  page,
}) => {
  const embed = embedFrame(page);

  await enterRedGifFill(page);

  const iframeBox = await page.locator("#embed").boundingBox();
  const videoBox = await embed.locator("#v1").boundingBox();
  const viewport = page.viewportSize();
  expect(iframeBox.width).toBeCloseTo(viewport.width, 0);
  expect(iframeBox.height).toBeCloseTo(viewport.height, 0);
  expect(videoBox.width).toBeCloseTo(viewport.width, 0);
  expect(videoBox.height).toBeCloseTo(viewport.height, 0);

  await expect(embed.locator("#v1")).toHaveCSS("object-fit", "cover");
});

test("RedGIF provider chrome is hidden while filled and restored on exit", async ({ page }) => {
  const embed = embedFrame(page);
  const providerChrome = embed.locator(
    ".Player-Poster, .Player-OverLayer, .RedGifsUser, .RedGifsControls"
  );

  await expect(providerChrome).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await expect(providerChrome.nth(index)).toBeVisible();
  }

  await enterRedGifFill(page);
  for (let index = 0; index < 4; index += 1) {
    await expect(providerChrome.nth(index)).toBeHidden();
  }

  await embed.locator("#v1").dispatchEvent("mousemove");
  await embed.locator('[data-fd-role="exit"]').click();
  await expect(page.locator("#embed")).not.toHaveClass(/fd-reddit-frame-fill/);
  await expect(embed.locator("#v1")).not.toHaveClass(/fd-redgif-video-fill/);
  for (let index = 0; index < 4; index += 1) {
    await expect(providerChrome.nth(index)).toBeVisible();
  }
});

test("RedGIF wrapping video link is disabled while filled and restored on exit", async ({
  page,
}) => {
  const embed = embedFrame(page);
  const videoLink = embed.locator(".videoLink");

  await expect(videoLink).toHaveAttribute(
    "href",
    "/watch/frizzydarkgrayivorybilledwoodpecker"
  );
  await expect(videoLink).toHaveAttribute("target", "_blank");

  await enterRedGifFill(page);
  await expect(videoLink).not.toHaveAttribute("href", /.*/);
  await expect(videoLink).not.toHaveAttribute("target", /.*/);

  await embed.locator("body").press("Escape");
  await expect(videoLink).toHaveAttribute(
    "href",
    "/watch/frizzydarkgrayivorybilledwoodpecker"
  );
  await expect(videoLink).toHaveAttribute("target", "_blank");
});

test("shared controls and saturation effect are active on the RedGIF video", async ({ page }) => {
  const embed = embedFrame(page);
  const roles = [
    "play-pause",
    "mute",
    "speed",
    "skip-back",
    "skip-forward",
    "scrub",
    "marker-a",
    "marker-b",
    "ab-loop",
    "clear-loop",
    "repeat",
    "saturation-rail",
    "saturation",
    "saturation-value",
    "exit",
  ];

  await enterRedGifFill(page);
  await embed.locator("#v1").dispatchEvent("mousemove");

  for (const role of roles) {
    await expect(embed.locator(`[data-fd-role="${role}"]`)).toHaveCount(1);
  }

  await embed.locator('[data-fd-role="saturation"]').evaluate((el) => {
    el.value = "175";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(embed.locator('[data-fd-role="saturation-value"]')).toHaveText("175%");
  expect(await embed.locator("#v1").evaluate((el) => el.style.filter)).toBe("saturate(175%)");
});

test("dragging the filled RedGIF video repositions the horizontal crop", async ({ page }) => {
  const embed = embedFrame(page);

  await enterRedGifFill(page);
  const rect = await embed.locator("#v1").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  await stubIntrinsicSize(page, rect.width * 2, rect.height);

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 400 });

  const objectPosition = await embed.locator("#v1").evaluate((el) => el.style.objectPosition);
  expect(parseFloat(objectPosition)).toBeGreaterThan(50);
  expect(objectPosition.endsWith("% 50%")).toBe(true);
});

test("dragging on a RedGIF overlay still repositions the video crop", async ({ page }) => {
  const embed = embedFrame(page);

  await enterRedGifFill(page);
  const rect = await embed.locator("#v1").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  await stubIntrinsicSize(page, rect.width * 2, rect.height);

  await embed.locator(".Player").evaluate((player) => {
    const overlay = document.createElement("div");
    overlay.className = "LateRedGifOverlay";
    overlay.style.cssText =
      "position: fixed; inset: 0; z-index: 2147483647; pointer-events: auto;";
    player.appendChild(overlay);
  });

  await embed.locator(".LateRedGifOverlay").evaluate((overlay) => {
    overlay.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 500,
        clientY: 100,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      })
    );
    overlay.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 100,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      })
    );
  });

  const objectPosition = await embed.locator("#v1").evaluate((el) => el.style.objectPosition);
  expect(parseFloat(objectPosition)).toBeGreaterThan(50);
  expect(objectPosition.endsWith("% 50%")).toBe(true);
});

test("Escape from either frame exits both RedGIF video fill and Reddit iframe fill", async ({
  page,
}) => {
  const embed = embedFrame(page);

  await enterRedGifFill(page);
  await embed.locator("body").press("Escape");
  await expect(page.locator("#embed")).not.toHaveClass(/fd-reddit-frame-fill/);
  await expect(embed.locator("#v1")).not.toHaveClass(/fd-redgif-video-fill/);

  await enterRedGifFill(page);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await expect(page.locator("#embed")).not.toHaveClass(/fd-reddit-frame-fill/);
  await expect(embed.locator("#v1")).not.toHaveClass(/fd-redgif-video-fill/);
});

test("removing the RedGIF video while filled restores the iframe and provider state", async ({
  page,
}) => {
  const embed = embedFrame(page);

  await enterRedGifFill(page);
  await embed.locator("#v1").evaluate((video) => video.remove());

  await expect(page.locator("#embed")).not.toHaveClass(/fd-reddit-frame-fill/);
  await expect(embed.locator(".RedGifsControls")).toBeVisible();
});
