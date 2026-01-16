// ==================== main.js ====================
// WebFITS-light-detector – refactored frontend controller
// Vastuu: data → analyysi → renderöinti (EI parsintaa kahteen kertaan)

// -------------------- DOM --------------------
const btn = document.getElementById('fetch-btn');
const canvasContainer = document.getElementById('canvas-container');
const headerContainer = document.getElementById('fitsHeader');
// ==================== PHOTOMETRY STORAGE ====================
const photometryFrames = [];
// -------------------- CONFIG --------------------
/** Globaalit renderöintiasetukset – käytetään kaikkialla */
const RENDER_OPTIONS = {
  gamma: 0.6,
  lowPercent: 0.05,
  highPercent: 0.995
};

// -------------------- HELPERS --------------------

function parseFitsDate(str) {
  if (!str) return null;
  return new Date(str.replace(/'/g, '').trim());
}
function randomCutoutParams() {
  const ra = (Math.random() * 360).toFixed(5);
  const dec = (Math.random() * 180 - 90).toFixed(5);
  const size = 65; // degrees
  return { ra, dec, size };
}

/**
 * Renderöi FITS‑headerin annettuun elementtiin.
 * @param {Object} data          Header‑objekti (avain → arvo)
 * @param {HTMLElement|string} target   Elementti tai sen id‑merkkijono
 */
function renderFitsHeader(data, target) {
  // Jos annettu on id‑merkkijono, haetaan elementti.
  if (typeof target === 'string') {
    target = document.getElementById(target);
    if (!target) {
      console.error('renderFitsHeader – elementtiä ei löytynyt:', target);
      return;
    }
  }

  // Varmistetaan, että target on HTMLElement
  if (!(target instanceof HTMLElement)) {
    console.error('renderFitsHeader – target ei ole HTMLElement:', target);
    return;
  }

  // Tyhjennetään vanha sisältö (tämä estää duplikaatin)
  target.innerHTML = '';

  // Rakennetaan rivit
  Object.entries(data).forEach(([key, value]) => {
    const row = document.createElement('div');
    row.className = 'fits-row';

    const k = document.createElement('div');
    k.className = 'fits-key';
    k.textContent = key;

    const v = document.createElement('div');
    v.className = 'fits-value';
    v.textContent = value;

    row.appendChild(k);
    row.appendChild(v);
    target.appendChild(row);
  });
}

// -------------------- MAIN FLOW --------------------
btn.onclick = async () => {
  btn.disabled = true;
  btn.textContent = 'Ladataan FITS…';
  try {
    // 1️⃣ Parametrit
    const { ra, dec, size } = randomCutoutParams();
    const url = `/fits?ra=${ra}&dec=${dec}&size=25&stack=1&mode=raw`;

    console.log('FITS request:', url);

    // 2️⃣ Fetch
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    console.log('FITS blob size:', blob.size);

    // --------------------------------------------------------------
    // 3️⃣ Header → parsinta & UI‑näyttö
    // --------------------------------------------------------------
    const headerData = await readFitsHeaderFromBlob(blob);   // → object (avain → string)
    renderFitsHeader(headerData, headerContainer);           // aikaisempi "rivi‑lista"

    // Uusi “tiivis” metatieto‑paneeli
    const metaInfo = extractUsefulHeaderInfo(headerData);
    renderFitsMeta(metaInfo);      // <div id="fitsMeta"></div> näyttää tiedot

    // 2️⃣ Luo FormData ja lähetä backendille tallennettavaksi
    const formData = new FormData();
    // Anna tiedostolle nimi esim. ra-dec.fits
    const filename = `fits_${ra}_${dec}.fits`;
    formData.append('fitsFile', blob, filename);

    // Lähetä tiedosto Node.js / Express endpointtiin
    const uploadResponse = await fetch('/upload-fits', {
      method: 'POST',
      body: formData
    });

    if (!uploadResponse.ok) {
      console.error('Upload failed:', uploadResponse.statusText);
    } else {
      const data = await uploadResponse.json();
      console.log('Upload successful:', data);
    }

    // 4️⃣ Data
    const { pixels2D, width, height, bitpix } = await readFitsBlob(blob);
    const image1D = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        image1D[y * width + x] = pixels2D[y][x];
      }
    }
    function computeNoiseStats(image) {
      let sum = 0, sum2 = 0;
      const n = image.length;
    
      for (let i = 0; i < n; i++) {
        sum += image[i];
        sum2 += image[i] * image[i];
      }
    
      const mean = sum / n;
      const variance = sum2 / n - mean * mean;
    
      return {
        mean,
        std: Math.sqrt(Math.max(variance, 0))
      };
    }
    async function fetchFits(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const json = await res.json();
    
      return {
        lightCurve: json.lightCurve
      };
    }
    

    // Hae FITS-data
    const fitsData = await fetchFits(`/fits/tess?ra=${ra}&dec=${dec}`);
    console.log('fitsData:', fitsData);

    // Valmistele dataset array Chart.js:lle
    const datasets = fitsData.lightCurve.map((curve, index) => {
      return {
        label: `LC ${index + 1}`,
        data: curve.time,
        borderColor: `hsl(${(index * 360) / fitsData.lightCurve.length}, 70%, 50%)`,
        fill: false,
        pointRadius: 0,
        tension: 0  // suoraviivainen viiva
      };
    });
    let datasets2 = []
    fitsData.lightCurve.forEach((curve) => {
      curve.flux.forEach((flux) => {
        datasets2.push((time/flux))
      })
    })
    console.log(datasets2)
    

    // Luo Chart.js-instanssi
    const ctx = document.getElementById('lightCurveChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: 'Time and Flux',
        datasets: [{
          label: 'Curve',
          data: datasets2,
          borderColor: "#FFF",
          backgroundColor: "#000000",
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: { 
            type: 'linear', 
            title: { display: true, text: 'Time [d]' } 
          },
          y: { 
            title: { display: true, text: 'Flux' } 
          }
        },
        plugins: {
          legend: { display: true }
        }
      }
    });

    


    // ⭐ Noise
    const noiseStats = computeNoiseStats(image1D);

    // ⭐ Source detection
    const stars = detectSources(image1D, width, height, noiseStats);

    console.log(`Detected ${stars.length} stars`);
    
    const measuredStars = stars.map(star =>
      aperturePhotometry(image1D, width, height, star)
    );
    
    console.log('Photometry done:', measuredStars.length);

      // ==================== STORE FRAME ====================
      const frameTime = parseFitsDate(headerData['DATE-OBS']) || parseFitsDate(headerData['DATE']) || Date.now();

      photometryFrames.push({
        time: frameTime,
        stars: measuredStars.map((s, i) => ({
          id: i,
          x: s.x,
          y: s.y,
          netFlux: s.netFlux
        }))
      });

      console.log(
      `Photometry frames stored: ${photometryFrames.length}`
      );


    console.log('FITS loaded:', width, height, 'BITPIX:', bitpix);

    // Flattenataan pikselit (Float32Array‑muotoa ei vaadita)
    const raw = [];
    for (let y = 0; y < pixels2D.length; y++) {
      const row = pixels2D[y];
      for (let x = 0; x < row.length; x++) {
        raw.push(row[x]);
      }
    }

    // 5️⃣ Analyysi
    await runFitsAnalysis(JSON.parse(JSON.stringify(headerData)), pixels2D, blob);
    let widthAndHeight = a4SizeFromWidth(width)
    // 6️⃣ Renderöinti (Canvas)
    // Käytetään globaalia RENDER_OPTIONS‑objektia, eikä luoda uutta
    renderFloatFitsToCanvasImproved(
      raw,
      width,
      height,
      canvasContainer,
      RENDER_OPTIONS
    );

    let pageElements = document.querySelectorAll('.page')
    pageElements.forEach((page) => {
      page.classList.add('active')
    })
// --------------------------------------------------------------
    // 8️⃣ Nimilabelit (numeroita tai SIMBAD‑nimet)
    // --------------------------------------------------------------
    // 8a) Jos haluat vain numerot:
    const { brightPixels } = await analyzeFitsBlob(blob);
    // HUOM! Liikaa lappuja TODO
    //renderStarLabels(document.querySelectorAll('#canvas-container canvas')[0], brightPixels, headerData, { useNames: false });

    console.log('FITS valmis');

  } catch (err) {
    console.error('FITS fetch / render failed:', err);
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Hae FITS';
  }
};
document.getElementById('analyzeTransit').onclick = () => {
  if (photometryFrames.length < 10) {
    alert('Tarvitaan vähintään 10 FITS-framea');
    return;
  }

  const curves = buildLightCurves(photometryFrames);
  const results = detectTransitSignals(curves);

  console.log('Transit analysis:', results);
};

