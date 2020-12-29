import { env } from 'process';

import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { Mutex, withTimeout } from 'async-mutex';

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

	const mutex = withTimeout(new Mutex(), 20 * 1000);
	app.get('/', async (req, res) => {
		const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
		const [ cached, sensorData ] = await readSensorData(device, mutex);
		console.log(`Responding with ${cached ? 'cached' : 'new' } data: ${JSON.stringify(sensorData)} to ${ip}`);
		res.json(sensorData);
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
		console.log('Mutex acquisition timed out, forcing acquisition');
		await mutex.release();
		await mutex.acquire();
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
	}

	cachedSensorData = parseSensorData(sensorData);;
	setTimeout(() => cachedSensorData = null, 4 * 60 * 1000);

	mutex.release();
	return [ false, cachedSensorData ];
}

async function updateMetrics() {

}

main();
