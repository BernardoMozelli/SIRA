FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production SIRA_LOG=/logs/conector-execucoes.log
VOLUME /logs
RUN mkdir -p /logs && chown node:node /logs
USER node
CMD ["node", "src/index.js"]
