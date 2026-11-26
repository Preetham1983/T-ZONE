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
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    pulseaudio \
    pulseaudio-utils \
    espeak-ng \
    ca-certificates \
    && ARCH=$(dpkg --print-architecture) \
    && PIPER_ARCH=$([ "$ARCH" = "arm64" ] && echo "aarch64" || echo "x86_64") \
    && mkdir -p /data /ms-playwright /opt/voices \
    && curl -fsSL "https://github.com/rhasspy/piper/releases/latest/download/piper_linux_${PIPER_ARCH}.tar.gz" | tar -xz -C /opt \
    && curl -fsSL -o /opt/voices/en_US-lessac-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx \
    && curl -fsSL -o /opt/voices/en_US-lessac-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json \
    && chmod +x /opt/piper/piper \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
RUN npx playwright install chromium --with-deps && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/skills ./skills
COPY apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000 8484

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