/**
 * Aseta canvas‑elementti A4‑suhteeseen.
 * Jos annetaan vain lyhyt sivu (leveys) mm‑yksiköllä,
 * palautetaan myös korkeus mm‑yksiköllä.
 *
 * @param {number} shortSide   Lyhyen sivun pituus (mm)
 * @returns {{width: number, height: number}}  Koko mm‑yksikössä
 */
function a4SizeFromWidth(shortSide) {
  const height = shortSide * Math.SQRT2;   // √2‑kertoimella
  return { width: shortSide, height };
}
/* --------------------------------------------------------------
   1) FITS‑header‑parser
   ------------------------------------------------------------ */
function parseFitsHeader(rawHeader) {
  // Jos on jo objekti, palauta sellaisenaan
  if (rawHeader && typeof rawHeader === 'object' && !Array.isArray(rawHeader)) {
    return rawHeader;
  }
  const header = {};
  const txt = String(rawHeader);
  for (let i = 0; i < txt.length; i += 80) {
    const card = txt.slice(i, i + 80);
    const key = card.slice(0, 8).trim();
    const val = card.slice(10).split('/')[0].trim();
    if (key) header[key] = val;
    if (key === 'END') break;
  }
  return header;
}

/* --------------------------------------------------------------
   2) Astrometriset apufunktiot
   ------------------------------------------------------------ */
