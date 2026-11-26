FROM node:24-slim AS builder

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm install

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY skills ./skills

RUN npm run build --workspace=packages/shared && npm run build --workspace=apps/api

FROM node:24-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV MSGRAPH_HOME=/data
ENV SKILLS_DIR=/app/skills

RUN mkdir -p /data

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/skills ./skills

EXPOSE 8000 8484

CMD ["node", "apps/api/dist/index.js"]
