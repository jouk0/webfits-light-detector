const fetch = require('node-fetch');
const qs = require('querystring');

async function fetchTicStars(ra, dec, radius = 0.2) {
  const filters = {};  // vaikka ei suodatuksia
  const requestObj = {
    service: "Mast.Catalogs.Filtered.Tic.Position",
    format: "json",
    params: {
      columns: "TICID,RA,DEC,Tmag",
      filters: filters,
      ra: ra,
      dec: dec,
      radius: radius
    }
  };

  // serialisoidaan objektiksi merkkijonoksi URL-encoded muodossa
  const body = qs.stringify({ request: JSON.stringify(requestObj) });
  console.log(body)
  const res = await fetch('https://mast.stsci.edu/api/v0/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`TIC lookup failed ${res.status}: ${txt}`);
  }

  const data = await res.json();
  return data;
}

module.exports = { fetchTicStars };