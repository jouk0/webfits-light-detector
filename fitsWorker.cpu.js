const { parentPort, workerData } = require('worker_threads');
const fetch = require('node-fetch');
const { parseFitsFast } = require('./utils');

async function processUrl(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status}`);
  }

  const buf = new Uint8Array(await res.arrayBuffer());

  // ⚡ OPTIMOITU FITS-LUKU
  const data = parseFitsFast(buf);

  let flux = 0;
  for (let i = 0; i < data.length; i++) {
    flux += data[i];
  }

  return flux;
}

(async () => {
  try {
    const lightCurve = [];

    for (const url of workerData.urls) {
      lightCurve.push(await processUrl(url));
    }

    parentPort.postMessage({
      success: true,
      lightCurve
    });

  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: err.message
    });
  }
})();
