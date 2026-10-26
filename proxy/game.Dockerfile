FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json ./
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY shared ./shared
COPY server/src ./server/src
USER node
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "src/index.ts"]