// HH MM SS.s → deg (RA * 15)
function raToDeg(str) {
  const s = cleanHeaderValue(str);
  // Jos on pelkkä luku → arvo on jo asteina (harvoin)
  if (!s.includes(' ')) return parseFloat(s);
  const [h = 0, m = 0, sec = 0] = s.split(/\s+/).map(Number);
  // RA on tunnissa → kerrotaan 15 (1h = 15°)
  return (h + m / 60 + sec / 3600) * 15;
}

function decToDeg(str) {
  const s = cleanHeaderValue(str);
  // DECI‑arvot voivat alkaa +/- – säilytetään
  const sign = s.trim().startsWith('-') ? -1 : 1;
  const numeric = s.replace(/[+\-]/g, '').trim();    // poista +/-
  if (!numeric.includes(' ')) return sign * parseFloat(numeric);
  const [d = 0, m = 0, sec = 0] = numeric.split(/\s+/).map(Number);
  return sign * (d + m / 60 + sec / 3600);
}
/**
 * Poistaa FITS‑headerin mahdolliset lainausmerkit, 
 * lainausmerkkien lisäksi &nbsp;‑, ©‑, ’‑ characters, 
 * sekä kaikki muut ei‑numeeriset / whitespace‑merkit.
 *
 * @param {string} val  Header‑arvo (ra, dec, date …)
 * @returns {string}     Puhdas, parsittava merkkijono
 */
function cleanHeaderValue(val) {
  if (typeof val !== 'string') return val;           // jos on jo number → palauta
  // 1) Poista aloitus‑ ja loppusulut (yksi- tai kaksi‑merkkiä)
  let cleaned = val.replace(/^'+|'+$/g, '');

  // 2) Jos on muita “erikoisia” lainausmerkkejä (’, ‘, “, ”), poista ne
  cleaned = cleaned.replace(/[‘’“”]/g, '');

  // 3) Poista mahdolliset trailing‑kommentit (FITSin “/”‑kommentti on jo leikattu ennen)
  //    (ei pakollinen, mutta varmuuden vuoksi)
  cleaned = cleaned.trim();

  // 4) Jos arvo sisältää vain numeroita, numerot palaavat oikein.
  return cleaned;
}
function extractUsefulHeaderInfo(rawHeader) {
  const hdr = parseFitsHeader(rawHeader);

  // ==== RA / DEC ====
  let raDeg = null;
  let decDeg = null;

  if (hdr.OBJCTRA && hdr.OBJCTDEC) {
    raDeg  = raToDeg(hdr.OBJCTRA);
    decDeg = decToDeg(hdr.OBJCTDEC);
  } else if (hdr.RA && hdr.DEC) {
    raDeg  = raToDeg(hdr.RA);
    decDeg = decToDeg(hdr.DEC);
  } else if (hdr.CRVAL1 && hdr.CRVAL2) {
    // Jos WCS‑header antaa suoraan asteina, käytetään sellaisenaan
    raDeg  = +hdr.CRVAL1;
    decDeg = +hdr.CRVAL2;
  }

  // ... (loput metatietojen poiminta pysyy samana) ...

  return {
    // muu metadata …
    raDeg,
    decDeg,
    // …
  };
}

// ISO‑date (YYYY‑MM‑DD[T]hh:mm:ss) → JS‑Date (UTC)
function fitsDateToJS(dateStr) {
  if (dateStr.includes('T')) return new Date(dateStr + 'Z');
  return new Date(dateStr + 'T00:00:00Z');
}

