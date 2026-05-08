FROM node:20-alpine AS builder
WORKDIR /app
COPY bridge/package*.json ./
RUN npm install
COPY bridge/tsconfig.json ./
COPY bridge/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY bridge/package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 4100
CMD ["node", "dist/index.js"]
