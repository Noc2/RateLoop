# INFO-3 (2026-05-21 repo audit): pin the base image by digest so builds are reproducible and
# a future image push under the `24-alpine` tag cannot silently alter what we ship. Digest is
# the multi-arch (amd64/arm64) manifest as of 2026-04-16. Bump alongside the digest in
# Renovate / Dependabot config.
FROM node:24-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f

WORKDIR /app

ENV HUSKY=0

COPY .yarn/ ./.yarn/
COPY .yarnrc.yml package.json yarn.lock ./
COPY packages/agents/package.json ./packages/agents/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/contracts/tsconfig.json ./packages/contracts/tsconfig.json
COPY packages/foundry/package.json ./packages/foundry/package.json
COPY packages/contracts/src ./packages/contracts/src
COPY packages/keeper/package.json ./packages/keeper/package.json
COPY packages/keeper/tsconfig.json ./packages/keeper/tsconfig.json
COPY packages/keeper/src ./packages/keeper/src
COPY packages/nextjs/package.json ./packages/nextjs/package.json
COPY packages/node-utils/package.json ./packages/node-utils/package.json
COPY packages/node-utils/tsconfig.json ./packages/node-utils/tsconfig.json
COPY packages/node-utils/src ./packages/node-utils/src
COPY packages/ponder/package.json ./packages/ponder/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json

RUN yarn install --immutable --mode=skip-build

WORKDIR /app/packages/keeper

EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "const http=require('node:http');const port=process.env.METRICS_PORT||process.env.PORT||'9090';const headers={};if(process.env.METRICS_AUTH_TOKEN)headers.Authorization='Bearer '+process.env.METRICS_AUTH_TOKEN;const req=http.get({host:'127.0.0.1',port,path:'/health',headers},res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(4000,()=>req.destroy());"

USER node
CMD ["yarn", "start"]
