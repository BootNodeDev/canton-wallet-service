FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
# Manifest + lockfile first, so the install layer caches independently of source changes.
# pnpm-workspace.yaml carries the overrides the lockfile records; without it
# --frozen-lockfile fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts skips the `prepare` build; src is not in the image yet and the
# RUN below is the same tsc invocation.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json ./
COPY src src
RUN pnpm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=build /app/dist dist
EXPOSE 3010
CMD ["node", "dist/server.js"]
