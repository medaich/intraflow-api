# Stage 1: Dependencies
FROM node:26-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:26-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build
RUN pnpm prune --prod

# Stage 3: Production Runtime
FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create storage directory and ensure correct permissions
RUN mkdir -p /app/storage && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (r) => { if (r.statusCode !== 200) process.exit(1); })"

CMD ["node", "dist/main.js"]
