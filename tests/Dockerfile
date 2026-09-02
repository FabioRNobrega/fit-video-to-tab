# Runs the extension's Playwright regression suite entirely inside the
# container — nothing (Node, npm packages, browsers) is installed on the
# host. The Playwright base image ships Chromium/Firefox/WebKit already
# matching @playwright/test's pinned version below, so no browser download
# happens at build or run time either.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

# Install dependencies first so editing extension/*.js or tests/*.spec.js
# doesn't invalidate this layer and force a re-download on every run.
COPY tests/package.json ./tests/package.json
RUN npm --prefix tests install

COPY extension ./extension
COPY tests ./tests

WORKDIR /app/tests
CMD ["npx", "playwright", "test"]
