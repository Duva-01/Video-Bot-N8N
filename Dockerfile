FROM n8nio/n8n:latest-debian

USER root

RUN sed -i 's|http://deb.debian.org/debian|http://archive.debian.org/debian|g' /etc/apt/sources.list \
    && sed -i 's|http://deb.debian.org/debian-security|http://archive.debian.org/debian-security|g' /etc/apt/sources.list \
    && printf 'Acquire::Check-Valid-Until "false";\n' > /etc/apt/apt.conf.d/99no-check-valid \
    && apt-get update -o Acquire::Check-Valid-Until=false \
    && apt-get install -y --no-install-recommends ffmpeg bash espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY backend/services ./services
COPY backend/public ./public
COPY backend/scripts ./scripts
COPY backend/data ./data
COPY backend/workflows ./workflows
COPY backend/db ./db
COPY README.md ./

RUN chmod +x /app/scripts/build-short.sh

CMD ["node", "/app/services/render-proxy.js"]
