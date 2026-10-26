FROM node:22-alpine AS build
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm install
COPY shared ./shared
COPY client ./client
RUN cd client && npm run build
FROM nginx:alpine
COPY --from=build /app/client/dist /usr/share/nginx/html
COPY proxy/nginx.conf /etc/nginx/conf.d/default.conf
