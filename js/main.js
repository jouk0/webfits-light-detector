  
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
  function createVisualization(arr, opts) {
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
    const histogram = new Array(256).fill(0);
    for(let i=0; i<data.length; i+=4){
        const val = Math.max(data[i], data[i+1], data[i+2]);
        histogram[val]++;
    }

    const totalPixels = processCanvas.width * processCanvas.height;
    let sum = 0;
    let threshold = 0;
    for(let i=0; i<256; i++){
        sum += histogram[i];
        if(sum > 0.6*totalPixels){
            threshold = i;
            break;
        }
    }

    // Optional log stretch function
    const logStretch = (val) => Math.log(1 + val) / Math.log(1 + 255) * 255;

    // Draw stars directly to analysis canvas
    const outCanvas = document.createElement('canvas');
    outCanvas.width = processCanvas.width;
    outCanvas.height = processCanvas.height;
    analysisContainer.appendChild(outCanvas);
    const outCtx = outCanvas.getContext('2d');

    outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
    outCtx.fillStyle = 'white';

    for(let y=0; y<processCanvas.height; y++){
        for(let x=0; x<processCanvas.width; x++){
            const idx = (y * processCanvas.width + x) * 4;
            let r = data[idx];
            let g = data[idx+1];
            let b = data[idx+2];
            let alpha = data[idx+3];

            // Apply threshold and log stretch
            r = r >= threshold ? logStretch(r) : 0;
            g = g >= threshold ? logStretch(g) : 0;
            b = b >= threshold ? logStretch(b) : 0;

            if((r || g || b) && alpha === 255){
                // Choose dominant color for visualization
                const maxColor = Math.max(r,g,b);
                let color = 'white';
                if(maxColor === r) color = 'rgba(255,0,0,0.6)';
                else if(maxColor === g) color = 'rgba(0,255,0,0.6)';
                else if(maxColor === b) color = 'rgba(0,0,255,0.6)';

                outCtx.fillStyle = color;
                outCtx.fillRect(x, y, 1, 1);
            }
        }
    }

    console.log('Valopikseleiden piirto valmis');
}

  // Define callback for when pixels have been read from file
  function createVisualization_old(arr, opts) {
    var dataunit = opts.dataunit;
    
    var width = dataunit.width;
    var height = dataunit.height;
    var extent = dataunit.getExtent(arr);
    
    // Get the DOM element
    var el = document.querySelector('#' + opts.el);
    
    // Initialize the WebFITS context with a viewer of size width
    var webfits = new astro.WebFITS(el, 512);
    
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
      img.width = 512;
      img.height = 512;
      img.src = imgDataUrl;
      img.style.transform = "rotateY(-360deg)";
      img.style.cssFloat = "left";
      document.querySelectorAll(dest)[0].appendChild(img);
    }
    drawImageFromCanvas('#wicked-science-visualization canvas', 'div.analysis');
    
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
      var whitePixels=0;
      var threshold = 5;
      var image = document.querySelectorAll('#wicked-science-visualization canvas')[0];
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
        var sixtyPercent = pixelsCount*0.6;
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
      /*
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
      */
      pixels.forEach((elem, ind) => {
        let span = document.createElement('span');
        let left = elem.x;
        let top = elem.y;
        let color = ['rgba(255,0,0, 0.5)', 'rgba(0,0,255, 0.5)', 'rgba(0,255,0, 0.5)'];
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
        console.log(colorNmbr);
        span.style.left = left + "px";
        span.style.top = top + "px";
        span.style.width = "1px";
        span.style.height = "1px";
        span.style.border = "1px solid " + color[colorpicker];
        span.style.position = "absolute"
        span.style.borderRadius = "30% 50%";
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
        span.style.borderRadius = "30% 50%";
        //document.querySelectorAll('div.analysis')[0].appendChild(span);
      });
      */
    };
    
    //drawBoxes();
  }
  
  window.onload = () => {
    
    // Define the path and options
    var path = '/data/hi0350021.fits';
    var opts = {el: 'wicked-science-visualization'};
    
    // Initialize the FITS file, passing the function getImage as a callback
    var FITS = astro.FITS;
    var f = new FITS(path, getImage, opts);
  };
