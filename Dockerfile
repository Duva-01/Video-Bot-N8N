FROM n8nio/n8n:latest-debian

USER root

RUN sed -i 's|http://deb.debian.org/debian|http://archive.debian.org/debian|g' /etc/apt/sources.list \
    && sed -i 's|http://deb.debian.org/debian-security|http://archive.debian.org/debian-security|g' /etc/apt/sources.list \
    && printf 'Acquire::Check-Valid-Until "false";\n' > /etc/apt/apt.conf.d/99no-check-valid \
    && apt-get update -o Acquire::Check-Valid-Until=false \
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
