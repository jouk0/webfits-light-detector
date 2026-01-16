// fitsWorker.js (OPTIMIZED)
const { parentPort, workerData } = require('worker_threads');
const fetch = require('node-fetch');
const { parseFits } = require('./utils');

const MAX_PARALLEL_FETCHES = 4; // suojaa palvelimia ja muistia

async function fetchAndProcess(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buf = new Uint8Array(arrayBuffer);

  const img = parseFits(buf);

  // ⚡ nopeampi kuin reduce callback
  let flux = 0;
  const data = img.data;
  for (let i = 0; i < data.length; i++) {
    flux += data[i];
  }

  return {
    flux,
    rawFits: buf
  };
}

(async () => {
  try {
    const urls = workerData.urls;
    const lightCurve = [];
    let stackedFits = null;

    // Rajoitettu rinnakkaisuus
    for (let i = 0; i < urls.length; i += MAX_PARALLEL_FETCHES) {
      const slice = urls.slice(i, i + MAX_PARALLEL_FETCHES);

      const results = await Promise.all(
        slice.map(url => fetchAndProcess(url))
      );

      for (const r of results) {
        lightCurve.push(r.flux);

        // ota vain yksi FITS jatkokäyttöön
        if (!stackedFits) {
          stackedFits = r.rawFits;
        }
      }
    }

    parentPort.postMessage({
      success: true,
      data: Buffer.from(stackedFits),
      lightCurve,
      transitCandidates: [] // myöhemmin analyysi
    });

  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: err.message
    });
  }
})();
