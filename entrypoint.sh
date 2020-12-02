#!/bin/sh

service dbus start
bluetoothd &

cd /app && npm run --silent start
