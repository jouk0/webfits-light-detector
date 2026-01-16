const { parentPort, workerData } = require('worker_threads');
const fetch = require('node-fetch');
const { parseFits } = require('./utils');

function detectTransits(lightCurve) {
  const mean =
    lightCurve.reduce((a, b) => a + b.flux, 0) / lightCurve.length;

  const std = Math.sqrt(
    lightCurve.reduce((s, p) => s + Math.pow(p.flux - mean, 2), 0) /
    lightCurve.length
  );

  return lightCurve
    .filter(p => p.flux < mean - 3 * std)
    .map(p => ({
      time: p.time,
      depth: (mean - p.flux) / mean
    }));
}

(async () => {
  try {
    const lightCurve = [];

    for (const url of workerData.urls) {
      const res = await fetch(url);
      const buf = new Uint8Array(await res.arrayBuffer());

      const fits = parseFits(buf);
      const table = fits.tables?.[1]; // Binary table

      if (!table) continue;

      const time = table.columns.TIME;
      const flux = table.columns.PDCSAP_FLUX;

      for (let i = 0; i < time.length; i++) {
        if (!isFinite(flux[i])) continue;
        lightCurve.push({
          time: time[i],
          flux: flux[i]
        });
      }
    }

    const transitCandidates = detectTransits(lightCurve);

    parentPort.postMessage({
      success: true,
      lightCurve,
      transitCandidates
    });

  } catch (err) {
    parentPort.postMessage({ success: false, error: err.message });
  }
})();