/* --------------------------------------------------------------
   3) WCS‑pixel → taivaankoordinaatti (asteina)
   ------------------------------------------------------------ */
function pixelToWorld(x, y, hdr) {
  const crval1 = +hdr.CRVAL1;
  const crval2 = +hdr.CRVAL2;
  const crpix1 = +hdr.CRPIX1;
  const crpix2 = +hdr.CRPIX2;
  const cd11 = hdr.CD1_1 !== undefined ? +hdr.CD1_1 : (+hdr.CDELT1 || 0);
  const cd12 = hdr.CD1_2 !== undefined ? +hdr.CD1_2 : 0;
  const cd21 = hdr.CD2_1 !== undefined ? +hdr.CD2_1 : 0;
  const cd22 = hdr.CD2_2 !== undefined ? +hdr.CD2_2 : (+hdr.CDELT2 || 0);

  // FITS‑indeksit ovat 1‑pohjaisia → korjaus JavaScriptiin
  const dx = (x + 1) - crpix1;
  const dy = (y + 1) - crpix2;

  const ra  = crval1 + dx * cd11 + dy * cd12;
  const dec = crval2 + dx * cd21 + dy * cd22;
  return { ra, dec };
}

/* --------------------------------------------------------------
   4) Header‑metadata‑kokoelma (halutut arvot)
   ------------------------------------------------------------ */
function extractUsefulHeaderInfo(rawHeader) {
  const hdr = parseFitsHeader(rawHeader);
  // Perusinfo
  const objectName = hdr.OBJECT || '—';
  const dateObs    = parseFitsDate(hdr['DATE-OBS']) ? parseFitsDate(hdr['DATE-OBS']) : null;
  const exposure   = hdr.EXPOSURE ? parseFloat(hdr.EXPOSURE) :
                     (hdr.EXPTIME ? parseFloat(hdr.EXPTIME) : null);

  const telescope = hdr.TELESCOP   || '—';
  const instrument = hdr.INSTRUME  || '—';
  const filter    = hdr.FILTER   || hdr.BANDPASS || '—';
  const emulsion  = hdr.EMULSION || '—';
  const plateID   = hdr.PLATEID  || '—';

  // RA/DEC – useita mahdollisia avaimia
  let raDeg  = null;
  let decDeg = null;
  if (hdr.OBJCTRA && hdr.OBJCTDEC) {
    raDeg  = raToDeg(hdr.OBJCTRA);
    decDeg = decToDeg(hdr.OBJCTDEC);
  } else if (hdr.RA && hdr.DEC) {
    raDeg  = raToDeg(hdr.RA);
    decDeg = decToDeg(hdr.DEC);
  } else if (hdr.CRVAL1 && hdr.CRVAL2) {
    raDeg  = +hdr.CRVAL1;
    decDeg = +hdr.CRVAL2;
  }

  // Pixel‑skaala (arcsec/pixel) – käyttämällä CD‑ tai CDELT‑arvoja
  let pixelScaleArcsec = null;
  if (hdr.CD1_1 && hdr.CD2_2) {
    const a1 = Math.abs(+hdr.CD1_1);
    const a2 = Math.abs(+hdr.CD2_2);
    pixelScaleArcsec = ((a1 + a2) / 2) * 3600;
  } else if (hdr.CDELT1 && hdr.CDELT2) {
    const a1 = Math.abs(+hdr.CDELT1);
    const a2 = Math.abs(+hdr.CDELT2);
    pixelScaleArcsec = ((a1 + a2) / 2) * 3600;
  }

  const airmass = hdr.AIRMASS ? parseFloat(hdr.AIRMASS) : null;

  // Palautetaan “tiivis” info‑objekti
  return {
    objectName,
    dateObs,
    exposure,
    telescope,
    instrument,
    filter,
    emulsion,
    plateID,
    raDeg,
    decDeg,
    pixelScaleArcsec,
    airmass,
    headerRaw: hdr               // jos haluat myöhemmin lvl‑tason tietoja
  };
}

/* --------------------------------------------------------------
   5) UI‑renderöinti: tiivis metatieto‑paneeli
   ------------------------------------------------------------ */
