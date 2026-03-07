# ─── Stage 1: Install dependencies ───
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ─── Stage 2: Production image ───
FROM node:20-alpine
LABEL maintainer="kshitijpatil"
LABEL description="The Task Manager — a sleek daily productivity dashboard"

WORKDIR /app

# Copy only production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY server.js ./
COPY public ./public

# Default environment variables
ENV NODE_ENV=production \
    PORT=3000

# Run as non-root user
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
