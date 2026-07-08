FROM node:20-slim

RUN apt-get update -qq && apt-get install -y -qq python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p data signed-contracts contracts

EXPOSE 3001

CMD ["node", "server.js"]
