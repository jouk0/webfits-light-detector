// ==================== main.js ====================
// WebFITS-light-detector – refactored frontend controller
// Vastuu: data → analyysi → renderöinti (EI parsintaa kahteen kertaan)

// -------------------- DOM --------------------
const btn = document.getElementById('fetch-btn');
const canvasContainer = document.getElementById('canvas-container');
const headerContainer = document.getElementById('fitsHeader');

// -------------------- CONFIG --------------------
/** Globaalit renderöintiasetukset – käytetään kaikkialla */
const RENDER_OPTIONS = {
  gamma: 0.6,
  lowPercent: 0.05,
  highPercent: 0.995
};

// -------------------- HELPERS --------------------
function randomCutoutParams() {
  const ra = (Math.random() * 360).toFixed(5);
  const dec = (Math.random() * 180 - 90).toFixed(5);
  const size = 60; // degrees
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
    const url = `/fits?ra=${ra}&dec=${dec}&size=${size}&stack=1&mode=raw`;

    console.log('FITS request:', url);

    // 2️⃣ Fetch
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    console.log('FITS blob size:', blob.size);
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
    // 3️⃣ Header
    const headerData = await readFitsHeaderFromBlob(blob);
    renderFitsHeader(headerData, headerContainer);   // <-- yksi renderöinti

    // 4️⃣ Data
    const { pixels2D, width, height, bitpix } = await readFitsBlob(blob);

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

    // 6️⃣ Renderöinti (Canvas)
    // Käytetään globaalia RENDER_OPTIONS‑objektia, eikä luoda uutta
    renderFloatFitsToCanvasImproved(
      raw,
      width,
      height,
      canvasContainer,
      RENDER_OPTIONS
    );

    console.log('FITS valmis');

    let pageElements = document.querySelectorAll('.page')
    pageElements.forEach((page) => {
      page.classList.add('active')
    })
  } catch (err) {
    console.error('FITS fetch / render failed:', err);
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Hae FITS';
  }
};

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
