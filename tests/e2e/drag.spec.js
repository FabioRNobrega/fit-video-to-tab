// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");

// Regression tests for horizontal drag-to-reposition (extension/drag.js).
// The fixture video has no decodable source, so videoWidth/videoHeight are
// stubbed via Object.defineProperty (same pattern fill-basic.spec.js
// already uses to stub paused/play/pause) to make the cover-scale/overflow
// math in drag.js deterministic and assertable. Pointer events are
// dispatched directly against the video element so the tests control
// pointerId/isPrimary/pointerType/clientX precisely, covering both mouse
// and touch input the same way the drag spec's Plan.md describes.
//
// Intrinsic video dimensions are always derived from the *actual* rendered
// viewport rect (read after Fill is clicked), not a hardcoded pixel size,
// so these tests don't depend on which viewport Playwright's config
// resolves to.
const FIXTURE = "file://" + path.join(__dirname, "..", "fixtures", "drag.html");

async function enterFillAndGetRect(page) {
  await page.locator("#v1").hover();
  await page.locator('[data-fd-role="fill"]').click();
  return page.locator("#v1").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
}

async function stubIntrinsicSize(page, videoWidth, videoHeight) {
  await page.locator("#v1").evaluate(
    (el, { videoWidth, videoHeight }) => {
      Object.defineProperty(el, "videoWidth", { value: videoWidth, configurable: true });
      Object.defineProperty(el, "videoHeight", { value: videoHeight, configurable: true });
    },
    { videoWidth, videoHeight }
  );
}

async function dispatchPointer(page, type, opts) {
  await page.locator("#v1").evaluate(
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

async function objectPositionX(page) {
  const value = await page.locator("#v1").evaluate((el) => el.style.objectPosition);
  if (!value) return null;
  return parseFloat(value);
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test("dragging past threshold moves object-position by the exact expected percentage", async ({
  page,
}) => {
  const rect = await enterFillAndGetRect(page);
  // Matched height, double width: scale = max(w/(2w), h/h) = 1;
  // overflowX = (2w)*1 - w = w (the viewport's own width).
  await stubIntrinsicSize(page, rect.width * 2, rect.height);
  const overflowX = rect.width;

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 400 }); // deltaX = -100

  const positionX = await objectPositionX(page);
  const expected = 50 - (-100 / overflowX) * 100;
  expect(positionX).not.toBeNull();
  expect(positionX).toBeCloseTo(expected, 1);

  const style = await page.locator("#v1").evaluate((el) => el.style.objectPosition);
  expect(style.endsWith("% 50%")).toBe(true);
});

test("no movement when there is no horizontal overflow (never letterboxes)", async ({ page }) => {
  const rect = await enterFillAndGetRect(page);
  // Exact viewport aspect: scale = 1, overflowX = 0.
  await stubIntrinsicSize(page, rect.width, rect.height);

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 300 }); // deltaX = -200

  const positionX = await objectPositionX(page);
  expect(positionX).toBeCloseTo(50, 1);
});

test("dragging far past either edge clamps at 0 and 100, never beyond", async ({ page }) => {
  const rect = await enterFillAndGetRect(page);
  await stubIntrinsicSize(page, rect.width * 2, rect.height); // overflowX = rect.width
  const farDelta = rect.width * 20 + 5000;

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 500 - farDelta });
  expect(await objectPositionX(page)).toBe(100);
  await dispatchPointer(page, "pointerup", { pointerId: 1, clientX: 500 - farDelta });

  await page.keyboard.press("Escape"); // exit, resets to center — fillBtn is hidden while filled
  const rect2 = await enterFillAndGetRect(page); // re-enter
  await stubIntrinsicSize(page, rect2.width * 2, rect2.height);
  const farDelta2 = rect2.width * 20 + 5000;

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 500 + farDelta2 });
  expect(await objectPositionX(page)).toBe(0);
});

test("sub-threshold movement leaves object-position unset", async ({ page }) => {
  const rect = await enterFillAndGetRect(page);
  await stubIntrinsicSize(page, rect.width * 2, rect.height);

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 503 }); // deltaX = 3, under 6px

  expect(await objectPositionX(page)).toBeNull();
});

