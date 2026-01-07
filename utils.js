// ==================== utils.js ====================

const axios = require('axios');
const normalizeFitsData = require('./normalizeFitsData');

/* --------------------------------------------------
   Generic fetch-with-retry (STREAM)
-------------------------------------------------- */
async function fetchWithRetry(url, retries = 4, timeoutMs = 120_000) {
  let attempt = 0;
  let lastError;

  while (attempt < retries) {
    try {
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: timeoutMs,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 300,
      });

      const ctype = response.headers['content-type'] || '';
      if (!ctype.toLowerCase().includes('fits')) {
        throw new Error(`Not a FITS file (Content-Type=${ctype})`);
      }

      return response.data;
    } catch (err) {
      lastError = err;
      attempt++;
      const wait = Math.pow(2, attempt) * 1000;
      console.warn(
        `Attempt ${attempt}/${retries} failed for ${url}: ${err.message}. Retrying in ${wait / 1000}s`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw new Error(`All ${retries} attempts failed: ${lastError?.message}`);
}

/* --------------------------------------------------
   Stream FITS → HTTP response
-------------------------------------------------- */
function sendFits(res, fitsStream, filename = 'image.fits') {
  res.setHeader('Content-Type', 'application/fits');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(
      filename
    )}`
  );

  const onError = (err) => {
    console.error('FITS stream error:', err.message);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Error streaming FITS file');
    }
  };

  const onClose = () => {
    fitsStream.destroy();
  };

  fitsStream.once('error', onError);
  res.once('close', onClose);

  fitsStream.pipe(res);
}

/* --------------------------------------------------
   Build FITS image sources (STACK-AWARE)
-------------------------------------------------- */
function buildSources({ ra, dec, size, stackN = 1, mode }) {

    /* ---------------- DSS (Digitized Sky Survey) ---------------- */
    const dss = {
      id: 'DSS (Digitized Sky Survey)',
      async getUrls() {
        const urls = [];
  
        // Luodaan 4 uniikkia koordinaattia 2x2 ruudukkoon
        const raF = parseFloat(ra);
        const decF = parseFloat(dec);
        const offset = parseFloat(size); // offset = kuvan koko
  
        const coords = [
          { ra: raF - offset/2, dec: decF + offset/2 }, // vasen ylä
          { ra: raF + offset/2, dec: decF + offset/2 }, // oikea ylä
          { ra: raF - offset/2, dec: decF - offset/2 }, // vasen ala
          { ra: raF + offset/2, dec: decF - offset/2 }  // oikea ala
        ];
  
        for (const c of coords) {
          const url =
            'https://archive.stsci.edu/cgi-bin/dss_search' +
            `?ra=${c.ra.toFixed(5)}` +
            `&dec=${c.dec.toFixed(5)}` +
            `&equinox=J2000` +
            `&height=${size}` +
            `&width=${size}` +
            `&format=FITS`;
          urls.push(url);
        }
  
        return urls;
      },
    };
  
    /* ---------------- SkyView (NASA GSFC) ---------------- */
    const skyview = {
      id: 'SkyView (NASA)',
      async getUrls() {
        const urls = [];
        const raF = parseFloat(ra);
        const decF = parseFloat(dec);
        const offset = parseFloat(size);
  
        const coords = [
          { ra: raF - offset/2, dec: decF + offset/2 },
          { ra: raF + offset/2, dec: decF + offset/2 },
          { ra: raF - offset/2, dec: decF - offset/2 },
          { ra: raF + offset/2, dec: decF - offset/2 }
        ];
  
        for (const c of coords) {
          urls.push(
            'https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl' +
            `?Position=${c.ra},${c.dec}` +
            `&Survey=DSS` +
            `&Size=${size}` +
            `&Return=FITS`
          );
        }
  
        return urls;
      },
    };
  
    /* ---------------- IRSA (WISE / NEOWISE) ---------------- */
    const irsa = {
      id: 'IRSA (WISE/NEOWISE)',
      async getUrls() {
        const urls = [];
        const raF = parseFloat(ra);
        const decF = parseFloat(dec);
        const offset = parseFloat(size);
  
        const coords = [
          { ra: raF - offset/2, dec: decF + offset/2 },
          { ra: raF + offset/2, dec: decF + offset/2 },
          { ra: raF - offset/2, dec: decF - offset/2 },
          { ra: raF + offset/2, dec: decF - offset/2 }
        ];
  
        for (const c of coords) {
          urls.push(
            `https://irsa.ipac.caltech.edu/ibe/search/wise/neowiser/p1bm_img` +
            `?POS=${c.ra.toFixed(5)},${c.dec.toFixed(5)}` +
            `&SIZE=${size}&BAND=2&FORMAT=FITS`
          );
        }
  
        return urls;
      },
    };
  
    /* ---------------- NOIRLab SIA (DES / DECam) ---------------- */
    const noirlab = {
      id: 'NOIRLab SIA (DES)',
      async getUrls() {
        const urls = [];
        const raF = parseFloat(ra);
        const decF = parseFloat(dec);
        const offset = parseFloat(size);
  
        const coords = [
          { ra: raF - offset/2, dec: decF + offset/2 },
          { ra: raF + offset/2, dec: decF + offset/2 },
          { ra: raF - offset/2, dec: decF - offset/2 },
          { ra: raF + offset/2, dec: decF - offset/2 }
        ];
  
        for (const c of coords) {
          urls.push(
            'https://datalab.noirlab.edu/sia/des_dr2' +
            `?POS=${c.ra},${c.dec}` +
            `&SIZE=${size}` +
            `&FORMAT=image/fits`
          );
        }
  
        return urls;
      },
    };
  
    return [dss, irsa, skyview, noirlab];
  }  


  function merge4Fits2x2(buffers) {
    const images = buffers.map(parseFits);
    const w = images[0].width;
    const h = images[0].height;
  
    const outW = w * 2;
    const outH = h * 2;
    const out = new Float32Array(outW * outH);
  
    for (let i = 0; i < 4; i++) {
      const img = images[i];
      const ox = (i % 2) * w;
      const oy = Math.floor(i / 2) * h;
  
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const src = y * w + x;
          const dst = (oy + y) * outW + (ox + x);
          out[dst] = img.data[src];
        }
      }
    }
  
    const normalized = normalizeFitsData(out);
  
    const header = {
      SIMPLE: true,
      BITPIX: -32,
      NAXIS: 2,
      NAXIS1: outW,
      NAXIS2: outH,
      DATAMIN: 0.0,
      DATAMAX: 1.0,
      EXTEND: true
    };
  
    return writeFits(header, outW, outH, normalized);
}
  
  
  
