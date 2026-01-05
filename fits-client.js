// fits-client.js – osittainen, MAST‑osio
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const progress = require('progress-stream');

const MAST_SEARCH_URL = 'https://mast.stsci.edu/api/v0.1/Download/search';

/**
 * Hakee MAST‑arkistosta FITS‑tiedostoja ja lataa ne.
 *
 * @param {Object} opts
 *   target      – kohde (esim. "M31" tai "10.684 41.269")
 *   radius      – hakukaario (esim. "0.02 deg")
 *   instrument  – instrumentti (esim. "ACS", "WFC3", "TESS")
 *   max         – ladattavien tiedostojen määrä (default 5)
 *   outDir      – minne tiedostot tallennetaan (default "./mast_fits")
 */
async function mastSearchAndDownload(opts) {
  const {
    ra = ra,
    dec = null,
    target = 'M31',
    radius = '0.02 deg',
    instrument = 'ACS',
    max = 5,
    outDir = path.resolve('mast_fits')
  } = opts;

  await fs.ensureDir(outDir);

  // 1️⃣ Rakennetaan JSON‑kysely
  const payload = {
    service: 'Mast.Caom.Cone',
    params: {
      ra: ra,   // jos 'target' on koordinaatti‑merkkijono, annetaan eksplitit auttaavat funktiot
      dec: dec,
      radius: radius,
      // 'filters' kenttä käyttää MASTin SQL‑tyyliä
      filters: [`INSTRUMENT_NAME eq '${instrument}'`]
    },
    format: 'json',
    pagesize: max
  };

  // Jos target on koordinattipari ("10.684 41.269") käytetään sitä, muutoin tehdään nimihaku
  if (/^[\d.\-+]+\s+[\d.\-+]+$/.test(target)) {
    const [ra, dec] = target.trim().split(/\s+/).map(Number);
    payload.params.ra = ra;
    payload.params.dec = dec;
  } else {
    // Nimeä haetaan ensin koordinaatiksi (voimme käyttää MASTin name‑resolveria)
    const resolverURL = `https://catalogs.mast.stsci.edu/api/v0.1/name_resolve?object=${encodeURIComponent(target)}`;
    const r = await axios.get(resolverURL);
    if (r.data && r.data.data && r.data.data[0]) {
      const { ra, dec } = r.data.data[0];
      payload.params.ra = ra;
      payload.params.dec = dec;
    } else {
      throw new Error(`Ei pystytty ratkaisemaan kohdetta "${target}"`);
    }
  }

  // 2️⃣ Lähetetään POST‑kysely
  const searchRes = await axios.post(MAST_SEARCH_URL, payload, { maxRedirects: 5 });
  if (!searchRes.data || !searchRes.data.data) {
    throw new Error('Virheellinen haku‑vastaus');
  }

  const hits = searchRes.data.data;
  if (hits.length === 0) {
    console.log('⚠️  Ei hakutuloksia.');
    return;
  }

  console.log(`🔎  Löytyi ${hits.length} kohtaa – ladataan enintään ${max} FITS‑tiedostoa.`);

  // 3️⃣ Lataus‑silmukka
  for (let i = 0; i < Math.min(max, hits.length); i++) {
    const entry = hits[i];
    const url = entry.dataURL;          // suora FITS‑URL (yleensä https://…/download/file?...)

    // Tiedostonimen tyyli on usein "obsid_producttype.fits"
    const filename = path.basename(new URL(url).pathname) || `mast_${i}.fits`;
    const destPath = path.join(outDir, filename);

    // Jos tiedosto on jo paikalla, ohitetaan.
    if (await fs.pathExists(destPath)) {
      console.log(`✅  Tiedosto jo olemassa: ${filename}`);
      continue;
    }

    // 3️⃣1️⃣ Asetetaan stream‑tiedostolataus progress‑indikaattorilla
    const resp = await axios.get(url, { responseType: 'stream' }, { maxRedirects: 5 });
    const totalBytes = Number(resp.headers['content-length']) || null;
    const progressBar = progress({
      length: totalBytes,
      time: 500
    });

    progressBar.on('progress', p => {
      const pct = (p.transferred / (p.length || 1) * 100).toFixed(1);
      process.stdout.write(`📥  ${filename} – ${pct}% (${(p.transferred / (1024 * 1024)).toFixed(2)} MiB)\r`);
    });

    const writer = fs.createWriteStream(destPath);
    resp.data.pipe(progressBar).pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`\n✅  Tallennettu ${filename}`);
        resolve();
      });
      writer.on('error', reject);
    });
  }

  console.log('🎉  Kaikki MAST‑tiedostot ladattu kansioon:', outDir);
}

// Exportataan moduuliksi
module.exports = { mastSearchAndDownload };
