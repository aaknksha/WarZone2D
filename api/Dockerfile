FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY index.mjs ./
COPY auth.mjs ./
COPY 002_phase2.sql ./
COPY 003_users.sql ./
USER node
EXPOSE 4000
CMD ["node", "index.mjs"]
