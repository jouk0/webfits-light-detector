import { parentPort, workerData } from 'worker_threads'
import fetch from 'node-fetch'
import qs from 'querystring'
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const jsfitsio = require('jsfitsio');
const FITSGetFile = jsfitsio.FITSParser.processFits
const FITSParser = jsfitsio.FITSParser;
const ParseUtils = jsfitsio.ParseUtils;
const ParseHeader = jsfitsio.ParseHeader;
const MAX_PARALLEL_FETCHES = 4; // rajoita rinnakkaisia fetchauksia
function toNumber(v) {
  if (v === undefined || v === null) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    return Number(v.replace(/'/g, '').trim());
  }
  return NaN;
}
function getFirstFinite(...vals) {
  for (const v of vals) {
    if (Number.isFinite(v)) return v;
  }
  return NaN;
}

export function parseLightCurveFlexible(fitsData) {
  const parsed = ParseHeader.parse(fitsData);

  if (!parsed?.items?.length) throw new Error("No FITS header items found");

  const header = {};
  const clean = v => typeof v === 'string' ? v.replace(/'/g, '').trim() : v;
  for (const item of parsed.items) header[item._key] = clean(item._value);

  const toNumberSafe = v => typeof v === 'number' ? v : Number(v);

  // --- Hae aikakentät joustavasti ---
  let tStart = getFirstFinite(
    toNumberSafe(header.TSTART),
    toNumberSafe(header['MJD-BEG']),
    toNumberSafe(header['MJD_BEG'])
  );
  let tStop = getFirstFinite(
    toNumberSafe(header.TSTOP),
    toNumberSafe(header['MJD-END']),
    toNumberSafe(header['MJD_END'])
  );
  let dt = getFirstFinite(
    toNumberSafe(header.TIMEDEL),
    toNumberSafe(header.XPOSURE),
    0.02083333
  );

  if (!Number.isFinite(tStart)) tStart = 0;
  if (!Number.isFinite(tStop)) tStop = tStart + 1;
  if (!Number.isFinite(dt) || dt <= 0) dt = 0.02083333;

  const time = [];
  const flux = [];
  for (let t = tStart; t <= tStop + 1e-12; t += dt) {
    time.push(t);
    flux.push(dt);
  }

  return {
    time,
    flux,
    meta: {
      source: "header-only",
      timesys: header.TIMESYS || 'BJD',
      unit: header.TIMEUNIT || 'd',
      telescope: header.TELESCOP || 'unknown',
      instrument: header.INSTRUME || 'unknown'
    }
  };
}


/**
 * Parsii Binary Table HDU:n ja palauttaa light curve -datan
 * @param {Uint8Array} fitsData - ladattu FITS-tiedoston sisältö
 * @returns {{time: number[], flux: number[]}}
 */
export function parseBinaryTableLightCurve(fitsData) {
  const hdus = ParseHeader.parse(fitsData);

  // Etsi Binary Table HDU
  const bintableHDU = hdus.items.find(h => h.header.EXTNAME === "LIGHTCURVE" || h.header.XTENSION === "BINTABLE");
  if (!bintableHDU) throw new Error("No Binary Table HDU found");

  const table = bintableHDU.data;
  if (!table) throw new Error("Binary Table data missing");

  const columns = jsfitsio.ParseUtils.getColumns(table);

  // Yritetään lukea TIME ja FLUX
  const timeArray =
    columns.TIME?.array ||
    columns.time?.array ||
    columns.TSTART?.array; // fallback

  const fluxArray =
    columns.PDCSAP_FLUX?.array ||
    columns.SAP_FLUX?.array ||
    columns.FLUX?.array;

  const qualityArray =
    columns.QUALITY?.array;

  if (!timeArray || !fluxArray) throw new Error("TIME or FLUX column missing");

  const time = [];
  const flux = [];

  for (let i = 0; i < timeArray.length; i++) {
    if (qualityArray && qualityArray[i] !== 0) continue; // hylkää virheelliset pisteet
    if (!Number.isFinite(fluxArray[i])) continue;       // hylkää NaN/inf
    time.push(timeArray[i]);
    flux.push(fluxArray[i]);
  }

  return { time, flux };
}
async function downloadFits(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Node.js) FitsImageAnalyzer the exoplanet hunter',
      'Accept': '*/*'
    }
  });

  if (!res.ok) {
    throw new Error(`MAST download failed ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  
  return new Uint8Array(arrayBuffer);
}

/**
 * Lataa FITS-tiedoston ja palauttaa headerit ja datan
 * @param {string} url - FITS-tiedoston URL
 * @returns {Promise<{header: Array<{key:string,value:any,comment:string}>, data: Uint8Array}>}
 */
export async function loadFits(url) {
  // 1. Lataa FITS
  console.log("loadFits url:", url)
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Node.js) FitsImageAnalyzer',
      'Accept': '*/*'
    }
  });
  if (!res.ok) throw new Error(`FITS download failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const uint8data = new Uint8Array(arrayBuffer);
  const lightCurve = parseLightCurveFlexible(uint8data);

  return { lightCurve };
}

/**
 * Lataa FITS-tiedoston ja palauttaa headerit ja datan
 * @param {string} url - FITS-tiedoston URL
 * @returns {Promise<{header: Array<{key:string,value:any,comment:string}>, data: Uint8Array}>}
 */
export async function loadFitsSimple(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Node.js) FitsImageAnalyzer the exoplanet hunter',
      'Accept': '*/*'
    }
  });
  if (!res.ok) throw new Error(`MAST download failed ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const uint8data = new Uint8Array(arrayBuffer);

  const BLOCK = 2880;
  const textDecoder = new TextDecoder("ascii");
  
  // --- 1. Parsaa header ---
  const headerText = textDecoder.decode(uint8data.slice(0, BLOCK));
  const lines = headerText.match(/.{1,80}/g) || [];
  const header = [];

  for (const line of lines) {
    const key = line.slice(0, 8).trim();
    if (!key || key === "END") continue;

    let value = line.slice(10).trim().split("/")[0].trim();
    if (!isNaN(Number(value))) value = Number(value);
    const comment = line.includes("/") ? line.slice(10).trim().split("/")[1].trim() : "";

    header.push({ key, value, comment });
  }

  // --- 2. Laske data offset ---
  const naxis = header.find(h => h.key === "NAXIS")?.value || 0;
  let offset = BLOCK; // Primary HDU header

  if (naxis > 0) {
    const naxis1 = header.find(h => h.key === "NAXIS1")?.value || 0;
    const naxis2 = header.find(h => h.key === "NAXIS2")?.value || 0;
    const bitpix = Math.abs(header.find(h => h.key === "BITPIX")?.value || 8);
    const dataBytes = (bitpix / 8) * naxis1 * naxis2;
    offset += Math.ceil(dataBytes / BLOCK) * BLOCK;
  }

  // --- 3. Tarkista NEXTEND ja etsi BINTABLE ---
  const nextend = header.find(h => h.key === "NEXTEND")?.value || 0;
  let data = new Uint8Array(0);

  for (let i = 0; i < nextend; i++) {
    const extHeaderText = textDecoder.decode(uint8data.slice(offset, offset + BLOCK));
    const extLines = extHeaderText.match(/.{1,80}/g) || [];
    const extHeader = [];

    for (const line of extLines) {
      const key = line.slice(0,8).trim();
      if (!key || key === "END") continue;

      let value = line.slice(10).trim().split("/")[0].trim();
      if (!isNaN(Number(value))) value = Number(value);
      const comment = line.includes("/") ? line.slice(10).trim().split("/")[1].trim() : "";

      extHeader.push({ key, value, comment });
    }

    offset += BLOCK;

    const xtension = extHeader.find(h => h.key === "XTENSION")?.value;
    if (xtension === "BINTABLE") {
      const naxis1 = extHeader.find(h => h.key === "NAXIS1")?.value || 0;
      const naxis2 = extHeader.find(h => h.key === "NAXIS2")?.value || 0;
      const tableSize = naxis1 * naxis2; // oletetaan 1 byte per element
      data = uint8data.slice(offset, offset + tableSize);
      break;
    } else {
      // ohita tämän extension datan
      const naxis1 = extHeader.find(h => h.key === "NAXIS1")?.value || 0;
      const naxis2 = extHeader.find(h => h.key === "NAXIS2")?.value || 0;
      const bitpix = 8;
      const dataSize = naxis1 * naxis2 * (bitpix/8);
      offset += Math.ceil(dataSize / BLOCK) * BLOCK;
    }
  }

  return { header, data };
}

async function fetchAndParseFITS(url) {

  const { lightCurve } = await loadFits(url);

  return { lightCurve: lightCurve };
}
/**
 * Hakee TESS light curve FITS -tiedostot annetusta taivaan koordinaatista
 */
async function fetchTessLightCurveUrls(ra, dec, radius = 0.02) {
  const requestObj = {
      service: "Mast.Catalogs.Tic.Cone",
      format: "json",
      params: {
          columns: "TICID,RA,DEC,Tmag",
          ra,
          dec,
          radius
      }
  };

  const body = qs.stringify({ request: JSON.stringify(requestObj) });
  const obsRes = await fetch('https://mast.stsci.edu/api/v0/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
  });

  const data = await obsRes.json();
  const observations = data?.data || [];

  const fitsUrls = [];

  for (const obs of observations) {
      const requestObj2 = {
          service: "Mast.Caom.Products",
          format: "json",
          params: { obsid: obs.ID }
      };
      const body2 = qs.stringify({ request: JSON.stringify(requestObj2) });
      const obsRes2 = await fetch('https://mast.stsci.edu/api/v0/invoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body2
      });
      const data2 = await obsRes2.json();
      const products = data2?.data || [];

      for (const p of products) {
          if (p.dataURI) {
              fitsUrls.push(
                  "https://mast.stsci.edu/api/v0.1/Download/file?uri=" +
                  encodeURIComponent(p.dataURI)
              );
          }
      }
  }

  return fitsUrls;
}
/**
 * Hakee FITS-tiedoston URL:sta, purkaa sen ja palauttaa light curve -datan.
 * @param {string} url - FITS-tiedoston URL
 * @returns {Promise<{lightCurve: number[], rawFits: Buffer} | false>}
 */
async function fetchAndProcess(url) {
  try {

    const { lightCurve } = await fetchAndParseFITS(url);
    return { lightCurve };

  } catch (err) {
    console.error('fetchAndProcess error:', err);
    return false;
  }
}


// ==============================
// Worker pääfunktio
// ==============================
(async () => {
  try {
    const { ra, dec, radius = 0.1 } = workerData;

    // Hae TESS light curve URLit
    const urls = await fetchTessLightCurveUrls(ra, dec, radius);
    console.log(`Found ${urls.length} FITS files`);

    const lightCurve = []
    let stackedFits = null;

    // Rajoita rinnakkaisuutta MAX_PARALLEL_FETCHES
    for (let i = 0; i < urls.length; i += MAX_PARALLEL_FETCHES) {
        const chunk = urls.slice(i, i + MAX_PARALLEL_FETCHES).map(fetchAndProcess);
        const results = await Promise.all(chunk);

        for (const r of results) {
            if (r) {
                lightCurve.push(r.lightCurve)
                if (!stackedFits) stackedFits = r.rawFits;
            }
        }
    }

    parentPort.postMessage({
        success: true,
        data: stackedFits ? Buffer.from(stackedFits) : null,
        lightCurve,
        transitCandidates: [] // Lisäys myöhemmin
    });

  } catch (err) {
      parentPort.postMessage({ success: false, error: err.message });
  }
})();
