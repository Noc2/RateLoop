# syntax=docker/dockerfile:1.7
# Pin the base image by digest so Ponder production builds do not silently change
# when the node:24-alpine tag moves. Keep this aligned with the keeper image.
FROM node:24-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f

WORKDIR /app

ENV HUSKY=0
ENV NODE_ENV=production

COPY .yarn/ ./.yarn/
COPY .yarnrc.yml package.json yarn.lock ./
COPY packages/agents/package.json ./packages/agents/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/foundry/package.json ./packages/foundry/package.json
COPY packages/keeper/package.json ./packages/keeper/package.json
COPY packages/nextjs/package.json ./packages/nextjs/package.json
COPY packages/node-utils/package.json ./packages/node-utils/package.json
COPY packages/ponder/package.json ./packages/ponder/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json

RUN --mount=type=cache,id=rateloop-ponder-yarn-cache,target=/app/.yarn/cache \
  YARN_ENABLE_IMMUTABLE_INSTALLS=true yarn workspaces focus @rateloop/ponder

COPY scripts/clean-package-dist.mjs ./scripts/clean-package-dist.mjs
COPY scripts/fix-esm-extensions.mjs ./scripts/fix-esm-extensions.mjs
COPY scripts/with-workspace-dist-lock.mjs ./scripts/with-workspace-dist-lock.mjs
COPY scripts/write-cjs-package-json.mjs ./scripts/write-cjs-package-json.mjs
COPY packages/contracts/tsconfig.json ./packages/contracts/tsconfig.json
COPY packages/contracts/tsconfig.cjs.json ./packages/contracts/tsconfig.cjs.json
COPY packages/contracts/src ./packages/contracts/src
COPY packages/node-utils/tsconfig.json ./packages/node-utils/tsconfig.json
COPY packages/node-utils/tsconfig.cjs.json ./packages/node-utils/tsconfig.cjs.json
COPY packages/node-utils/src ./packages/node-utils/src
COPY packages/ponder ./packages/ponder

WORKDIR /app/packages/ponder

RUN yarn build:workspace-deps

WORKDIR /app

RUN --mount=type=cache,id=rateloop-ponder-yarn-cache,target=/app/.yarn/cache \
  YARN_ENABLE_IMMUTABLE_INSTALLS=true yarn workspaces focus @rateloop/ponder --production

WORKDIR /app/packages/ponder

EXPOSE 42069

USER node
CMD ["yarn", "start:built-workspace-deps"]
