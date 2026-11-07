FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY bot/package.json bot/
COPY activity/package.json activity/
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001
VOLUME ["/app/data"]
CMD ["npm", "start"]
