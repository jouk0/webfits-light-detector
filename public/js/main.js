const FITS = astro.FITS;
  // Define callback to be executed after image is received from the server
  function getImage(f, opts) {
    
    // Get first data unit
    var dataunit = f.getDataUnit();
    
    // Set options to pass to the next callback
    opts = {
      dataunit: dataunit,
      el: opts.el
    };
    // Asynchronously get pixels representing the image passing a callback and options
    dataunit.getFrame(0, createVisualization, opts);
  }
  function createVisualization_new(arr, opts) {
    const dataunit = opts.dataunit;
    const width = dataunit.width;
    const height = dataunit.height;
    const extent = dataunit.getExtent(arr);

    // Get the DOM elements
    const container = document.querySelector('#' + opts.el);
    const analysisContainer = document.querySelector('div.analysis');

    // Initialize WebFITS
    const webfits = new astro.WebFITS(container, 512);
    webfits.setupControls();
    webfits.loadImage('some-identifier', arr, width, height);
    webfits.setExtent(extent[0], extent[1]);
    webfits.setStretch('linear');

    // Draw WebFITS canvas to another canvas for processing
    const sourceCanvas = container.querySelector('canvas');
    const processCanvas = document.createElement('canvas');
    processCanvas.width = sourceCanvas.width;
    processCanvas.height = sourceCanvas.height;
    const ctx = processCanvas.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);

    const imgData = ctx.getImageData(0, 0, processCanvas.width, processCanvas.height);
    const data = imgData.data;

    // Calculate histogram and threshold for 60% dynamic black removal
    // Luo kaikki valot pikseliarvoista
    let vals = [];
    for(let i=0; i<data.length; i+=4){
        vals.push(Math.max(data[i], data[i+1], data[i+2]));
    }
    vals.sort((a,b)=>a-b);

    // Otetaan 5% pienin arvo mustaksi
    const threshold = vals[Math.floor(vals.length*0.05)];

    // Optional log stretch function
    function logStretch_old(val, max=255){
      return Math.log(1 + val) / Math.log(1 + max) * 255;
    }
    function logStretch(val, scale=1000){
      return Math.asinh(val/scale)/Math.asinh(65535/scale)*255;
  }

    // Draw stars directly to analysis canvas
    const outCanvas = document.createElement('canvas');
    outCanvas.width = processCanvas.width;
    outCanvas.height = processCanvas.height;
    analysisContainer.appendChild(outCanvas);
    const outCtx = outCanvas.getContext('2d');

    outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
    outCtx.fillStyle = 'white';
    /* -------------- 1. Paletin määrittely ----------------- */
    const PALETTE = [
      // R,   G,   B   –   nimi (luettavuuden vuoksi)
      [255,   0,   0], // punainen
      [255, 165,   0], // oranssi
      [255, 255,   0], // keltainen
      [  0, 255,   0], // vihreä
      [  0, 255, 255], // syaani
      [  0,   0, 255], // sininen
      [139,   0, 255], // violetti
      [255,   0, 255], // magenta
      [255, 105, 180], // hot pink
      [255, 192, 203], // pinkki
      [  0, 128, 128], // teal
      [128, 128,   0], // oliivinvihreä
      [255, 255, 255]  // valkoinen (varmistaa, ettei mikään “palaa” mustaksi)
    ];

    /* -------------- 2. Dominanssin laskenta ----------------- */
    // Funktio palauttaa värin indeksinä 0‑(PALETTE.length‑1).  
    // Se valitsee värin sen perusteella, mikä kanava on suurin ja 
    // kuinka lähellä kanavat ovat toisiaan (pieni toleranssi = sekoitusväri). 
    function pickPaletteColor(r, g, b) {
      // Normalisoidaan 0‑255 → 0‑1 jotta vertailut ovat helpompia
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn);
      const min = Math.min(rn, gn, bn);
      const diff = max - min;               // Kuinka ”puhdas” väri on

      // Jos diff on hyvin pieni → harmaa/valkoinen
      if (diff < 0.05) return PALETTE.length - 1; // viimeinen = valkoinen

      // Yksinkertainen heuristiikka:  
      //   0 = punainen, 1 = oranssi, 2 = keltainen, 3 = vihreä, … jne.
      if (max === rn) {
        // punainen on hallitseva – katsotaan G:n ja B:n suhdetta
        if (gn > bn) return 1;               // punainen + vihreä → oranssi
        else          return 7;               // punainen + sininen → magenta
      }
      if (max === gn) {
        if (bn > rn) return 4;               // vihreä + sininen → syaani
        else          return 2;               // vihreä + punainen → keltainen
      }
      // max === bn
      if (rn > gn) return 7;                  // sininen + punainen → magenta
      else          return 4;                  // sininen + vihreä → syaani
    }

    /* -------------- 3. Päivittynyt renderöintisilmukka ----------------- */
    for (let y = 0; y < processCanvas.height; y++) {
      for (let x = 0; x < processCanvas.width; x++) {
        const idx = (y * processCanvas.width + x) * 4;
        let r = data[idx];
        let g = data[idx + 1];
        let b = data[idx + 2];
        const alpha = data[idx + 3];

        // Threshold + log‑stretch
        r = r >= threshold ? logStretch(r) : 0;
        g = g >= threshold ? logStretch(g) : 0;
        b = b >= threshold ? logStretch(b) : 0;

        if ((r || g || b) && alpha === 255) {
          const paletteIdx = pickPaletteColor(r, g, b);
          const [pr, pg, pb] = PALETTE[paletteIdx];
          outCtx.fillStyle = `rgba(${pr},${pg},${pb},1)`;
          outCtx.fillRect(x, y, 1, 1);
        }
      }
    }


    console.log('Valopikseleiden piirto valmis');
}
function createVisualization_updated(arr, opts) {
  const dataunit = opts.dataunit;
  const width = dataunit.width;
  const height = dataunit.height;
  const extent = dataunit.getExtent(arr);

  // DOM-elementit
  const container = document.querySelector('#' + opts.el);
  const analysisContainer = document.querySelector('div.analysis');
  container.innerHTML = '';
  analysisContainer.innerHTML = '';

  // WebFITS-renderointi
  const webfits = new astro.WebFITS(container, 512);
  webfits.setupControls();
  webfits.loadImage('fits-image', arr, width, height);
  webfits.setExtent(extent[0], extent[1]);
  webfits.setStretch('linear');

  // Ota WebFITS-canvas talteen
  const sourceCanvas = container.querySelector('canvas');
  const ctx = sourceCanvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const data = imgData.data;

  // --- Paletti ---
  const PALETTE = [
    [255, 0, 0],       // punainen
    [255, 127, 0],     // oranssi
    [255, 255, 0],     // keltainen
    [127, 255, 0],     // lime
    [0, 255, 0],       // vihreä
    [0, 255, 127],     // syaani
    [0, 255, 255],     // cyan
    [0, 127, 255],     // vaaleansininen
    [0, 0, 255],       // sininen
    [127, 0, 255],     // violetti
    [255, 0, 255],     // magenta
    [255, 0, 127],     // pinkki
    [255, 255, 255]    // valkoinen / harmaa
  ];

  function pickPaletteColor(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    if (max - min < 0.05) return PALETTE.length - 1;

    let hue;
    if (max === rn) hue = 60 * ((gn - bn) / (max - min));
    else if (max === gn) hue = 60 * ((bn - rn) / (max - min)) + 120;
    else hue = 60 * ((rn - gn) / (max - min)) + 240;

    if (hue < 0) hue += 360;
    return Math.floor(hue / (360 / (PALETTE.length - 1)));
  }

  // --- Threshold laskenta ---
  let vals = [];
  for (let i = 0; i < data.length; i += 4) {
    vals.push(Math.max(data[i], data[i + 1], data[i + 2]));
  }
  vals.sort((a, b) => a - b);
  const threshold = vals[Math.floor(vals.length * 0.05)];

  // --- Uusi canvas analyysille ---
  const outCanvas = document.createElement('canvas');
  outCanvas.width = sourceCanvas.width;
  outCanvas.height = sourceCanvas.height;
  analysisContainer.appendChild(outCanvas);
  const outCtx = outCanvas.getContext('2d');
  outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);

  // --- Piirretään pikselit ---
  let pixels = [];
  for (let y = 0; y < sourceCanvas.height; y++) {
    for (let x = 0; x < sourceCanvas.width; x++) {
      const idx = (y * sourceCanvas.width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
      if ((r >= threshold || g >= threshold || b >= threshold) && a === 255) {
        pixels.push({ x, y, r, g, b });
      }
    }
  }

  // --- Piirrä jokainen pikseli monivärisellä paletilla ---
  pixels.forEach(p => {
    const paletteIdx = pickPaletteColor(p.r, p.g, p.b);
    const [pr, pg, pb] = PALETTE[paletteIdx];
    const span = document.createElement('span');
    span.style.left = p.x + "px";
    span.style.top = p.y + "px";
    span.style.width = "1px";
    span.style.height = "1px";
    span.style.position = "absolute";
    span.style.border = `1px solid rgba(${pr},${pg},${pb},0.7)`;
    span.style.borderRadius = "30% 50%";
    span.style.boxSizing = "border-box";
    analysisContainer.appendChild(span);
  });

  console.log(`Visualisointi valmis: ${pixels.length} valopikseliä`);
}

  // Define callback for when pixels have been read from file
  function createVisualization(arr, opts) {
    var dataunit = opts.dataunit;
    
    var width = dataunit.width;
    var height = dataunit.height;
    var extent = dataunit.getExtent(arr);
    
    // Get the DOM element
    var el = document.querySelector('#' + opts.el);
    
    // Initialize the WebFITS context with a viewer of size width
    var webfits = new astro.WebFITS(el, width);
    
    // Add pan and zoom controls
    webfits.setupControls();
    
    // Load array representation of image
    webfits.loadImage('some-identifier', arr, width, height);
    
    // Set the intensity range and stretch
    webfits.setExtent(extent[0], extent[1]);
    webfits.setStretch('linear');
    var drawImageFromCanvas = (source, dest) => {
      var imgDataUrl = document.querySelectorAll(source)[0].toDataURL();
      var img = document.createElement('img');
      img.width = width;
      img.height = height;
      img.src = imgDataUrl;
      //img.style.transform = "rotateY(-360deg)";
      img.style.cssFloat = "left";
      document.querySelectorAll(dest)[0].appendChild(img);
    }
    drawImageFromCanvas('#canvas-container canvas', 'div.analysis');
    
    Caman('img', function () {
      let that = this;
      //that.brightness(50);
      //that.contrast(1900);
      //this.sepia(60);
      //this.saturation(30);
      that.render(() => {
            drawBoxes();
      });
    });
    let drawBoxes = () => {
      var whitePixels = 0;
      var threshold = 2;
      var image = document.querySelectorAll('#canvas-container canvas')[0];
      var pixelsThreshold = [];
      var pixelsCount = 0;
      for(var y=0; y<image.height; y++){
        for(var x=0; x<image.width; x++){
          var data = image.getContext('2d').getImageData(x, y, 1, 1).data;
          data.forEach((elem, ind) => {
            (pixelsThreshold[elem]) ? pixelsThreshold[elem].push(elem) : pixelsThreshold[elem] = [elem];
            pixelsCount++;
          });
        }
      }
        var sixtyPercent = pixelsCount*0.7355;
        var thresholdCount = 0;
        pixelsThreshold.forEach((elem, ind) => {
            if(thresholdCount < sixtyPercent) {
                thresholdCount += elem.length;
                threshold = ind;
            }
        });
        threshold += 1;
      var pixels = [];
      for(var y=0; y<image.height; y++){
        for(var x=0; x<image.width; x++){
          var data = image.getContext('2d').getImageData(x, y, 1, 1).data;
          var red = data[0];
          var green = data[1];
          var blue = data[2];
          var alpha = data[3];

          // Is other than black?
          if((red >= threshold && green >= threshold && blue >= threshold) && alpha === 255){
            whitePixels++;
            pixels.push({
              x: x,
              y: y,
              data: data
            });
          }
        }
      }
      let lastX = 0;
      let lastY = 0;
      let stars = [];
      let count = 0;
      
      pixels.forEach((elem, ind) => {
        if(lastX === 0 && lastY === 0) {
          lastX = elem.x;
          lastY = elem.y;
        }
        if(lastY === elem.y 
            || elem.y === (lastY+1) 
            || elem.y === (lastY+2) 
            || elem.y === (lastY+3) 
            || elem.y === (lastY+4) 
            || elem.y === (lastY+5) 
            || elem.y === (lastY+6)
            || elem.y === (lastY+7)
            || elem.y === (lastY+8)
            || elem.y === (lastY+9)
            || elem.y === (lastY+10)
            || elem.y === (lastY+11)
            || elem.y === (lastY+12)
            || elem.y === (lastY+13)
            || elem.y === (lastY+14)
            || elem.y === (lastY+15)
            || elem.y === (lastY+16)
            || elem.y === (lastY+17)
            || elem.y === (lastY+18)) {
          if(stars[count] instanceof Array) {
            stars[count].push(elem);
          } else {
            stars[count] = [elem];
          }
          if(ind+1 < pixels.length) {
            if((lastY+18) < pixels[ind+1].y || (lastX+18) < pixels[ind+1].x) {
              count++;
              lastY = pixels[ind+1].y;
            }
          }
        }
      });
      pixels.forEach((elem, ind) => {
        let span = document.createElement('span');
        let left = elem.x;
        let top = elem.y;
        let color = ['rgba(255,0,0, 0.5)', 'rgba(0,255,0, 0.5)', 'rgba(0,0,255, 0.5)'];
        let colorArr = [elem.data[0],elem.data[1],elem.data[2]];
        var colorNmbr = colorArr.reduce(function(a, b) {
            return Math.max(a, b);
        });
        var colorpicker = 0;
        colorArr.forEach((elem, ind) => {
            if(elem === colorNmbr) {
                colorpicker = ind;
            }
        });
        span.style.left = left + "px";
        span.style.top = top + "px";
        span.style.width = "1px";
        span.style.height = "1px";
        span.style.border = "1px solid white";
        span.style.position = "absolute"
        span.style.borderRadius = "50%";
        span.style.boxSizing = "border-box"
        document.querySelectorAll('div.analysis')[0].appendChild(span);
      });
      /*
      stars.forEach((elem, ind) => {
        let span = document.createElement('span');
        let left = 0;
        let top = 0;
        elem.forEach((elem2, ind2) => {
          if(left === 0 && top === 0) {
            left = elem2.x;
            top = elem2.y;
          }
          if(left > elem2.x) {
            left = elem2.x;
          }
          if(top > elem2.y) {
            top = elem2.y;
          }
        });

        span.style.left = left - 5 + "px";
        span.style.top = top - 5 + "px";
        span.style.width = "10px";
        span.style.height = "10px";
        span.style.border = "1px solid rgba(255,255,255, 0.5)";
        span.style.position = "absolute"
        span.style.borderRadius = "50%";
        document.querySelectorAll('div.analysis')[0].appendChild(span);
      });
      */
    };
    
    //drawBoxes();
  }

  const btn = document.getElementById('fetch-btn');
  // Funktio kuvan lataamiseen ja uploadiin
  async function fetchNewFITS() {


  const canvas = document.querySelectorAll('#fits-canvas')[0];
  const ctx = canvas.getContext('2d');
    // Satunnainen koordinaatti
    const ra = (Math.random() * 360).toFixed(3);
    const dec = ((Math.random() * 180) - 90).toFixed(3);

    const url_new = `/fits?ra=${ra}&dec=${dec}&size=0.08`;
    try {
      // Hae FITS-tiedosto
      const response = await fetch(url_new);
      const blob = await response.blob();

      // 1️⃣ Lataa FITS-kirjastolla ja anna createVisualization käsitellä data
      const f = new astro.FITS(blob, getImage, { el: 'canvas-container' });

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
        console.log('Upload successful:', data.filename);
        var opts = {el: 'canvas-container'};
        var final = new FITS('/uploads/' + data.filename, getImage, opts);
      }

    } catch (e) {
      console.error('FITS-kuvan lataus epäonnistui', e);
    }
  }

  

  //btn.addEventListener('click', fetchNewFITS);
  /**
   * Palauta satunnaisesti generoitu RA, Dec ja koko, jotka täyttävät
   * IRSA‑/MAST‑palveluiden vaatimukset.
   *
   * @returns {{ra:string, dec:string, size:string}}  // kaikki merkkijonoja (URL‑valmiita)
   */
  function randomCutoutParams() {
    // RA: 0 ≤ RA < 360, 3 desimaalia
    const raNum = Math.random() * 360;
    const ra = (raNum >= 359.9995 ? 0 : raNum).toFixed(3);
  
    // Dec: -89.999 < Dec < +89.999
    const decNum = (Math.random() * 180) - 90;
    const dec = (Math.abs(decNum) >= 89.9995
        ? (decNum > 0 ? 89.999 : -89.999)
        : decNum).toFixed(3);
  
    // Suurempi koko ~512×512 pikseliä varten (WISE ~0.4–0.5 deg)
    const sizeNum = 15 + Math.random() * 0.1;  // 0.40–0.50 deg
    const size = sizeNum.toFixed(3);
  
    return { ra, dec, size };
  }  

  async function fetchAndShow() {
    // -------------- satunnaiset koordinaatit ---------
    const { ra, dec, size } = randomCutoutParams();
    const url = `/fits?ra=${ra}&dec=${dec}&size=${size}`;

    // -------------- Hae FITS‑tiedosto ----------------------
    const resp   = await fetch(url);
    if (!resp.ok) { console.error('fetch error →', resp.status); return; }
    const blob   = await resp.blob();
    const buffer = await blob.arrayBuffer();          // ← muutetaan ArrayBufferiksi

    // -------------- Parsaa FITS ja renderöi ---------------
    new astro.FITS(blob, getImage, { el: 'canvas-container' });
  }

  function onFitsReady(fits) {
    try {
      const du = fits.getDataUnit();
      console.log('DataUnit:', du);
  
      if (!du || !du.width || !du.height) {
        console.error('Invalid DataUnit');
        return;
      }
  
      const width  = du.width;
      const height = du.height;
  
      // ⚠️ getFrame käyttää callbackia
      du.getFrame(0, function (pixels) {
        if (!pixels) {
          console.error('No pixel data returned');
          return;
        }
  
        if (pixels.length !== width * height) {
          console.error(
            'Pixel buffer size mismatch',
            pixels.length,
            'expected',
            width * height
          );
          return;
        }
  
        const [min, max] = du.getExtent(pixels);
  
        const container = document.getElementById('canvas-container');
        if (!container) {
          console.error('#canvas-container missing');
          return;
        }
  
        container.innerHTML = '';
  
        const webfits = new astro.WebFITS(container, Math.max(width, height));
        webfits.setupControls();
        webfits.loadImage('fits', pixels, width, height);
        webfits.setExtent(min, max);
        webfits.setStretch('linear');
  
        console.log(
          `Rendered FITS image ${width}x${height}, bitpix=${du.bitpix}`
        );
      });
  
    } catch (err) {
      console.error('FITS processing failed:', err);
    }
  }
  

  
  
  
 

  // ---- UI‑tapahtuma ----
  //btn.addEventListener('click', fetchAndShow);

  // ==== 0️⃣  Määrittele UI‑elementit globaalisti tai funktiossa ====
