FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 8765

# The server defaults to stdio, but this image runs it as an always-on
# HTTP service instead — the way a client on a different host/container
# reaches it without a shared stdin/stdout pipe. See README.md, "Running
# as an HTTP service"; MCP_HTTP_HOST/PORT/MCP_AUTH_TOKEN in .env control
# the listener (host already defaults to 0.0.0.0 in config.ts).
ENV MCP_TRANSPORT=http

CMD ["node", "dist/index.js"]
