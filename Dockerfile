FROM apify/actor-node:22 AS build

COPY package*.json ./
RUN npm ci

COPY . ./
RUN npm run build

FROM apify/actor-node:22

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /usr/src/app/dist ./dist
COPY .actor ./.actor

CMD ["npm", "run", "start"]