test("pointerup ends the session: a later pointermove with the same pointer id has no effect", async ({
  page,
}) => {
  const rect = await enterFillAndGetRect(page);
  await stubIntrinsicSize(page, rect.width * 2, rect.height);

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 400 });
  const positionAfterMove = await objectPositionX(page);

  await dispatchPointer(page, "pointerup", { pointerId: 1, clientX: 400 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 100 });

  expect(await objectPositionX(page)).toBeCloseTo(positionAfterMove ?? -1, 5);
});

test("exiting fill mode resets the crop to center; re-entering starts centered again", async ({
  page,
}) => {
  const rect = await enterFillAndGetRect(page);
  await stubIntrinsicSize(page, rect.width * 2, rect.height);
  const fillBtn = page.locator('[data-fd-role="fill"]');

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 400 });
  expect(await objectPositionX(page)).not.toBeNull();

  await page.keyboard.press("Escape");
  expect(await objectPositionX(page)).toBeNull();

  // The synthetic drag pointermove dispatched above (clientY: 100, a fixed
  // stand-in coordinate, not the video's real position) bubbles to the
  // extension's own window-level hover tracking same as a real pointermove
  // would — hover the video for real before re-entering so the button is
  // actually visible to click, matching genuine pointer input.
  await page.locator("#v1").hover();
  await fillBtn.click(); // re-enter
  expect(await objectPositionX(page)).toBeNull();
});

test("pointer events before Fill is clicked have no effect", async ({ page }) => {
  await stubIntrinsicSize(page, 2000, 768);

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 100 });

  expect(await objectPositionX(page)).toBeNull();
});

test("a second, non-primary pointer does not start or interfere with a drag", async ({ page }) => {
  const rect = await enterFillAndGetRect(page);
  await stubIntrinsicSize(page, rect.width * 2, rect.height);

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 400 });
  const positionDuringDrag = await objectPositionX(page);

  await dispatchPointer(page, "pointerdown", { pointerId: 2, clientX: 200, isPrimary: false });
  await dispatchPointer(page, "pointermove", { pointerId: 2, clientX: 900, isPrimary: false });

  expect(await objectPositionX(page)).toBeCloseTo(positionDuringDrag ?? -1, 5);

  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 300 });
  expect(await objectPositionX(page)).not.toBeCloseTo(positionDuringDrag ?? -1, 5);
});

test("touch pointer input repositions the crop the same way mouse input does", async ({
  page,
}) => {
  const rect = await enterFillAndGetRect(page);
  await stubIntrinsicSize(page, rect.width * 2, rect.height);
  const overflowX = rect.width;

  await dispatchPointer(page, "pointerdown", {
    pointerId: 1,
    clientX: 500,
    pointerType: "touch",
  });
  await dispatchPointer(page, "pointermove", {
    pointerId: 1,
    clientX: 400,
    pointerType: "touch",
  });

  const positionX = await objectPositionX(page);
  const expected = 50 - (-100 / overflowX) * 100;
  expect(positionX).toBeCloseTo(expected, 1);
});

test("cursor is grab while filled and idle, grabbing during an active drag", async ({ page }) => {
  const rect = await enterFillAndGetRect(page);
  await stubIntrinsicSize(page, rect.width * 2, rect.height);

  expect(await page.locator("#v1").evaluate((el) => getComputedStyle(el).cursor)).toBe("grab");

  await dispatchPointer(page, "pointerdown", { pointerId: 1, clientX: 500 });
  await dispatchPointer(page, "pointermove", { pointerId: 1, clientX: 400 });
  expect(await page.locator("#v1").evaluate((el) => getComputedStyle(el).cursor)).toBe(
    "grabbing"
  );

  await dispatchPointer(page, "pointerup", { pointerId: 1, clientX: 400 });
  expect(await page.locator("#v1").evaluate((el) => getComputedStyle(el).cursor)).toBe("grab");
});
