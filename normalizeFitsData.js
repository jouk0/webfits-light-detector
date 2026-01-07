function normalizeFitsData(data, lowPct = 0.01, highPct = 0.99) {
    const clean = Array.from(data).filter(v => isFinite(v));
    clean.sort((a, b) => a - b);
  
    const lo = clean[Math.floor(clean.length * lowPct)];
    const hi = clean[Math.floor(clean.length * highPct)];
    const range = hi - lo || 1;
  
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      let v = (data[i] - lo) / range;
      if (v < 0) v = 0;
      if (v > 1) v = 1;
      out[i] = v;
    }
  
    return out;
  }
  
  module.exports = normalizeFitsData;
  