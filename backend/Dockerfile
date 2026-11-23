# Build from the repository root (npm workspaces share one lockfile):
#   docker build -f backend/Dockerfile .
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w @hireflow/backend && mkdir -p backend/node_modules

FROM deps AS build
COPY backend/tsconfig.json backend/drizzle.config.ts backend/
COPY backend/src backend/src
RUN npm run build -w @hireflow/backend

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev -w @hireflow/backend && mkdir -p backend/node_modules

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json backend/openapi.yaml ./backend/
COPY backend/drizzle ./backend/drizzle
COPY samples/jobs.json samples/applications.json ./samples/
COPY samples/resumes ./samples/resumes
RUN mkdir -p /app/backend/uploads && chown node:node /app/backend/uploads
USER node
WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s CMD wget -qO- http://localhost:4000/health || exit 1
ENV SAMPLES_DIR=/app/samples
# Migrations and the bootstrap admin (ADMIN_EMAIL) run on start. On first start, SEED_DEMO_DATA=true creates the demo data
# (skipped once the database has users) and LOAD_SAMPLE_DATA=true loads samples/ (skipped once loaded).
CMD ["sh", "-c", "if [ \"$SEED_DEMO_DATA\" = \"true\" ]; then node dist/db/seed.js; fi && if [ \"$LOAD_SAMPLE_DATA\" = \"true\" ]; then node dist/db/samples.js || echo \"Warning: sample data not loaded; starting anyway\"; fi && exec node dist/index.js"]