function parseFitsData(buffer, bitpix) {
    switch (bitpix) {
      case 16:
        return new Int16Array(buffer);
  
      case 32:
        return new Int32Array(buffer);
  
      case -32:
        return new Float32Array(buffer);
  
      default:
        throw new Error(`BITPIX ${bitpix} ei ole tuettu`);
    }
}
  
function computePercentiles(data, low = 0.01, high = 0.99) {
    const clean = [];
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (isFinite(v)) clean.push(v);
    }
  
    clean.sort((a, b) => a - b);
  
    const lo = clean[Math.floor(clean.length * low)];
    const hi = clean[Math.floor(clean.length * high)];
  
    return { min: lo, max: hi };
  }
  
function parseFits(buffer) {
    const header = {};
    let offset = 0;
  
    while (true) {
      const card = buffer.toString('ascii', offset, offset + 80);
      offset += 80;
  
      const key = card.substring(0, 8).trim();
      let value = card.substring(10, 80).trim();
  
      // Poistetaan kaikki "/" ja sen jälkeinen osa
      if (value.includes('/')) value = value.split('/')[0].trim();
  
      if (key) header[key] = value;
      if (key === 'END') break;
    }
  
    // align to 2880
    offset = Math.ceil(offset / 2880) * 2880;
  
    const width  = Number(header.NAXIS1);
    const height = Number(header.NAXIS2);
    const bitpix = Number(header.BITPIX);
  
    if (isNaN(width) || isNaN(height)) {
      throw new Error(`Invalid FITS header: NAXIS1=${header.NAXIS1}, NAXIS2=${header.NAXIS2}`);
    }
  
    const pixelCount = width * height;
    let data;
  
    if (bitpix === 16) {
      data = new Float32Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        data[i] = buffer.readInt16BE(offset + i * 2);
      }
    } else if (bitpix === 32) {
      data = new Float32Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        data[i] = buffer.readInt32BE(offset + i * 4);
      }
    } else {
      throw new Error(`Unsupported BITPIX: ${bitpix}`);
    }
  
    return { header, width, height, data };
}
  
