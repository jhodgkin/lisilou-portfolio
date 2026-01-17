# Multi-stage build for lightweight production image
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files if they exist (for future npm dependencies)
COPY package*.json ./
RUN if [ -f package.json ]; then npm ci --only=production; fi

# Production image using nginx
FROM nginx:alpine

# Install envsubst for runtime config substitution
RUN apk add --no-cache gettext

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy static files
COPY src/ /usr/share/nginx/html/
COPY config/ /usr/share/nginx/html/config/
COPY public/ /usr/share/nginx/html/

# Create directories for runtime config
RUN mkdir -p /usr/share/nginx/html/config

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