function renderFitsMeta(info) {
  const container = document.getElementById('fitsMeta'); // <div id="fitsMeta"></div>
  if (!container) return;
  console.log(info)
  const html = `
    <div><strong>Kohde:</strong> ${info.objectName}</div>
    <div><strong>Obs. päivä:</strong> ${info.headerRaw.DATE}</div>
    <div><strong>Eksposiitti:</strong> ${info.exposure ? info.exposure + ' s' : '–'}</div>
    <div><strong>Teleskooppi:</strong> ${info.telescope}</div>
    <div><strong>Instrumentti:</strong> ${info.instrument}</div>
    <div><strong>Suodatin:</strong> ${info.filter}</div>
    <div><strong>Emulsio:</strong> ${info.emulsion}</div>
    <div><strong>Plate‑ID:</strong> ${info.plateID}</div>
    <div><strong>RA (deg):</strong> ${info.raDeg ? info.raDeg.toFixed(5) : '–'}</div>
    <div><strong>DEC (deg):</strong> ${info.decDeg ? info.decDeg.toFixed(5) : '–'}</div>
    <div><strong>Pixel‑skaala:</strong> ${info.pixelScaleArcsec ? info.pixelScaleArcsec.toFixed(3) + '″/px' : '–'}</div>
    <div><strong>Airmass:</strong> ${info.airmass ?? '–'}</div>
  `;
  container.innerHTML = html;
}

/* --------------------------------------------------------------
   6) Tähtien nimeäminen (valinnainen SIMBAD‑haku)
   ------------------------------------------------------------ */
async function fetchStarNames(brightPixels, hdr) {
  const nameMap = {};
  for (const p of brightPixels) {
    const { ra, dec } = pixelToWorld(p.x, p.y, hdr);
    // SIMBAD‑kysely: halve‑arc‑minute (0.01 deg) säde riittää
    const query = `https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oxp/SNV?%20${ra}%20${dec}`;
    try {
      const resp = await fetch(`https://cors-anywhere.herokuapp.com/${query}`);
      const txt = await resp.text();
      const nameMatch = txt.match(/<NAME>([^<]+)<\/NAME>/i);
      if (nameMatch) nameMap[`${p.x},${p.y}`] = nameMatch[1];
    } catch (e) {
      console.warn('SIMBAD‑haku epäonnistui pisteelle', p, e);
    }
  }
  return nameMap;
}

/* --------------------------------------------------------------
   7) Piirrä nimi‑/numero‑labelit canvasiin
   ------------------------------------------------------------ */
function renderStarLabels(canvas, brightPixels, hdr, options = {}, nameMap = {}) {
  const ctx = canvas.getContext('2d');

  const cfg = {
    font: '12px sans-serif',
    color: '#ff0',
    offsetX: 6,
    offsetY: -8,
    useNames: false,          // jos true, käyttää nameMap‑arvoja
    ...options
  };

  ctx.font = cfg.font;
  ctx.fillStyle = cfg.color;
  ctx.textBaseline = 'top';
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';

  brightPixels.forEach((p, idx) => {
    const label = cfg.useNames && nameMap[`${p.x},${p.y}`]
        ? nameMap[`${p.x},${p.y}`]
        : `#${idx + 1}`;

    const x = p.x + cfg.offsetX;
    const y = p.y + cfg.offsetY;
    ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
  });
}

// ---------------------------------------------------------------------------
// --------------------------- ANALYSIS / RENDERING -------------------------
async function runFitsAnalysis(headerArray, pixels2D, blob) {
  analyzePixels(pixels2D);

  const histogramResult = drawHistogram(pixels2D);
  if (histogramResult) {
    const { stats, brightPixels, totalPixels } = await analyzeFitsBlob(blob);
    const analysis2 = {
      peakIntensity: stats?.max ?? 0,
      mean: stats?.mean ?? 0,
      std: stats?.std ?? 0,
      tailRatio: 0.1,
      saturationRatio: 0.001,
      backgroundWidth: 15,
      brightPixels,
      totalPixels
    };

    const description2 = describeHistogramSafe(analysis2, headerArray);
    document.getElementById('histogramAnalysis').textContent = description2;
  }

  renderSample(pixels2D);
}

/**
 * Canvas‑renderöijä – parannettu versio.
 * @param {Array|TypedArray} raw          Pikseli‑arvot (flattenattu)
 * @param {number} width
 * @param {number} height
 * @param {HTMLElement} container        Elementti, johon canvas luodaan
 * @param {Object} [options]              Render‑optioita
 */