function writeFits(header, width, height, data) {
    const cards = [];
  
    function card(k, v) {
      let val;
      if (typeof v === 'string') val = `'${v}'`;
      else if (typeof v === 'boolean') val = v ? 'T' : 'F';
      else val = v;
      return (k.padEnd(8) + '= ' + String(val).padEnd(70)).slice(0, 80);
    }
  
    Object.entries(header).forEach(([k, v]) => cards.push(card(k, v)));
    cards.push('END'.padEnd(80));
  
    let headerBlock = cards.join('');
    headerBlock += ' '.repeat((2880 - (headerBlock.length % 2880)) % 2880);
  
    const headerBuf = Buffer.from(headerBlock, 'ascii');
    const dataBuf = Buffer.alloc(width * height * 4);
  
    for (let i = 0; i < data.length; i++) {
      dataBuf.writeFloatBE(data[i], i * 4);
    }
  
    return Buffer.concat([headerBuf, dataBuf]);
}
  
  
async function fetchBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
function merge4Fits2x2Enhanced(buffers) {
    if (!buffers || buffers.length !== 4) {
        throw new Error("Exactly 4 FITS buffers required");
    }

    // 1️⃣ Parsitaan kuvat
    const images = buffers.map(buf => parseFits(buf));
    const w = images[0].width;
    const h = images[0].height;
    if (!w || !h) throw new Error(`Invalid width/height: w=${w}, h=${h}`);

    const outWidth = w * 2;
    const outHeight = h * 2;
    const outData = new Float32Array(outWidth * outHeight);

    // 2️⃣ Substrahoi taustataivas ja yhdistä ruudukkoon
    for (let f = 0; f < 4; f++) {
        const img = images[f];
        const pixels = img.data.slice();

        // Taustataivaan mediaani (per kuva)
        const sorted = pixels.slice().sort((a,b)=>a-b);
        const median = sorted[Math.floor(sorted.length/2)];

        // Substrahoi mediaani (vähentää kohinaa)
        for (let i=0; i<pixels.length; i++) {
            pixels[i] = pixels[i] - median;
        }

        // Kopio ruudukkoon
        const ox = (f % 2) * w;
        const oy = Math.floor(f / 2) * h;

        for (let y=0; y<h; y++) {
            for (let x=0; x<w; x++) {
                const idx = y * w + x;
                const cx = ox + x;
                const cy = oy + y;
                outData[cy * outWidth + cx] = pixels[idx];
            }
        }
    }

    // 3️⃣ Percentile-clipping 1–99%
    const flat = outData.slice().filter(v => isFinite(v));
    const p1 = flat[Math.floor(flat.length * 0.01)];
    const p99 = flat[Math.floor(flat.length * 0.99)];
    for (let i=0; i<outData.length; i++) {
        if (outData[i] < p1) outData[i] = p1;
        if (outData[i] > p99) outData[i] = p99;
    }

    // 4️⃣ Päivitä header
    const newHeader = { ...images[0].header };
    newHeader.NAXIS1 = outWidth;
    newHeader.NAXIS2 = outHeight;
    newHeader.BITPIX = 32; // Float32

    return writeFits(newHeader, outWidth, outHeight, outData);
}

/* --------------------------------------------------
   Exports
-------------------------------------------------- */
module.exports = {
  fetchWithRetry,
  sendFits,
  buildSources,
  merge4Fits2x2,
  merge4Fits2x2Enhanced,
  fetchBuffer,
  parseFitsData,
};
