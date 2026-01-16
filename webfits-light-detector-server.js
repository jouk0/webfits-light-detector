const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fetch = require('node-fetch');
const fs = require('fs')
const multer = require('multer');
const { PNG } = require('pngjs');
const { Worker } = require('worker_threads');
const { fetchTicStars } = require('./mastTicLookup.js');
const { runFitsPool } = require('./fitsPool');

const {
    fetchWithRetry,
    sendFits,
    buildSources,
    fetchTessFitsUrls
  } = require('./utils');

const app = express();
const PORT = process.env.PORT || 4000;
// Tiedostojen tallennus kansioon 'uploads'
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
// Multerin asetukset
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      // Säilytetään alkuperäinen nimi + timestamp
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
      // Sallitut tiedostotyypit: FITS
      if (file.mimetype === 'application/fits' || file.originalname.endsWith('.fits')) {
        cb(null, true);
      } else {
        cb(new Error('Only FITS files are allowed'));
      }
    },
    limits: { fileSize: 250 * 1024 * 1024 } // max 250 MB
});
// Helmet lisää HTTP-suojausotsikot
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "blob:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // 🔑
        imgSrc: ["'self'", "data:"],
        workerSrc: ["'self'", "blob:"]
      }
    }
  })
);


// Staattiset tiedostot kansiosta "public"
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// 📤 FITS-tiedoston vastaanotto endpoint
app.post('/upload-fits', upload.single('fitsFile'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');
  
    res.json({
      message: 'FITS file uploaded successfully',
      filename: req.file.filename,
      path: req.file.path
    });
});

// -------------------------
// Helper functions
// -------------------------

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}




// -------------------------
// /fits endpoint
// -------------------------

app.get('/fits', async (req, res) => {
  const ra     = req.query.ra   || '43.56';
  const dec    = req.query.dec  || '-19.571';
  const size   = req.query.size || '0.05';

  try {
    const sources = buildSources({ ra, dec, size, stackN: 4 });
    const src = sources[0];
    const urls = await src.getUrls(4);

    // Käynnistetään worker
    const worker = new Worker(path.join(__dirname, 'fitsWorker.js'), {
      workerData: { urls }
    });

    worker.on('message', (msg) => {
      if (msg.success) {
        res.setHeader('Content-Type', 'application/fits');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${src.id}_2x2.fits"`
        );
        res.send(msg.data);
      } else {
        res.status(500).send(`Worker failed: ${msg.error}`);
      }
    });

    worker.on('error', (err) => {
      console.error('Worker error:', err);
      res.status(500).send(`Worker crashed: ${err.message}`);
    });

  } catch (err) {
    console.error(err);
    res.status(500).send(`FITS fetch/stack failed: ${err.message}`);
  }
});

async function fetchTicId(ra, dec) {
  const fetch = global.fetch;
  let returnValue;
  const body = {
    request: {
      service: "Mast.Catalogs.Filtered.Tic",
      format: "json",
      pagesize: 5,
      page: 1,
      params: {
        filters: [
          { paramName: "ra",  values: [{ min: 251.97, max: 251.99 }] },
          { paramName: "dec", values: [{ min: 34.86,  max: 34.88  }] }
        ]
      }
    }
  };

  const res = await fetch("https://mast.stsci.edu/api/v0/invoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body)
  });

  console.log("STATUS:", res.status);
  return await res.json();
}



  
async function fetchTessLightCurveUrls(ticId) {
  const body = {
    request: {
      service: "Mast.Catalogs.Filtered.Tic.LightCurve",
      format: "json",
      params: {
        columns: "tessname,obsid,productFilename,sector",
        filters: [
          { paramName: "tic_id", values: [ticId] }
        ]
      }
    }
  };

  const res = await fetch("https://mast.stsci.edu/api/v0/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TESS light curve search failed: ${res.status}\n${text}`);
  }

  const json = await res.json();

  if (!json.data || !json.data.length) {
    throw new Error("No light curve files found for TICID " + ticId);
  }

  // Luo suora download URL jokaiselle FITS-tiedostolle
  return json.data.map(f => 
    `https://mast.stsci.edu/api/v0.1/Download/file?uri=${f.productFilename}`
  );
}


  