function renderFloatFitsToCanvasImproved(
  raw,
  width,
  height,
  container,
  options = {}
) {
  // Jos raw on typed‑array, muutetaan se tavalliseksi arrayksi (optio)
  const dataArray = Array.isArray(raw) ? raw : Array.from(raw);

  // 0️⃣ Asetetaan varmistus, että dataa on
  if (dataArray.length === 0) {
    console.warn('Ei kelvollisia pikseleitä – piirretään tyhjä canvas.');
    container.innerHTML = '';
    return;
  }

  // 1️⃣ Oletusparametrit
  const gamma = options.gamma ?? 0.6;
  const lowPercent = options.lowPercent ?? 0.02;
  const highPercent = options.highPercent ?? 0.995;

  // 2️⃣ Percentiilit
  const finiteVals = dataArray.filter(v => Number.isFinite(v));
  const sorted = [...finiteVals].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * lowPercent)];
  const hi = sorted[Math.floor(sorted.length * highPercent)];

  const eps = 1e-12;
  const scale = 1 / (hi - lo + eps);

  // 3️⃣ Canvas‑setup – *TYHJENNETÄÄN VAIN ANNETTU KONTTAINERI*
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const pixels = img.data;

  // 4️⃣ Pixelit (RGBA)
  for (let i = 0; i < dataArray.length; i++) {
    let v = dataArray[i];
    if (!Number.isFinite(v)) v = lo; // korvaa epäkelpo

    v = Math.min(Math.max(v, lo), hi); // leikkaus

    let norm = (v - lo) * scale;
    norm = Math.pow(norm, gamma);      // gamma‑korjaus

    const g = Math.floor(norm * 255);
    const p = i * 4;
    pixels[p] = g;
    pixels[p + 1] = g;
    pixels[p + 2] = g;
    pixels[p + 3] = 255;
  }

  // 5️⃣ Renderöinti
  ctx.putImageData(img, 0, 0);
}

