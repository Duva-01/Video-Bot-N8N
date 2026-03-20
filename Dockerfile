FROM n8nio/n8n:latest

USER root

RUN if command -v apt-get >/dev/null 2>&1; then \
      apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*; \
    elif command -v apk >/dev/null 2>&1; then \
      apk add --no-cache ffmpeg; \
    else \
      echo "Unsupported package manager" >&2; \
      exit 1; \
    fi

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY services ./services
COPY scripts ./scripts
COPY workflows ./workflows
COPY README.md ./
COPY .env.example ./

RUN chmod +x /app/scripts/build-short.sh

USER node

CMD ["node", "/app/services/render-proxy.js"]