// ===============================
// Time series FITS source builder
// ===============================
function buildTimeSeriesSources({ ra, dec, size, frames }) {
  return {
    id: 'TESS (MAST API)',
    async getUrls() {
      const urls = [];
      const raF = parseFloat(ra);
      const decF = parseFloat(dec);
      const radius = parseFloat(size); // asteina

      for (let i = 0; i < frames; i++) {
        try {
          // 1️⃣ Hae TESS TIC datasta
          const ticUrl = `https://mast.stsci.edu/api/v0.1/Tess/TicPosition?ra=${raF}&dec=${decF}&radius=${radius}`;
          const res = await fetch(ticUrl);

          if (!res.ok) {
            console.warn(`TIC lookup failed (frame ${i}): HTTP ${res.status}`);
            continue;
          }

          const data = await res.json();
          if (!data || !data.length) {
            console.warn(`No TIC objects found for frame ${i}`);
            continue;
          }

          // 2️⃣ Otetaan ensimmäinen löydetty kohde ja haetaan sen FITS-tiedostot
          const ticId = data[0].ID;
          const fitsListUrl = `https://mast.stsci.edu/api/v0.1/Download/file?ID=${ticId}&productType=SCI&format=fits`;
          urls.push(fitsListUrl);

        } catch (err) {
          console.error(`Frame ${i} fetch failed:`, err.message);
        }
      }

      if (urls.length === 0) {
        console.warn('No FITS files could be retrieved for the requested coordinates/frames.');
      }

      return urls;
    }
  };
}

// -------------------------
// /fits endpoint (time series / stack)
// -------------------------
app.get('/fits/timeseries', async (req, res) => {
  const ra = parseFloat(req.query.ra);
  const dec = parseFloat(req.query.dec);
  const size = parseFloat(req.query.size || '0.05');
  const frames = parseInt(req.query.frames || '10', 10);

  if (isNaN(ra) || isNaN(dec)) {
    return res.status(400).send('Missing or invalid RA/DEC');
  }

  if (frames < 10) {
    return res.status(400).send('At least 10 frames required');
  }

  try {
    // 1️⃣ Hae tähdet annettujen koordinaattien ympäriltä
    console.log("fetchTicStars: ", ra, dec, size)
    const starsRaw = await fetchTicStars(ra, dec, size);
    const stars = Array.isArray(starsRaw) ? starsRaw : (starsRaw.data || []);
    console.log("starsRaw:", Object.keys(starsRaw))
    console.log("stars.lenght: ", stars.length)
    // 2️⃣ Ota haluttu määrä frameja
    const selectedStars = stars.slice(0, 10);
    //console.log("selectedStars", selectedStars)
    // 3️⃣ Luo URL-lista jokaiselle tähdelle DSS:stä
    const urls = selectedStars.map(star => {
      const raVal = star.ra || star.RA;
      const decVal = star.dec || star.DEC;
      return `https://archive.stsci.edu/cgi-bin/dss_search?ra=${raVal}&dec=${decVal}&equinox=J2000&height=${size}&width=${size}&format=FITS`;
    });
    console.log("urls: ", urls)
    // 4️⃣ Käynnistä worker, joka hakee ja yhdistää FITS:t
    const result = await runFitsPool(urls);
    const lightCurve = result.flatMap(r => r.lightCurve);

    res.json({
      lightCurve: lightCurve || []
    });

  } catch (err) {
    console.error(err);
    res.status(500).send(`FITS fetch/stack failed: ${err.message}`);
  }
});
async function fetchTicIdFromMAST(ra, dec) {
  const filters = {}
  const body = {
    request: {
      service: "Mast.Catalogs.Filtered.Tic.Position",
      format: "json",
      params: {
        columns: "TICID,RA,DEC,Tmag",
        filters: filters,
        ra: ra,
        dec: dec,
        radius: 0.01,
      }
    }
  };

  const res = await fetch("https://mast.stsci.edu/api/v0/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  return json
}

app.get('/fits/tess', (req, res) => {
  const ra = parseFloat(req.query.ra);
  const dec = parseFloat(req.query.dec);

  const worker = new Worker(path.join(__dirname, 'fitsTessWorker.mjs'), {
    workerData: { ra, dec }
  });

  worker.on('message', msg => {
    if (msg.success) res.json(msg);
    else res.status(500).send(msg.error);
  });

  worker.on('error', err => res.status(500).send(err.message));
});

// Esimerkkireitti JSON-API:lle (tarvittaessa)
app.get('/api/status', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// Kaikki muut pyynnöt ohjataan index.html:ään (SPA varten)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Käynnistä palvelin
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});