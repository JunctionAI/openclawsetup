# Clawdbot Runtime Dockerfile
# Each customer gets their own instance running this image

FROM node:20-alpine

# Install dependencies
RUN apk add --no-cache \
    git \
    curl \
    bash

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy runtime code
COPY runtime/ ./

# Create workspace directory
RUN mkdir -p /workspace

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["node", "clawdbot-server.js"]
