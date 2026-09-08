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

# sharp (used by reporting_spend_summary to rasterize chart SVGs to PNG)
# renders text via fontconfig/pango under the hood. A bare node:*-alpine
# image has neither installed, so every <text> element -- chart titles,
# axis labels, bucket captions -- comes out as unreadable placeholder
# ("tofu") glyphs while the bars/lines/axes themselves render fine
# (verified: zero registered fonts reproduces this exactly). fontconfig +
# a real font (DejaVu Sans covers the Latin script this server's labels
# use, including currency symbols) fixes it; fc-cache builds the font
# index that fontconfig/pango actually consult at render time.
RUN apk add --no-cache fontconfig ttf-dejavu && fc-cache -f

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
