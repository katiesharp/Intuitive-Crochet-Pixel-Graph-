// Color quantization + image pixelation utilities.
// Exposed on window for the app script.

(function () {
  // Convert an HTMLImageElement to a downsampled ImageData of width=w, height=h.
  // Optional source rect crops the image before downsampling.
  function pixelate(img, w, h, srcX, srcY, srcW, srcH) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (srcW !== undefined) {
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, w, h);
    } else {
      ctx.drawImage(img, 0, 0, w, h);
    }
    return ctx.getImageData(0, 0, w, h);
  }

  // Map each pixel of imageData to its nearest entry in `palette` (array of [r,g,b]).
  function remapToPalette(imageData, palette) {
    const data = imageData.data;
    const n = imageData.width * imageData.height;
    const k = palette.length;
    const indices = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      let best = Infinity, bestJ = 0;
      for (let j = 0; j < k; j++) {
        const p = palette[j];
        const dr = r - p[0], dg = g - p[1], db = b - p[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < best) { best = d; bestJ = j; }
      }
      indices[i] = bestJ;
    }
    return indices;
  }

  // Simple k-means in RGB space. Returns { palette: [[r,g,b], ...], indices: Uint8Array(w*h) }
  function kmeans(imageData, k, opts = {}) {
    const iterations = opts.iterations || 12;
    const data = imageData.data;
    const n = imageData.width * imageData.height;

    // Build sample array (RGB only, skip transparent pixels by treating them as white).
    const samples = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = data[i * 4 + 3];
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (a < 16) {
        samples[i * 3] = 255; samples[i * 3 + 1] = 255; samples[i * 3 + 2] = 255;
      } else {
        samples[i * 3] = r; samples[i * 3 + 1] = g; samples[i * 3 + 2] = b;
      }
    }

    // Init centroids using k-means++ for stable colors
    const centroids = new Float32Array(k * 3);
    // Pick first centroid deterministically (pixel at index 0)
    centroids[0] = samples[0]; centroids[1] = samples[1]; centroids[2] = samples[2];
    const dist = new Float32Array(n);
    for (let c = 1; c < k; c++) {
      let total = 0;
      for (let i = 0; i < n; i++) {
        let best = Infinity;
        for (let j = 0; j < c; j++) {
          const dr = samples[i * 3] - centroids[j * 3];
          const dg = samples[i * 3 + 1] - centroids[j * 3 + 1];
          const db = samples[i * 3 + 2] - centroids[j * 3 + 2];
          const d = dr * dr + dg * dg + db * db;
          if (d < best) best = d;
        }
        dist[i] = best;
        total += best;
      }
      // Pick proportional to squared distance, but deterministic (use index of max)
      // Mix: use weighted-random with seeded rng for reproducibility across re-quantize.
      let target = (seededRand(c) * total);
      let cum = 0;
      let picked = 0;
      for (let i = 0; i < n; i++) {
        cum += dist[i];
        if (cum >= target) { picked = i; break; }
      }
      centroids[c * 3] = samples[picked * 3];
      centroids[c * 3 + 1] = samples[picked * 3 + 1];
      centroids[c * 3 + 2] = samples[picked * 3 + 2];
    }

    const indices = new Uint8Array(n);
    const sums = new Float32Array(k * 3);
    const counts = new Uint32Array(k);

    for (let iter = 0; iter < iterations; iter++) {
      // Assign
      for (let i = 0; i < n; i++) {
        let best = Infinity, bestJ = 0;
        for (let j = 0; j < k; j++) {
          const dr = samples[i * 3] - centroids[j * 3];
          const dg = samples[i * 3 + 1] - centroids[j * 3 + 1];
          const db = samples[i * 3 + 2] - centroids[j * 3 + 2];
          const d = dr * dr + dg * dg + db * db;
          if (d < best) { best = d; bestJ = j; }
        }
        indices[i] = bestJ;
      }
      // Update
      sums.fill(0); counts.fill(0);
      for (let i = 0; i < n; i++) {
        const j = indices[i];
        sums[j * 3] += samples[i * 3];
        sums[j * 3 + 1] += samples[i * 3 + 1];
        sums[j * 3 + 2] += samples[i * 3 + 2];
        counts[j]++;
      }
      for (let j = 0; j < k; j++) {
        if (counts[j] > 0) {
          centroids[j * 3] = sums[j * 3] / counts[j];
          centroids[j * 3 + 1] = sums[j * 3 + 1] / counts[j];
          centroids[j * 3 + 2] = sums[j * 3 + 2] / counts[j];
        }
      }
    }

    // Build palette as integers, sorted by luminance descending (light → dark)
    const paletteRaw = [];
    for (let j = 0; j < k; j++) {
      paletteRaw.push({
        r: Math.round(centroids[j * 3]),
        g: Math.round(centroids[j * 3 + 1]),
        b: Math.round(centroids[j * 3 + 2]),
        count: counts[j],
        oldIndex: j,
      });
    }
    paletteRaw.sort((a, b) => luminance(b) - luminance(a));

    const remap = new Uint8Array(k);
    paletteRaw.forEach((p, newIdx) => { remap[p.oldIndex] = newIdx; });
    const finalIndices = new Uint8Array(n);
    for (let i = 0; i < n; i++) finalIndices[i] = remap[indices[i]];

    return {
      palette: paletteRaw.map(p => [p.r, p.g, p.b]),
      indices: finalIndices,
      counts: paletteRaw.map(p => p.count),
    };
  }

  function luminance({ r, g, b }) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Mulberry32 seeded RNG so quantization is stable.
  let seed = 1234567;
  function seededRand(salt) {
    let t = (seed + salt * 2654435761) | 0;
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  function rgbToHex(rgb) {
    const [r, g, b] = rgb;
    return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  }
  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  window.PixelQuant = { pixelate, kmeans, remapToPalette, rgbToHex, hexToRgb };
})();
