# Pin a Playwright image so chromium + system deps are present and reproducible.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /burnmap
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages

RUN npm ci
RUN npm run build --workspaces --if-present

ENTRYPOINT ["node", "/burnmap/packages/action/dist/main.js"]
