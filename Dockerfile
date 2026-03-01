# ─── Stage 1: Install dependencies ───
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
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

# Create a directory for persistent data
RUN mkdir -p /data && chown node:node /data

# Default environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    JWT_SECRET=tm_default_jwt_s3cret_k3y_2026 \
    DATA_DIR=/data

# Data volume — mount this to persist tasks across container restarts
VOLUME /data

# Run as non-root user
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
