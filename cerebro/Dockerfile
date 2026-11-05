FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY criar_cliente.js criar_usuario.js ./
ENV NODE_ENV=production SIRA_DATA=/dados
VOLUME /dados
EXPOSE 3200
RUN mkdir -p /dados && chown node:node /dados
USER node
CMD ["node", "src/index.js"]
