// @ts-check
// Fulfills every request matching `originPattern` (a Playwright glob URL
// pattern, e.g. "https://www.redgifs.com/**") by reading the matching file
// straight off disk at the repo-relative pathname — so a fixture served
// "from" a real embed-provider hostname can still reference
// "../../extension/reddit_fill.js" the same way file:// fixtures already
// do, without any real network access or DNS resolution. Used to give
// reddit_fill.js's tests a genuinely distinct origin for the embed iframe,
// so its event.origin check is exercised for real. See
// Specs/20260902124537-reddit-iframe-embed-fill/.
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const CONTENT_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
};

async function serveRepoAtOrigin(page, originPattern) {
  await page.route(originPattern, async (route) => {
    const url = new URL(route.request().url());
    const filePath = path.join(REPO_ROOT, url.pathname);
    try {
      const body = fs.readFileSync(filePath);
      const contentType = CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream";
      await route.fulfill({ status: 200, contentType, body });
    } catch (err) {
      await route.fulfill({ status: 404, body: "not found" });
    }
  });
}

module.exports = { serveRepoAtOrigin };
