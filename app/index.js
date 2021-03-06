import { env } from 'process';

import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { Mutex, withTimeout } from 'async-mutex';

import { findDeviceIdByManufacturerId, findDeviceByDeviceId, getCharacteristicReader } from './device-helper.js';
import { getMetrics } from './metrics-helper.js';

// ManufacturerID for "Corentium AS", creator of the BLE receiver in the Airthings Wave+.
const MANUFACTURER_ID = 820;

// Found through trial-and-error, confirmed to be right here:
// https://github.com/Airthings/waveplus-reader/blob/2645db525862d54634603fe438cac255a8de0091/read_waveplus.py#L111
const SENSOR_CHARACTERISTICS_UUID = 'b42e2a68ade711e489d3123b93f75cba';

// When defined by the user, removes the need to connect to every BLE device in order to identify
// the Airthings Wave+ device.
const DEVICE_ID = env.DEVICE_ID;

// How long to wait for response before using cached data in seconds.
const READ_TIMEOUT = Number(env.READ_TIMEOUT) || 15;

// How long to use cached data in seconds.
const CACHE_TTL = Number(env.CACHE_TTL) || 300;

const PORT = env.PORT || 8080;

async function main() {
	let deviceId = DEVICE_ID;
	if (!deviceId) {
		console.warn('No device ID found. Scanning by name...');
		const deviceId = await findDeviceIdByManufacturerId(MANUFACTURER_ID);
		console.warn('Found device with ID', deviceId, 'set this as DEVICE_ID on next start');
	}
	const device = await findDeviceByDeviceId(deviceId);

	const app = express();

	const mutex = withTimeout(new Mutex(), READ_TIMEOUT * 1000);
	app.get('/', async (req, res) => {
		const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
		const [cached, sensorData] = await readSensorData(device, mutex);

		console.log(`Responding with ${cached ? 'cached' : 'new'} data: ` +
			`${JSON.stringify(sensorData)} to ${ip}`);

		res.json(sensorData);
	});

	app.get('/metrics', async (req, res) => {
		const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
		const [cached, sensorData] = await readSensorData(device, mutex);

		console.log(`Responding with ${cached ? 'cached' : 'new'} data (metrics): ` +
			`${JSON.stringify(sensorData)} to ${ip}`);

		res.type('text/plain').send(await getMetrics(sensorData));
	});

	app.all('*', async (req, res) => {
		res.sendStatus(StatusCodes.NOT_IMPLEMENTED);
	});

	app.listen(PORT, () => console.log('Listening on', PORT));
}

function parseSensorData(sensorData) {
	return {
		// sensorVersion: sensorData[0],  // Always 1 so far
		humidity: sensorData[1] / 2,      // Humidity, %rH
		radonStAvg: sensorData[4],        // Radon, short term average, Bq/m3
		radonLtAvg: sensorData[5],        // Radon, long term average, Bq/m3
		temperature: sensorData[6] / 100, // Temperature, Celcius
		pressure: sensorData[7] / 50,     // Relative atmospheric pressure, hPa
		co2: sensorData[8],               // Carbon dioxide, ppm
		voc: sensorData[9]                // Votalie organic compounds, ppb
	};
}

let cachedSensorData = null;
let cacheTimestamp = 0;
async function readSensorData(device, mutex) {
	if (new Date() - cacheTimestamp < CACHE_TTL * 1000) {
		return [ true, cachedSensorData ];
	}

	try {
		await mutex.acquire();
	} catch (e) {
		console.log('Mutex acquisition timed out, forcing release');
		await mutex.release();
		return await readSensorData(device, mutex);
	}

	let sensorData;
	try {
		if (device.state !== 'connected') {
			await device.connectAsync();
		}
		const readCharacteristic = await getCharacteristicReader(device,
			SENSOR_CHARACTERISTICS_UUID);
		const rawSensorData = await readCharacteristic();
		sensorData = parseSensorData(rawSensorData);
		await device.disconnectAsync();
	} catch (e) {
		console.error('Failed to read new sensor data, responding with stale cache', String(e));
		return [ true, cachedSensorData ]
	}

	// The sensor occasionally sends back this bogus sensor data:
	// { "humidity": 127.5, "radonStAvg": 0, "radonLtAvg": 0, "temperature": 382.2,
	// 	 "pressure": 1310.7, "co2": 65535, "voc": 65535 }
	// When that happens, we want to throw it away and try again.
	if (sensorData.humidity > 100 && sensorData.temperature > 100
		&& sensorData.co2 === 65535 && sensorData.voc === 65535) {
		console.log('Received bogus data', sensorData);
		sensorData = null;
	}

	// Sometimes, the sensor is unable to read just a single or few values. When this happens,
	// re-reading the values usually don't help. In this case, it's therefore better to just ignore
	// the bogus values and send back what we got instead.
	if (sensorData) {
		sensorData.co2 = sensorData.co2 === 65535 ? undefined : sensorData.co2;
		sensorData.voc = sensorData.voc === 65535 ? undefined : sensorData.voc;
	}

	cachedSensorData = sensorData;
	cacheTimestamp = new Date();

	mutex.release();
	return [ false, cachedSensorData ];
}

main();
