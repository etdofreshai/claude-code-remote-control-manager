FROM node:20-alpine AS builder
WORKDIR /app
ARG BUILD_SHA=
ARG BUILD_DATETIME=
RUN apk add --no-cache git
COPY server/package*.json ./
RUN npm install
COPY server/tsconfig.json ./
COPY server/src ./src
# .git is included so we can read the commit sha at build time. It is NOT
# copied into the runtime stage below, so the final image never ships .git.
COPY .git ./.git
RUN npm run build \
    && sha="${BUILD_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}" \
    && dt="${BUILD_DATETIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" \
    && printf '{"sha":"%s","datetime":"%s"}\n' "$sha" "$dt" > dist/version.json \
    && cat dist/version.json

FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY server/public ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]
