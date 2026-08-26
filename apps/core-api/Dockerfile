# Recall Tracker — Core API (public /api/* surface).
#
# Build from the REPO ROOT:
#   docker build -f apps/core-api/Dockerfile -t recall-core-api .
#
# Unlike the worker and AI service this is a Next.js app, so it needs a real
# build stage. It stays on Next rather than becoming a plain Node service
# because /api/auth/[...nextauth] is a NextAuth route handler.

# ---------- build ----------
FROM node:24-alpine AS builder

WORKDIR /app

# Manifests first so the dependency layer caches independently of source.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/shared/package.json ./packages/shared/
COPY --chown=node:node apps/core-api/package.json ./apps/core-api/

# Dev dependencies are required here: next build needs typescript and the Next
# toolchain even though typescript.ignoreBuildErrors skips validation.
RUN npm ci --workspace @recall/core-api --include-workspace-root

COPY --chown=node:node packages/shared ./packages/shared
COPY --chown=node:node apps/core-api ./apps/core-api

# transpilePackages compiles @recall/shared from TypeScript source at build time,
# which is why shared ships as source rather than as a compiled artifact.
RUN npm run build --workspace @recall/core-api

# ---------- runtime ----------
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Reinstall production-only so the runtime image excludes the build toolchain.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/shared/package.json ./packages/shared/
COPY --chown=node:node apps/core-api/package.json ./apps/core-api/
RUN npm ci --workspace @recall/core-api --include-workspace-root --omit=dev

# next.config.mjs is required at runtime by next start. packages/shared comes
# across because serverExternalPackages/transpilePackages resolve it at runtime
# for server code.
COPY --chown=node:node --from=builder /app/apps/core-api/.next ./apps/core-api/.next
COPY --chown=node:node --from=builder /app/apps/core-api/next.config.mjs ./apps/core-api/
COPY --chown=node:node --from=builder /app/packages/shared ./packages/shared

USER node

ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/fm-config').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "--workspace", "@recall/core-api"]
