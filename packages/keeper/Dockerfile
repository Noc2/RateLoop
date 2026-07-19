# syntax=docker/dockerfile:1.7
# INFO-3 (2026-05-21 repo audit): pin the base image by digest so builds are reproducible and
# a future image push under the `24-alpine` tag cannot silently alter what we ship. Digest is
# the multi-arch manifest as of 2026-06-24. Bump alongside the digest in
# Renovate / Dependabot config.
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

RUN YARN_ENABLE_IMMUTABLE_INSTALLS=true yarn workspaces focus @rateloop/keeper

COPY scripts/clean-package-dist.mjs ./scripts/clean-package-dist.mjs
COPY scripts/fix-esm-extensions.mjs ./scripts/fix-esm-extensions.mjs
COPY scripts/with-workspace-dist-lock.mjs ./scripts/with-workspace-dist-lock.mjs
COPY scripts/write-cjs-package-json.mjs ./scripts/write-cjs-package-json.mjs
COPY packages/keeper/tsconfig.json ./packages/keeper/tsconfig.json
COPY packages/keeper/src ./packages/keeper/src
COPY packages/node-utils/tsconfig.json ./packages/node-utils/tsconfig.json
COPY packages/node-utils/tsconfig.cjs.json ./packages/node-utils/tsconfig.cjs.json
COPY packages/node-utils/src ./packages/node-utils/src

WORKDIR /app/packages/keeper

RUN yarn build:workspace-deps && yarn build

WORKDIR /app

RUN YARN_ENABLE_IMMUTABLE_INSTALLS=true yarn workspaces focus @rateloop/keeper --production

# The runtime starts through Yarn and does not need npm or npx. Remove npm's bundled
# dependency tree so build-only tooling cannot add vulnerabilities to the shipped image.
RUN rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app/packages/keeper

EXPOSE 9090

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "const http=require('node:http');const port=process.env.METRICS_PORT||process.env.PORT||'9090';const req=http.get({host:'127.0.0.1',port,path:'/ready'},res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(4000,()=>req.destroy());"

CMD ["yarn", "start:built-dist"]
