const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

const CPU_COUNT = Math.max(2, os.cpus().length - 1);

function chunkArray(arr, chunks) {
  const out = [];
  const size = Math.ceil(arr.length / chunks);
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function runFitsPool(urls) {
  return new Promise((resolve, reject) => {
    const chunks = chunkArray(urls, CPU_COUNT);
    const results = [];
    let finished = 0;

    for (const chunk of chunks) {
      const worker = new Worker(
        path.resolve(__dirname, 'fitsWorker.cpu.js'),
        { workerData: { urls: chunk } }
      );

      worker.on('message', msg => {
        if (!msg.success) {
          reject(new Error(msg.error));
          return;
        }
        results.push(msg);
        finished++;
        if (finished === chunks.length) {
          resolve(results);
        }
      });

      worker.on('error', reject);
    }
  });
}

module.exports = { runFitsPool };