// Progress‑bar elementti (HTML‑puolella <progress id="prog"></progress>)
const prog = document.getElementById('prog');

// KANVA‑kontti, johon WebFITS piirtää
const canvasContainer = document.getElementById('canvas-container');
function parseFitsHeader(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const textDecoder = new TextDecoder('ascii');

  let headerText = '';
  for (let i = 0; i < bytes.length; i += 2880) { // FITS header-block on 2880 tavua
      const block = bytes.slice(i, i + 2880);
      const blockText = textDecoder.decode(block);
      headerText += blockText;

      if (blockText.includes('END')) {
          break; // header loppuu tähän
      }
  }

  // Muunna rivit avain-arvo pareiksi
  const lines = headerText.match(/.{1,80}/g); // jokainen rivi 80 merkkiä
  const header = {};
  lines.forEach(line => {
      const key = line.substring(0, 8).trim();
      const value = line.substring(10, 80).trim();
      if (key && value) {
          header[key] = value.replace(/\/.*$/, '').trim(); // poista kommentit
      }
  });

  return header;
}

function readFitsHeaderFromBlob(blob) {
  return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function(e) {
          const arrayBuffer = e.target.result;
          const header = parseFitsHeader(arrayBuffer);
          resolve(header);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
  });
}
function readFitsBlob(blob) {
  return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function(e) {
          const arrayBuffer = e.target.result;
          const bytes = new Uint8Array(arrayBuffer);
          const textDecoder = new TextDecoder('ascii');

          // 1. Parsaa header
          let headerText = '';
          let offset = 0;
          while (offset < bytes.length) {
              const block = bytes.slice(offset, offset + 2880);
              const blockText = textDecoder.decode(block);
              headerText += blockText;
              offset += 2880;
              if (blockText.includes('END')) break;
          }

          const lines = headerText.match(/.{1,80}/g);
          const header = {};
          lines.forEach(line => {
              const key = line.substring(0, 8).trim();
              const value = line.substring(10, 80).trim();
              if (key && value) {
                  header[key] = value.replace(/\/.*$/, '').trim(); // poista kommentit
              }
          });

          // 2. Tarkista tärkeimmät header-arvot
          const bitpix = parseInt(header.BITPIX);
          const naxis1 = parseInt(header.NAXIS1);
          const naxis2 = parseInt(header.NAXIS2);
          if (!bitpix || !naxis1 || !naxis2) {
              reject('FITS header puuttuu oleellisia arvoja.');
              return;
          }

          // 3. Lue data
          // FITS tallentaa dataa BIG ENDIAN muodossa
          const dataOffset = offset; // data alkaa heti headerin jälkeen
          const pixelCount = naxis1 * naxis2;
          let pixelArray;

          if (bitpix === 16) {
              pixelArray = new Int16Array(pixelCount);
              for (let i = 0; i < pixelCount; i++) {
                  const hi = bytes[dataOffset + i * 2];
                  const lo = bytes[dataOffset + i * 2 + 1];
                  pixelArray[i] = (hi << 8) | lo;
              }
          } else if (bitpix === 32) {
              pixelArray = new Int32Array(pixelCount);
              for (let i = 0; i < pixelCount; i++) {
                  const b0 = bytes[dataOffset + i * 4];
                  const b1 = bytes[dataOffset + i * 4 + 1];
                  const b2 = bytes[dataOffset + i * 4 + 2];
                  const b3 = bytes[dataOffset + i * 4 + 3];
                  pixelArray[i] = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
              }
          } else {
              reject('BITPIX ei ole tuettu. Tällä hetkellä tuettu: 16 tai 32.');
              return;
          }

          // 4. Muunna 2D-taulukoksi
          const pixels2D = [];
          for (let y = 0; y < naxis2; y++) {
              const row = [];
              for (let x = 0; x < naxis1; x++) {
                  row.push(pixelArray[y * naxis1 + x]);
              }
              pixels2D.push(row);
          }

          resolve({ header, pixels2D });
      };

      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
  });
}

