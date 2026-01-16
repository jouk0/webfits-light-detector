const { parentPort, workerData } = require('worker_threads');
const { fetchBuffer, selectReferenceStar, aperturePhotometry, parseFits } = require('./utils');

(async () => {
  try {
    const { urls } = workerData;
    const frames = [];

    for (const url of urls) {
        console.log(url)
      const buf = await fetchBuffer(url.url);
      const img = parseFits(buf);
      frames.push(img);
    }

    // 1️⃣ Valitse referenssitähti (kirkkain keskialueelta)
    const ref = selectReferenceStar(frames[0]);

    // 2️⃣ Fotometria jokaiselle framelle
    const lightCurve = [];

    for (let i = 0; i < frames.length; i++) {
      const flux = aperturePhotometry(frames[i], ref.x, ref.y);
      lightCurve.push({
        frame: i,
        flux
      });
    }

    // 3️⃣ Normalisoi
    const mean =
      lightCurve.reduce((s, p) => s + p.flux, 0) / lightCurve.length;

    lightCurve.forEach(p => {
      p.normFlux = p.flux / mean;
    });

    // 4️⃣ Transit-epäily
    const dips = lightCurve.filter(p => p.normFlux < 0.98);

    parentPort.postMessage({
      success: true,
      data: {
        frames: frames.length,
        referenceStar: ref,
        lightCurve,
        transitCandidates: dips
      }
    });

  } catch (err) {
    parentPort.postMessage({ success: false, error: err.message });
  }
})();
