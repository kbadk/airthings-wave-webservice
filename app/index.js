import { env } from 'process';

import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { Mutex } from 'async-mutex';

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

async function main() {
	let deviceId = DEVICE_ID;
	if (!deviceId) {
		console.warn('No device ID found. Scanning by name...');
		const deviceId = await findDeviceIdByManufacturerId(MANUFACTURER_ID);
		console.warn('Found device with ID', deviceId, 'set this as DEVICE_ID on next start');
	}
	const device = await findDeviceByDeviceId(deviceId);

	const app = express();
	const mutex = new Mutex();
	let cachedNeatObject = null;
	app.get('/', async (req, res) => {
		await mutex.acquire();
		const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

		if (cachedNeatObject) {
			console.log(`Responding with cached data: ${JSON.stringify(cachedNeatObject)} to ${ip}`);
			res.json(cachedNeatObject);
			mutex.release();
			return;
		}

		await device.connectAsync();
		const readCharacteristic = await getCharacteristicReader(device, SENSOR_CHARACTERISTICS_UUID);
		const sensorData = await readCharacteristic();
		await device.disconnectAsync();

		const neatObject = parseSensorData(sensorData);
		console.log(`Responding with new data: ${JSON.stringify(neatObject)} to ${ip}`);
		res.json(neatObject);

		cachedNeatObject = neatObject;
		setTimeout(() => cachedNeatObject = null, 4 * 60 * 1000);
		mutex.release();
	});

	app.all('*', async (req, res) => {
		res.sendStatus(StatusCodes.NOT_IMPLEMENTED);
	});

	app.listen(PORT, () => console.log('Listening on', PORT));
}

function parseSensorData(sensorData) {
	return {
		battery: sensorData[0],
		humidity: sensorData[1] / 2.0,
		radonStAvg: sensorData[4],
		radonLtAvg: sensorData[5],
		temperature: sensorData[6] / 100.0,
		pressure: sensorData[7] / 50.0,
		co2: sensorData[8],
		voc: sensorData[9]
	};
}

main();