btn.onclick = async () => {
  try {
    // ----------- 1️⃣ Satunnainen koordinaatti ----------------
    const { ra, dec, size } = randomCutoutParams();
    const url = `/fits?ra=${ra}&dec=${dec}&size=${size}`;

    // ----------- 2️⃣ Hae FITS blob ----------------------------
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    readFitsHeaderFromBlob(blob).then(header => {
      console.log(header);
    });
    let pixels2DStored;
    readFitsBlob(blob).then(async ({ header, pixels2D }) => {
      console.log('FITS header:', header);
      console.log('Pikselien 2D-taulukko:', pixels2D);

      // ----------- 3️⃣ Tyhjennä canvas-container ---------------
      const container = document.getElementById('canvas-container');
      container.innerHTML = '';

      // ----------- 4️⃣ Luo FITS-olio ja anna getImage käsitellä ---
      const fits = new astro.FITS(blob, getImage, { el: 'canvas-container' });
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
      if (uploadResponse.ok) {
        console.log('FITS kuva tallennettu.')
      }
      // Esim: ensimmäinen pikseli
      console.log('Top-left pixel:', pixels2D[0][0]);
    }).catch(err => {
      console.error('Virhe FITS-tiedoston lukemisessa:', err);
    });
  } catch (err) {
    console.error('FITS fetch / render failed:', err);
  }
};



  window.onload = () => {
    
    // Define the path and options
    var path = '/data/hi0350021.fits';
    var opts = {el: 'wicked-science-visualization'};
    
    // Initialize the FITS file, passing the function getImage as a callback
    var FITS = astro.FITS;
    //var f = new FITS(path, getImage, opts);
    //fetchNewFITS();
    //fetchAndShow();
  };