/* ---------- Muita apufunktioita (analyysi, histogrammi, …) ---------- */
function analyzePixels(pixels2D) {
  const flat = pixels2D.flat();
  const n = flat.length;
  let min = Infinity,
    max = -Infinity,
    sum = 0;

  for (const v of flat) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }

  const mean = sum / n;
  const variance =
    flat.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const sorted = [...flat].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const snr = mean / std;

  const stats = document.getElementById('stats');
  stats.innerHTML = `
    <div>Pixels: ${n.toLocaleString()}</div>
    <div>Min: ${min}</div>
    <div>Max: ${max}</div>
    <div>Mean: ${mean.toFixed(2)}</div>
    <div>Std Dev: ${std.toFixed(2)}</div>
    <div>Dynamic Range: ${(max - min)}</div>
    <div>Estimated SNR: ${snr.toFixed(2)}</div>
  `;
}
function drawHistogram(pixels2D) {
  const height = pixels2D.length;
  const width = pixels2D[0].length;
  let min = Infinity,
    max = -Infinity;

  // 1) Etsi min/max
  for (let y = 0; y < height; y++) {
    const row = pixels2D[y];
    for (let x = 0; x < width; x++) {
      const v = row[x];
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const range = max - min || 1;
  const bins = new Uint32Array(256);

  // 2) Histogrammi
  for (let y = 0; y < height; y++) {
    const row = pixels2D[y];
    for (let x = 0; x < width; x++) {
      const v = row[x];
      const idx = Math.floor(((v - min) / range) * 255);
      bins[idx]++;
    }
  }

  // 3) Piirto
  const canvas = document.getElementById('histCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let maxCount = 0;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i] > maxCount) maxCount = bins[i];
  }

  const w = canvas.width / bins.length;
  ctx.fillStyle = '#9fd3ff';
  for (let i = 0; i < bins.length; i++) {
    const h = (bins[i] / maxCount) * canvas.height;
    ctx.fillRect(i * w, canvas.height - h, w, h);
  }
  return { bins, min, max };
}
function analyzeHistogram(bins, min, max) {
  const totalPixels = bins.reduce((a, b) => a + b, 0);
  const binCount = bins.length;
  let peakBin = 0,
    peakValue = 0;

  for (let i = 0; i < binCount; i++) {
    if (bins[i] > peakValue) {
      peakValue = bins[i];
      peakBin = i;
    }
  }

  const peakIntensity =
    min + (peakBin / (binCount - 1)) * (max - min);

  // tail, saturation, background width …
  let tailPixels = 0;
  for (let i = Math.floor(binCount * 0.75); i < binCount; i++) {
    tailPixels += bins[i];
  }
  const tailRatio = tailPixels / totalPixels;
  const saturationRatio = bins[binCount - 1] / totalPixels;

  let backgroundWidth = 0;
  for (let i = 0; i < binCount; i++) {
    if (bins[i] > peakValue * 0.1) backgroundWidth++;
  }

  return {
    peakIntensity: peakIntensity.toFixed(1),
    tailRatio,
    saturationRatio,
    backgroundWidth,
    totalPixels
  };
}
async function analyzeFitsBlob(blob) {
  const { header, pixels2D } = await readFitsBlob(blob);
  const height = pixels2D.length;
  const width = pixels2D[0].length;
  const totalPixels = height * width;

  let sum = 0,
    sumSq = 0,
    min = Infinity,
    max = -Infinity;
  const brightPixels = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = pixels2D[y][x];
      sum += v;
      sumSq += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const mean = sum / totalPixels;
  const std = Math.sqrt(sumSq / totalPixels - mean * mean);
  const threshold = mean + 3 * std;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels2D[y][x] >= threshold) {
        brightPixels.push({ x, y, value: pixels2D[y][x] });
      }
    }
  }

  return {
    header,
    pixels2D,
    stats: { min, max, mean, std, totalPixels },
    brightPixels
  };
}
function describeHistogramSafe(analysis, headerArray) {
  const lines = [];

  const peak = analysis?.peakIntensity ?? 'n/a';
  const mean = analysis?.mean !== undefined ? analysis.mean.toFixed(1) : 'n/a';
  const std = analysis?.std !== undefined ? analysis.std.toFixed(1) : 'n/a';

  lines.push(`Taustataivaan huippu intensiteetissä: ${peak}`);
  lines.push(`Keskimääräinen kirkkaus: ${mean}, std: ${std}`);

  const tailRatio = analysis?.tailRatio ?? 0;
  lines.push(
    tailRatio > 0.05
      ? 'Histogrammissa oikealle ulottuva häntä: kirkkaat kohteet, esim. tähdet tai galaksit.'
      : 'Histogrammi lähes symmetrinen: pääosin taustakohinaa.'
  );

  const saturation = analysis?.saturationRatio ?? 0;
  lines.push(
    saturation > 0.001
      ? 'Kuvassa esiintyy saturaatiota: kirkkaimmat pikselit leikkautuneet.'
      : 'Ei merkittävää saturaatiota.'
  );

  const bgWidth = analysis?.backgroundWidth ?? 0;
  lines.push(
    bgWidth < 20
      ? 'Taustataivas kapea → matala kohinataso.'
      : 'Taustataivas leveä → mahdollinen kohina tai väärä venytys.'
  );

  const brightPixels = analysis?.brightPixels ?? [];
  const totalPixels = analysis?.totalPixels ?? 1;
  if (brightPixels.length > 0) {
    const ratio = ((brightPixels.length / totalPixels) * 100).toFixed(2);
    lines.push(`Kirkkaimpia pikseleitä: ${brightPixels.length} (~${ratio}% kuvasta).`);
    if (ratio > 5) lines.push('Voidaan olettaa useita tähtiä tai galakseja.');
  }

  const bandpass = headerArray?.BANDPASS?.toUpperCase();
  if (bandpass) {
    switch (bandpass) {
      case 'Hα':
        lines.push('Hα‑suodatin: kirkkaat alueet sisältävät todennäköisesti ionisoitunutta vetyä.');
        break;
      case 'OIII':
        lines.push('OIII‑suodatin: kirkkaat alueet viittaavat happi‑ionisoitumiseen.');
        break;
      case 'SII':
        lines.push('SII‑suodatin: kirkkaat alueet viittaavat rikki‑ionisoitumiseen.');
        break;
      default:
        lines.push(`Suodatin ${bandpass}: tarkempaa kemiallista analyysiä ei voida päätellä.`);
    }
  }

  const exptime = parseFloat(headerArray?.EXPTIME);
  if (!isNaN(exptime)) {
    lines.push(
      exptime > 300
        ? `Pitkä altistusaika (${exptime}s) → heikkoja kohteita näkyvissä.`
        : `Lyhyt altistusaika (${exptime}s) → vain kirkkaimmat kohteet näkyvissä.`
    );
  }

  const objName = headerArray?.OBJECT;
  if (objName) lines.push(`Kohde: ${objName}`);

  return lines.join('\n');
}
function renderSample(pixels2D) {
  const sample = pixels2D
    .slice(0, 10)
    .map(row => row.slice(0, 10).join('\t'))
    .join('\n');

  document.getElementById('sampleOutput').textContent = sample;
}

