# Pin a Playwright image so chromium + system deps are present and reproducible.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /burnmap

# Fonts for caption rendering (broad Unicode coverage; don't rely on host fonts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-core fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages

RUN npm ci
# Build in dependency order: parser -> web -> shoot -> graph -> action.
# `npm run build --workspaces` runs packages/* alphabetically (action first),
# so action's tsc fails to resolve @burnmap/{parser,shoot,graph} before they
# are built. Explicit order fixes the clean (Docker) build.
RUN npm run build -w @burnmap/parser -w @burnmap/web -w @burnmap/shoot -w @burnmap/graph -w @burnmap/action

ENTRYPOINT ["node", "/burnmap/packages/action/dist/main.js"]
