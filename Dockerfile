FROM n8nio/n8n:latest-debian

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY services ./services
COPY scripts ./scripts
COPY workflows ./workflows
COPY README.md ./
COPY .env.example ./

RUN chmod +x /app/scripts/build-short.sh

USER node

CMD ["node", "/app/services/render-proxy.js"]
