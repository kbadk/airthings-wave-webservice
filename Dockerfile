FROM node:14

RUN apt-get update && apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev

COPY /app/package*.json /app/
WORKDIR /app
RUN npm install --production
COPY /app /app
COPY /entrypoint.sh /entrypoint.sh

EXPOSE 8080

CMD /entrypoint.sh