// ==================== FITS READER (frontend) ====================
async function readFitsHeaderFromBlob(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let headerText = '';
  let offset = 0;

  while (true) {
    const card = new TextDecoder('ascii')
      .decode(bytes.slice(offset, offset + 80));
    offset += 80;
    headerText += card;
    if (card.startsWith('END')) break;
  }

  const headerObject = {};
  for (let i = 0; i < headerText.length; i += 80) {
    const card = headerText.slice(i, i + 80);
    const key = card.slice(0, 8).trim();
    const val = card.slice(10).split('/')[0].trim();
    if (key) headerObject[key] = val;
  }
  return headerObject;
}

async function readFitsBlob(blob) {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  let offset = 0;
  const header = {};

  while (true) {
    const card = new TextDecoder('ascii')
      .decode(new Uint8Array(buffer, offset, 80));
    offset += 80;
    const key = card.slice(0, 8).trim();
    const val = card.slice(10).split('/')[0].trim();
    if (key) header[key] = val;
    if (key === 'END') break;
  }

  const headerSize = Math.ceil(offset / 2880) * 2880;
  const width = Number(header.NAXIS1);
  const height = Number(header.NAXIS2);
  const bitpix = Number(header.BITPIX);
  if (!width || !height) throw new Error('Invalid FITS dimensions');

  const count = width * height;
  const raw = new Float32Array(count);
  const dataOffset = headerSize;

  if (bitpix === 16) {
    for (let i = 0; i < count; i++) raw[i] = view.getInt16(dataOffset + i * 2, false);
  } else if (bitpix === 32) {
    for (let i = 0; i < count; i++) raw[i] = view.getInt32(dataOffset + i * 4, false);
  } else if (bitpix === -32) {
    for (let i = 0; i < count; i++) raw[i] = view.getFloat32(dataOffset + i * 4, false);
  } else {
    throw new Error(`Unsupported BITPIX: ${bitpix}`);
  }

  return {
    header,
    width,
    height,
    bitpix,
    pixels2D: reshape2D(raw, width, height),
    raw
  };
}

function reshape2D(flat, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) out.push(flat.slice(y * w, (y + 1) * w));
  return out;
}

function detectSources(image, width, height, noiseStats) {
  const { mean, std } = noiseStats;
  const threshold = mean + 5 * std;

  const sources = [];
  const visited = new Uint8Array(width * height);

  function index(x, y) {
    return y * width + x;
  }

  function floodFill(x0, y0) {
    const stack = [[x0, y0]];
    let sumFlux = 0, sumX = 0, sumY = 0, count = 0;

    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= width || y >= height) continue;

      const i = index(x, y);
      if (visited[i]) continue;
      if (image[i] < threshold) continue;

      visited[i] = 1;
      const flux = image[i];

      sumFlux += flux;
      sumX += x * flux;
      sumY += y * flux;
      count++;

      stack.push([x+1,y], [x-1,y], [x,y+1], [x,y-1]);
    }

    if (count < 5) return null; // poistaa kosmiset säteet

    return {
      x: sumX / sumFlux,
      y: sumY / sumFlux,
      flux: sumFlux,
      pixels: count
    };
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = index(x, y);
      if (!visited[i] && image[i] > threshold) {
        const star = floodFill(x, y);
        if (star) sources.push(star);
      }
    }
  }

  return sources;
}
function aperturePhotometry(image, width, height, star, rA = 4, rIn = 6, rOut = 10) {
  let starFlux = 0;
  let bgFlux = 0;
  let bgCount = 0;

  for (let y = Math.floor(star.y - rOut); y <= star.y + rOut; y++) {
    for (let x = Math.floor(star.x - rOut); x <= star.x + rOut; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;

      const dx = x - star.x;
      const dy = y - star.y;
      const r = Math.sqrt(dx*dx + dy*dy);
      const v = image[y * width + x];

      if (r <= rA) {
        starFlux += v;
      } else if (r >= rIn && r <= rOut) {
        bgFlux += v;
        bgCount++;
      }
    }
  }

  const bgMean = bgCount > 0 ? bgFlux / bgCount : 0;
  const netFlux = starFlux - bgMean * Math.PI * rA * rA;

  return {
    ...star,
    netFlux
  };
}
function buildLightCurves(frames) {
  const curves = {};

  frames.forEach(frame => {
    frame.stars.forEach(star => {
      if (!curves[star.id]) curves[star.id] = [];
      curves[star.id].push({
        time: frame.time,
        flux: star.netFlux
      });
    });
  });

  return curves;
}
function normalizeCurve(curve) {
  const mean = curve.reduce((s,p)=>s+p.flux,0) / curve.length;
  return curve.map(p => ({
    time: p.time,
    flux: p.flux / mean
  }));
}
