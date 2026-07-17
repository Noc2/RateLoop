# syntax=docker/dockerfile:1.7
# Pin the base image by digest so Ponder production builds do not silently change
# when the node:24-alpine tag moves. Keep this aligned with the keeper image.
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

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

RUN YARN_ENABLE_IMMUTABLE_INSTALLS=true yarn workspaces focus @rateloop/ponder

COPY packages/ponder ./packages/ponder

WORKDIR /app

RUN YARN_ENABLE_IMMUTABLE_INSTALLS=true yarn workspaces focus @rateloop/ponder --production

RUN chown -R node:node /app/packages/ponder

WORKDIR /app/packages/ponder

EXPOSE 42069

USER node
CMD ["yarn", "start"]
