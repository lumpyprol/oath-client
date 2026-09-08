FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# No native modules: SQLite is built into Node, so no build toolchain here.
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Mounted volume, so the db survives deploys
ENV DB_PATH=/data/games.db
# node:sqlite is behind a flag on Node 22
ENV NODE_OPTIONS=--experimental-sqlite
EXPOSE 8080
CMD ["node", "dist/index.js"]
