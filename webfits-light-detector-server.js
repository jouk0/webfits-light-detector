const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fetch = require('node-fetch');
const fs = require('fs')
const multer = require('multer');
const {
    fetchWithRetry,
    sendFits,
    buildSources,
  } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;
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
          scriptSrc: ["'self'", "blob:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          workerSrc: ["'self'", "blob:"],
          imgSrc: ["'self'", "data:"]
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
const localFitsPath = path.join(__dirname, 'public/data', 'hi0350021.fits');

// ----------------------------------------------------------------
// /fits endpoint
// ----------------------------------------------------------------
app.get('/fits', async (req, res) => {
  // ----------------------------------------------------------------
  // 1) Parse query parameters (provide sensible defaults)
  // ----------------------------------------------------------------
  const ra   = req.query.ra   || '43.56';
  const dec  = req.query.dec  || '-19.571';
  const size = req.query.size || '0.05';   // degrees, used by all services

  // ----------------------------------------------------------------
  // 2) Build the ordered source list
  // ----------------------------------------------------------------
  const sources = buildSources({ ra, dec, size });

  // ----------------------------------------------------------------
  // 3) Try each source until we succeed
  // ----------------------------------------------------------------
  for (const src of sources) {
    try {
      console.log(`🔎 Trying ${src.id} …`);
      // src.getUrl() may return a simple string or it may do extra HTTP calls.
      const fitsUrl = await src.getUrl();
      console.log(fitsUrl)

      // `fetchWithRetry` returns a **Readable stream**.
      const fitsStream = await fetchWithRetry(fitsUrl, 4, 6_000_000);

      // Pipe straight to the client – we keep the original filename if possible
      const filename = path.basename(new URL(fitsUrl).pathname) || `${src.id}.fits`;
      console.log('sendFits funktio kutsu')
      return sendFits(res, fitsStream, filename);
    } catch (err) {
      console.warn(`❌ ${src.id} failed: ${err.message}`);
      // continue to next source
    }
  }

  // ----------------------------------------------------------------
  // 5) Nothing worked → 500
  // ----------------------------------------------------------------
  res.status(500).send('All FITS fetch attempts failed');
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