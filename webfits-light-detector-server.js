const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fetch = require('node-fetch');
const fs = require('fs')
const multer = require('multer');
const { PNG } = require('pngjs');
const { Worker } = require('worker_threads');
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
  if (isNaN(width) || isNaN(height)) {
    throw new Error(`Invalid width/height: width=${width}, height=${height}`);
  }
  if (!data || data.length !== width * height) {
    throw new Error(`Data length mismatch: expected ${width * height}, got ${data ? data.length : 0}`);
  }

  const cards = [];

  function card(k, v) {
    return (k.padEnd(8) + '= ' + v.toString().padEnd(70)).slice(0, 80);
  }

  // Käydään alkuperäinen header läpi ja lisätään kaikki kortit
  for (const [k, v] of Object.entries(header)) {
    if (k === 'END') continue; // lopetetaan loppukortti lisätään myöhemmin
    cards.push(card(k, v));
  }

  // Pakollinen END-kortti FITS:iin
  cards.push(card('END', ''));

  // Täytetään 2880-byte lohkot
  let headerBlock = cards.join('');
  const pad = 2880 - (headerBlock.length % 2880);
  headerBlock += ' '.repeat(pad);

  const headerBuffer = Buffer.from(headerBlock, 'ascii');

  const dataBuffer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    dataBuffer.writeFloatBE(data[i], i * 4);
  }

  return Buffer.concat([headerBuffer, dataBuffer]);
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