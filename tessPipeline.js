const fetch = require('node-fetch');

/**
 * Hakee TESSin LC-tiedot tähtitietokannasta
 * @param {number|string} ticId - Tähden TIC ID
 * @returns {Promise<string[]>} - Lista FITS-URL:eista tai tyhjä jos ei dataa
 */
async function fetchTessLCUrls(ticId) {
  try {
    // 1️⃣ Hae kohteen metatiedot
    const targetUrl = `https://mast.stsci.edu/api/v0.1/Tess/Target?ID=${ticId}`;
    const targetRes = await fetch(targetUrl);
    if (!targetRes.ok) {
      console.warn(`No LC metadata for TIC ${ticId}: ${targetRes.status}`);
      return [];
    }
    const targetData = await targetRes.json();

    // 2️⃣ Tarkista onko LC-dataa
    if (!targetData.sector || targetData.sector.length === 0) {
      console.warn(`TIC ${ticId} has no TESS sectors`);
      return [];
    }

    // 3️⃣ Luo FITS-URL:t jokaiselle sektorille
    const urls = [];
    for (const sector of targetData.sector) {
      // LC FITS tiedosto, sectorin mukaan
      // Huom: Tämä on Mastin "public data products" URL
      const fitsUrl = `https://mast.stsci.edu/api/v0.1/Download/file?uri=mast:TESS/productType=LC/sector=${sector}/tic/${ticId}`;
      urls.push(fitsUrl);
    }

    return urls;
  } catch (err) {
    console.error(`Error fetching TIC ${ticId}:`, err.message);
    return [];
  }
}

/**
 * Hakee useamman tähden LC-urlit
 * @param {Array<{ID: number}>} stars - Lista tähtikohteista
 * @returns {Promise<Object>} - { ticId: [url,...] }
 */
async function fetchMultipleStarsLC(stars) {
  const result = {};
  for (const star of stars) {
    const urls = await fetchTessLCUrls(star.ID);
    result[star.ID] = urls;
  }
  return result;
}