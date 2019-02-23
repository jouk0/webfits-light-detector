  
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
  
  // Define callback for when pixels have been read from file
  function createVisualization(arr, opts) {
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
      var threshold = 0.5;
      var image = document.querySelectorAll('#wicked-science-visualization canvas')[0];
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
            || elem.y === (lastY+10)) {
          if(stars[count] instanceof Array) {
            stars[count].push(elem);
          } else {
            stars[count] = [elem];
          }
          if(ind+1 < pixels.length) {
            if((lastY+10) < pixels[ind+1].y || (lastX+10) < pixels[ind+1].x) {
              count++;
              lastY = pixels[ind+1].y;
            }
          }
        }
      });
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
        document.querySelectorAll('div.analysis')[0].appendChild(span);
      });
    };
    
    //drawBoxes();
  }
  
  window.onload = () => {
    
    // Define the path and options
    var path = '/data/hi0280150.fits';
    var opts = {el: 'wicked-science-visualization'};
    
    // Initialize the FITS file, passing the function getImage as a callback
    var FITS = astro.FITS;
    var f = new FITS(path, getImage, opts);
  };