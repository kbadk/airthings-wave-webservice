FROM node:14 as builder

RUN apt-get update && apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev

COPY /app/package*.json /app/
WORKDIR /app
RUN npm install --production

FROM node:14-alpine

RUN apk add --update bluez

COPY /app /app
COPY --from=builder /app/node_modules /app/node_modules

EXPOSE 8080

HEALTHCHECK --interval=30m --timeout=5s \
	CMD wget --no-verbose --spider http://localhost:8080/ || exit 1

WORKDIR /app
CMD npm run start
