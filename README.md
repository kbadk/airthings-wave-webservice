# Airthings Wave Plus

Node.js microservice for reading sensor data from an Airthings Wave Plus device.

When starting for the first time, the microservice will have to connect to all devices it
discovers to find the Wave device. This can take a little while. Once the device has been
found, set the `DEVICE_ID` environment variable as instructed by the application output. By doing
this, the application won't have to connect to every device found to find the Wave.

On every request, the service connects, reads the values and disconnects. Keeping a persistent
connection is flaky and also seemingly keeps other clients from connecting to the device. As a
result, the response time for the request is usually about 1-3 seconds when uncached.

Requests automatically get cached for 4 minutes, so further requests won't put unnecessary strain
on the device. After all, it's battery powered, and you don't want it to die from being constantly
polled. Besides, the sensors only update their sensor data once every 5 minutes (1 hour for the
radon reader), so polling the device more frequently wouldn't change much.

## Usage

```bash
$ curl -s localhost:8080 | jq
{
  "battery": 1,
  "humidity": 35,
  "radonStAvg": 7,
  "radonLtAvg": 10,
  "temperature": 22.16,
  "pressure": 1014.1,
  "co2": 727,
  "voc": 50
}
```

Sample `docker-compose.yml`

```yaml
version: "3"

services:
  airthings:
    build: .
    container_name: airthings
    hostname: airthings
    ports:
      - 8080:8080
    privileged: true # bluetooth
    network_mode: "host" # bluetooth
    environment:
      - TZ=Europe/Copenhagen
    #  - DEVICE_ID=806fb0a9ec94
    restart: on-failure
```

## Purpose

Unlimited potential! I use it in conjunction with [Node-RED](https://nodered.org/) to make
certain Philips Hue light bulbs turn red when the air quality is poor, so I know to vent the room.
