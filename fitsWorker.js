// fitsWorker.js
const { parentPort, workerData } = require('worker_threads');
const { fetchBuffer } = require('./utils');

(async () => {
  try {
    const { urls } = workerData;

    if (!urls || urls.length === 0) {
      throw new Error('No FITS URLs provided');
    }

    // 🔬 TESTI: haetaan vain ensimmäinen FITS
    console.log(urls[0])
    const rawFits = await fetchBuffer(urls[0]);
    console.log(rawFits)
    parentPort.postMessage({
      success: true,
      data: rawFits,
      mode: 'single-fits'
    });

  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: err.message
    });
  }
})();
