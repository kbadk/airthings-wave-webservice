# Airthings Wave Plus

Node.js microservice for reading sensor data from an Airthings Wave Plus device.

Presents a simple JSON object response (`/`) and Prometheus metrics (`/metrics`).

When starting for the first time, the microservice will have to connect to all devices it
discovers to find the Wave device.
This can take a little while.
Once the device has been found, set the `DEVICE_ID` environment variable as instructed by the
application output.
By doing this, the application won't have to connect to every device found to find the Wave.

On every request (unless cached), the service connects, reads the values and disconnects.
Keeping a persistent connection is flaky and also seemingly keeps other clients from connecting
to the device.
As a result, the response time for the request is usually about 1-3 seconds when uncached.

Sensor data is cached for 5 minute (configurable through the environment variable `CACHE_TTL`,
e.g. `CACHE_TTL=60` for 1 minute cache) to avoid unnecessary strain on the device.
After all, it's battery-powered, and you don't want it to die from being constantly polled.
Besides, the sensors only update their sensor data once every 5 minutes (1 hour for the
radon reader), so polling the device more frequently wouldn't change much.

Sometimes, the device will fail to respond in a timely manner.
The service waits for a reply for 10 seconds (configurable through the environment variable
`READ_TIMEOUT`, e.g. `READ_TIMEOUT=30` for 30 seconds).
If the device hasn't responded within that time, the service will instead send back the cached
reading (disregarding the `CACHE_TTL`).
This problem always seems to solve itself within a minute of two, so it's not likely the service
will perpetually send back stale data.
The log will indicate when stale data is served.

## Usage

```
$ curl -s localhost:8080 | jq
{
  "humidity": 29,
  "radonStAvg": 11,
  "radonLtAvg": 11,
  "temperature": 22.8,
  "pressure": 982.84,
  "co2": 819,
  "voc": 105
}
```

```sh
$ curl -s localhost:8080/metrics
# HELP humidity_percent Humidity, %rH
# TYPE humidity_percent gauge
humidity_percent 29

# HELP radon_short_term_avg_becquerels Radon, short term average, Bq/m3
# TYPE radon_short_term_avg_becquerels gauge
radon_short_term_avg_becquerels 11

# HELP radon_long_term_avg_becquerels Radon, long term average, Bq/m3
# TYPE radon_long_term_avg_becquerels gauge
radon_long_term_avg_becquerels 11

# HELP temperature_celsius Temperature, Celcius
# TYPE temperature_celsius gauge
temperature_celsius 22.8

# HELP pressure_pascal Relative atmospheric pressure, hPa
# TYPE pressure_pascal gauge
pressure_pascal 982.84

# HELP carbondioxide_ppm Carbon dioxide, ppm
# TYPE carbondioxide_ppm gauge
carbondioxide_ppm 819

# HELP voc_ppb Votalie organic compounds, ppb
# TYPE voc_ppb gauge
voc_ppb 105
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

Unlimited potential!

I use it in conjunction with [Node-RED](https://nodered.org/) to make certain Philips Hue light
bulbs turn red when the air quality is poor, so I know to vent the room.

I also use it for plotting data in Grafana
([Grafana dashboard](https://grafana.com/grafana/dashboards/12310)) from the metrics endpoint.
