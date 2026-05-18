# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    CCRC_PERMISSION_MODE=bypassPermissions
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /home/node/.claude /workspace && chown -R node:node /home/node/.claude /workspace /app
USER node
VOLUME ["/home/node/.claude", "/workspace"]
CMD ["node", "dist/index.js"]
