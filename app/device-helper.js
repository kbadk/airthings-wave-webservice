import noble from '@abandonware/noble';
import struct from 'python-struct';

/**
 * Find a deviceId from the device's manufacturerId.
 * See https://www.bluetooth.com/specifications/assigned-numbers/company-identifiers/.
 * @param {number} manufacturerId
 * @return {string}
 * @public
 */
export async function findDeviceIdByManufacturerId(manufacturerId) {
	await noble.startScanningAsync();

	return await new Promise((resolve, reject) => {
		noble.on('discover', async (device) => {

			console.log(`Found device, ` +
				`ID: ${device.id}, ` +
				`MAC: ${device.address || '??-??-??-??-??-??'}, ` +
				`signal: ${getSignalStrength(device.rssi)}%`
			);

			await device.connectAsync();

			const [discoveredManufacturerId,] = struct.unpack('<HLH',
				device.advertisement.manufacturerData);

			await device.disconnectAsync();

			if (manufacturerId !== discoveredManufacturerId) {
				return;
			}

			await noble.stopScanningAsync();
			resolve(device.id);
		});
	});
}

/**
 * Get a device by its deviceId.
 * @param {string} deviceId
 * @return {noble.Peripheral}
 * @public
 */
export async function findDeviceByDeviceId(deviceId) {
	await noble.startScanningAsync();

	return await new Promise((resolve, reject) => {
		noble.on('discover', async (device) => {

			console.log(`Found device, ` +
				`ID: ${device.id}, ` +
				`MAC: ${device.address || '??-??-??-??-??-??'}, ` +
				`signal: ${getSignalStrength(device.rssi)}%`
			);

			if (!device.id.startsWith(deviceId)) {
				return;
			}

			resolve(device);
			await noble.stopScanningAsync();
		});
	});
}

/**
 * Create an async function that reads the characteristics from the device.
 * @param {noble.Peripheral} device Device to get characteristics from.
 * @param {string} characteristicId Characteristics UUID or ID.
 * @return {function}
 * @public
 */
export async function getCharacteristicReader(device, characteristicId) {
	const { characteristics } = await device
		.discoverSomeServicesAndCharacteristicsAsync([], [characteristicId]);

	if (characteristics.length === 0) {
		throw new Error('No characteristics found');
	}

	return function () {
		return new Promise((accept, reject) => {

			// If it doesn't resolve fast enough, we timeout.
			const timeout = setTimeout(() => {
				reject('Timeout reading characteristics');
			}, 2000);

			characteristics[0].read((error, data) => {
				if (error) return reject(error);

				clearTimeout(timeout);
				const reading = struct.unpack('BBBBHHHHHHHH', data);
				accept(reading);
			});

		});
	}
}

/**
 * Calculate approximately signal strength percentage from RSSI.
 * See https://stackoverflow.com/a/49370774/453331.
 * @param {rssi} rssi
 * @return {number}
 * @private
 */
function getSignalStrength(rssi) {
	return 2 * (rssi + 100);
}
