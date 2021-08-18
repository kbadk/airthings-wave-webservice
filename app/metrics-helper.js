import * as promClient from 'prom-client';

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

export function getMetrics(sensorData) {
	for (const metricName in metricGuages) {
		if (typeof sensorData[metricName] === "number") {
			metricGuages[metricName].set(sensorData[metricName]);
		}
	}
	return promClient.register.metrics();
}
