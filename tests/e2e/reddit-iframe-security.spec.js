// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");
const { serveRepoAtOrigin } = require("./helpers/serveRepoAtOrigin");

// A postMessage claiming to be a Fill request must be ignored unless it
// comes from an origin reddit_fill.js actually trusts (FR5) — otherwise any
// unrelated frame on a Reddit page could resize/reposition one of the top
// frame's own <iframe> elements. See
// Specs/20260902124537-reddit-iframe-embed-fill/.
const FIXTURE =
  "file://" + path.join(__dirname, "..", "fixtures", "reddit-top-untrusted-embed.html");

test.beforeEach(async ({ page }) => {
  // Same fixture content as the trusted-origin tests, but served from an
  // origin NOT in reddit_fill.js's embed allowlist.
  await serveRepoAtOrigin(page, "https://embed.example.com/**");
  await page.goto(FIXTURE);
});

test("a Fill request from an unlisted origin is ignored", async ({ page }) => {
  const iframeEl = page.locator("#embed");
  const embedFrame = page.frameLocator("#embed");

  await expect(embedFrame.locator('[data-fd-role="fill"]')).toHaveText("Fill");
  await embedFrame.locator('[data-fd-role="fill"]').click();

  // The iframe optimistically flips its own row to "Exit", but the top
  // frame must never apply the fill class since the message's origin
  // doesn't match the allowlist.
  await expect(iframeEl).not.toHaveClass(/fd-reddit-frame-fill/);
});
