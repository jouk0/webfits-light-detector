// ==================== utils.js ====================

const axios = require('axios');

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
   Build FITS image sources (STABLE ONLY)
-------------------------------------------------- */
function buildSources({ ra, dec, size }) {
  /* ---------------- DSS (Digitized Sky Survey) ---------------- */
  const dss = {
    id: 'DSS (Digitized Sky Survey)',
    async getUrl() {
      return (
        'https://archive.stsci.edu/cgi-bin/dss_search' +
        `?ra=${ra}` +
        `&dec=${dec}` +
        `&equinox=J2000` +
        `&height=${size}` +
        `&width=${size}` +
        `&format=FITS`
      );
    },
  };

  /* ---------------- SkyView (NASA GSFC) ---------------- */
  const skyview = {
    id: 'SkyView (NASA)',
    async getUrl() {
      return (
        'https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl' +
        `?Position=${ra},${dec}` +
        `&Survey=DSS` +
        `&Size=${size}` +
        `&Return=FITS`
      );
    },
  };

  /* ---------------- IRSA (WISE / NEOWISE) ---------------- */
  const irsa = {
    id: 'IRSA (WISE/NEOWISE)',
    async getUrl() {
      return (
        'https://irsa.ipac.caltech.edu/ibe/search/wise/neowiser/p1bm_img' +
        `?POS=${ra},${dec}` +
        `&SIZE=${size}` +
        `&BAND=2` +
        `&FORMAT=FITS`
      );
    },
  };

  /* ---------------- NOIRLab SIA (DES / DECam) ---------------- */
  const noirlab = {
    id: 'NOIRLab SIA (DES)',
    async getUrl() {
      return (
        'https://datalab.noirlab.edu/sia/des_dr2' +
        `?POS=${ra},${dec}` +
        `&SIZE=${size}` +
        `&FORMAT=image/fits`
      );
    },
  };

  /*
    Käytännössä toimiva järjestys:
    - DSS: lähes aina dataa
    - SkyView: fallback eri surveyilla
    - IRSA: infrapuna
    - NOIRLab: jos sattuu
  */
  return [dss, skyview, irsa, noirlab];
}

/* --------------------------------------------------
   Exports
-------------------------------------------------- */
module.exports = {
  fetchWithRetry,
  sendFits,
  buildSources,
};
