FROM public.ecr.aws/docker/library/node:20-bookworm-slim

ENV NODE_ENV=production
ENV N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true

RUN npm install -g n8n@2.19.5

USER node
WORKDIR /home/node

EXPOSE 5678

CMD ["n8n", "start"]
