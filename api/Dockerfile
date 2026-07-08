FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
# build_from_source tells prebuild-install to compile better-sqlite3 against
# musl (Alpine) instead of downloading a prebuilt glibc binary
RUN npm_config_build_from_source=true npm ci --omit=dev

COPY . .

RUN mkdir -p data signed-contracts contracts

EXPOSE 3001

CMD ["node", "server.js"]
