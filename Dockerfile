# SIRA — modo direto: cérebro + catálogo no mesmo container, dentro da rede da prefeitura. Contexto de build = raiz do projeto.
FROM node:22-alpine
WORKDIR /app
COPY cerebro/package.json cerebro/package-lock.json ./cerebro/
COPY conector/package.json conector/package-lock.json ./conector/
RUN cd cerebro && npm ci --omit=dev && cd ../conector && npm ci --omit=dev
COPY cerebro/src ./cerebro/src
COPY cerebro/public ./cerebro/public
COPY cerebro/criar_cliente.js cerebro/criar_usuario.js ./cerebro/
COPY conector/src ./conector/src
WORKDIR /app/cerebro
ENV NODE_ENV=production SIRA_DATA=/dados SIRA_MODO_DIRETO=1
RUN mkdir -p /dados && chown node:node /dados
VOLUME /dados
EXPOSE 3200
USER node
CMD ["node", "src/index.js"]
