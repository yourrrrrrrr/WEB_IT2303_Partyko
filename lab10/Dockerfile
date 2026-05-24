FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY shared ./shared
COPY assignment1 ./assignment1
COPY assignment2 ./assignment2
ENV NODE_ENV=production
