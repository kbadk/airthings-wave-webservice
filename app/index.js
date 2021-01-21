import { env } from 'process';

import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { Mutex, withTimeout } from 'async-mutex';
import * as promClient from 'prom-client';

import { findDeviceIdByManufacturerId, findDeviceByDeviceId, getCharacteristicReader } from './device-helper.js';

// ManufacturerID for "Corentium AS", creator of the BLE receiver in the Airthings Wave+.
const MANUFACTURER_ID = 820;

// Found through trial-and-error, confirmed to be right here:
// https://github.com/Airthings/waveplus-reader/blob/2645db525862d54634603fe438cac255a8de0091/read_waveplus.py#L111
const SENSOR_CHARACTERISTICS_UUID = 'b42e2a68ade711e489d3123b93f75cba';

// When defined by the user, removes the need to connect to every BLE device in order to identify
// the Airthings Wave+ device.
const DEVICE_ID = env.DEVICE_ID;

const PORT = env.PORT || 8080;

const metricGuages = {
	humidity: new promClient.Gauge({
		name: 'humidity_percent',
		help: 'Humidity, %rH'
	}),
	radonStAvg: new promClient.Gauge({
		name: 'radon_short_term_avg_becquerels',
		help: 'Radon, short term average, Bq/m3'
	}),
	radonLtAvg: new promClient.Gauge({
		name: 'radon_long_term_avg_becquerels',
		help: 'Radon, long term average, Bq/m3'
	}),
	temperature: new promClient.Gauge({
		name: 'temperature_celsius',
		help: 'Temperature, Celcius'
	}),
	pressure: new promClient.Gauge({
		name: 'pressure_pascal',
		help: 'Relative atmospheric pressure, hPa'
	}),
	co2: new promClient.Gauge({
		name: 'carbondioxide_ppm',
		help: 'Carbon dioxide, ppm'
	}),
	voc: new promClient.Gauge({
		name: 'voc_ppb',
		help: 'Votalie organic compounds, ppb'
	})
};

function sleep(seconds) {
	return new Promise((accept) => setTimeout(accept, 1000 * seconds));
}

async function main() {
	let deviceId = DEVICE_ID;
	if (!deviceId) {
		console.warn('No device ID found. Scanning by name...');
		const deviceId = await findDeviceIdByManufacturerId(MANUFACTURER_ID);
		console.warn('Found device with ID', deviceId, 'set this as DEVICE_ID on next start');
	}
	const device = await findDeviceByDeviceId(deviceId);

	const app = express();

	const mutex = withTimeout(new Mutex(), 27 * 1000);
	app.get('/', async (req, res) => {
		const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
		const [ cached, sensorData ] = await readSensorData(device, mutex);

		console.log(`Responding with ${cached ? 'cached' : 'new' } data: ` +
			`${JSON.stringify(sensorData)} to ${ip}`);

		res.json(sensorData);
	});

	app.get('/metrics', async (req, res) => {
		const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
		const [ cached, sensorData ] = await readSensorData(device, mutex);

		for (const metricName in metricGuages) {
			metricGuages[metricName].set(sensorData[metricName]);
		}

		console.log(`Responding with ${cached ? 'cached' : 'new' } data (metrics): ` +
			`${JSON.stringify(sensorData)} to ${ip}`);

		res.type('text/plain').send(await promClient.register.metrics());
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
async function readSensorData(device, mutex) {
	if (cachedSensorData) {
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
	while (!sensorData) {
		try {
			if (device.state !== 'connected') {
				await device.connectAsync();
			}
			const readCharacteristic = await getCharacteristicReader(device,
				SENSOR_CHARACTERISTICS_UUID);
			sensorData = await readCharacteristic();
			await device.disconnectAsync();
		} catch (e) {
			console.error('Error', String(e));
			await sleep(2);
		}

		// The sensor occasionally sends back this bogus sensor data:
		// { "humidity": 127.5, "radonStAvg": 0, "radonLtAvg": 0, "temperature": 382.2,
		// 	 "pressure": 1310.7, "co2": 65535, "voc": 65535 }
		// When that happens, we want to throw it away and try again.
		if (sensorData && (sensorData.humidity > 100 || sensorData.temperature > 100
			|| sensorData.co2 === 65535 || sensorData.voc === 65535)) {
			console.log('Received bogus data', sensorData);
			sensorData = null;
			await sleep(2);
		}
	}

	cachedSensorData = parseSensorData(sensorData);
	setTimeout(() => cachedSensorData = null, 4 * 60 * 1000);

	mutex.release();
	return [ false, cachedSensorData ];
}

main();
