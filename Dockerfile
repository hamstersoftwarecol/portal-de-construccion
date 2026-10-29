FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
