import { GifReader } from "omggif";
function composeFrames(buf) {
  const reader = new GifReader(new Uint8Array(buf));
  const { width, height } = reader;
  const n = reader.numFrames();
  const frames = [];
  const canvas = new Uint8Array(width * height * 4);
  for (let i = 0; i < n; i++) {
    reader.decodeAndBlitFrameRGBA(i, canvas);
    frames.push({ pixels: new Uint8Array(canvas), width, height });
  }
  return frames;
}
function brightness(pix, idx) {
  return (pix[idx] + pix[idx + 1] + pix[idx + 2]) / 3;
}
function lkFlow(prev, curr, width, x0, y0, x1, y1) {
  let A11 = 0, A12 = 0, A22 = 0, b1 = 0, b2 = 0;
  for (let y = y0 + 1; y < y1 - 1; y++) {
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const idx = (y * width + x) * 4;
      const It = brightness(curr, idx) - brightness(prev, idx);
      const Ix = (brightness(prev, (y * width + x + 1) * 4) - brightness(prev, (y * width + x - 1) * 4)) / 2;
      const Iy = (brightness(prev, ((y + 1) * width + x) * 4) - brightness(prev, ((y - 1) * width + x) * 4)) / 2;
      A11 += Ix * Ix;
      A12 += Ix * Iy;
      A22 += Iy * Iy;
      b1 -= Ix * It;
      b2 -= Iy * It;
    }
  }
  const det = A11 * A22 - A12 * A12;
  if (Math.abs(det) < 0.5) return { u: 0, v: 0 };
  return { u: (A22 * b1 - A12 * b2) / det, v: (A11 * b2 - A12 * b1) / det };
}
function solveCoherence(frames) {
  const { width, height } = frames[0];
  const CELL = 30;
  const STEP = 15;
  const results = [];
  for (let gy = 0; gy + CELL <= height; gy += STEP) {
    for (let gx = 0; gx + CELL <= width; gx += STEP) {
      const x0 = gx, y0 = gy, x1 = gx + CELL, y1 = gy + CELL;
      const us = [], vs = [];
      const step = Math.max(1, Math.floor(frames.length / 12));
      for (let fi = 1; fi < frames.length; fi += step) {
        const { u, v } = lkFlow(frames[fi - 1].pixels, frames[fi].pixels, width, x0, y0, x1, y1);
        us.push(u);
        vs.push(v);
      }
      if (us.length < 2) continue;
      const meanU = us.reduce((s, x) => s + x, 0) / us.length;
      const meanV = vs.reduce((s, x) => s + x, 0) / vs.length;
      const speed = Math.sqrt(meanU ** 2 + meanV ** 2);
      const varU = us.reduce((s, x) => s + (x - meanU) ** 2, 0) / us.length;
      const varV = vs.reduce((s, x) => s + (x - meanV) ** 2, 0) / vs.length;
      const std = Math.sqrt(varU + varV);
      const score = speed > 0.3 ? speed / (std + 0.3) : 0;
      results.push({ cx: x0 + CELL / 2, cy: y0 + CELL / 2, score });
    }
  }
  if (results.length === 0) {
    return maxMotionPixel(frames);
  }
  results.sort((a, b) => b.score - a.score);
  return { x: results[0].cx, y: results[0].cy };
}
function maxMotionPixel(frames) {
  const { width, height } = frames[0];
  const totalMotion = new Float32Array(width * height);
  for (let fi = 1; fi < frames.length; fi++) {
    const prev = frames[fi - 1].pixels, curr = frames[fi].pixels;
    for (let i = 0; i < width * height; i++) {
      const pi = i * 4;
      totalMotion[i] += (Math.abs(curr[pi] - prev[pi]) + Math.abs(curr[pi + 1] - prev[pi + 1]) + Math.abs(curr[pi + 2] - prev[pi + 2])) / 3;
    }
  }
  let maxM = 0, bx = width / 2, by = height / 2;
  for (let i = 0; i < totalMotion.length; i++) {
    if (totalMotion[i] > maxM) {
      maxM = totalMotion[i];
      bx = i % width;
      by = Math.floor(i / width);
    }
  }
  return { x: bx, y: by };
}
function pixelHue(r, g, b) {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf), d = max - min;
  if (d < 0.2) return null;
  let h = 0;
  if (max === rf) h = ((gf - bf) / d + 6) % 6;
  else if (max === gf) h = (bf - rf) / d + 2;
  else h = (rf - gf) / d + 4;
  return h;
}
function getHueCentroids(pix, width, height, minPix = 20) {
  const BUCKET = 1 / 3;
  const bins = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = pix[i], g = pix[i + 1], b = pix[i + 2], a = pix[i + 3];
      if (a < 100) continue;
      const bright = (r + g + b) / 3;
      if (bright < 25 || bright > 230) continue;
      const h = pixelHue(r, g, b);
      if (h === null) continue;
      const key = (Math.floor(h / BUCKET) * BUCKET).toFixed(2);
      if (!bins[key]) bins[key] = { sx: 0, sy: 0, n: 0 };
      bins[key].sx += x;
      bins[key].sy += y;
      bins[key].n++;
    }
  }
  return Object.entries(bins).filter(([, v]) => v.n >= minPix).map(([k, v]) => ({ hue: parseFloat(k), cx: v.sx / v.n, cy: v.sy / v.n, n: v.n })).sort((a, b) => b.n - a.n);
}
function hueDist(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 6 - d);
}
function angularAnalysis(path) {
  const meanX = path.reduce((s, p) => s + p.x, 0) / path.length;
  const meanY = path.reduce((s, p) => s + p.y, 0) / path.length;
  const radius = path.reduce((s, p) => s + Math.sqrt((p.x - meanX) ** 2 + (p.y - meanY) ** 2), 0) / path.length;
  const angles = path.map((p) => Math.atan2(p.y - meanY, p.x - meanX));
  let totalAngle = 0;
  for (let i = 1; i < angles.length; i++) {
    let da = angles[i] - angles[i - 1];
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    totalAngle += da;
  }
  return { totalAngle, radius };
}
function solveDriftodd(frames) {
  const { width, height } = frames[0];
  const rawSeeds = getHueCentroids(frames[0].pixels, width, height, 20);
  const seeds = [];
  for (const s of rawSeeds) {
    const tooClose = seeds.some((d) => Math.sqrt((d.cx - s.cx) ** 2 + (d.cy - s.cy) ** 2) < 20);
    if (!tooClose) seeds.push(s);
    if (seeds.length >= 6) break;
  }
  if (seeds.length === 0) return { x: width / 2, y: height / 2 };
  const tracks = seeds.map((s) => ({
    hue: s.hue,
    path: [{ x: s.cx, y: s.cy }]
  }));
  for (let fi = 1; fi < frames.length; fi++) {
    const clusters = getHueCentroids(frames[fi].pixels, width, height, 5);
    for (const track of tracks) {
      let best = null, bestDist = Infinity;
      for (const c of clusters) {
        const hd = hueDist(c.hue, track.hue);
        if (hd < 1 && hd < bestDist) {
          bestDist = hd;
          best = c;
        }
      }
      const prev = track.path[track.path.length - 1];
      track.path.push(best ? { x: best.cx, y: best.cy } : { ...prev });
    }
  }
  const analyzed = tracks.map((t) => {
    const { totalAngle, radius } = angularAnalysis(t.path);
    const mid = t.path[Math.floor(t.path.length / 2)];
    return { hue: t.hue, totalAngle, radius, mid };
  });
  const moving = analyzed.filter((a) => a.radius > 3 && Math.abs(a.totalAngle) > 0.8);
  if (moving.length < 2) {
    const largest = analyzed.sort((a, b) => b.radius - a.radius)[0];
    return largest ? largest.mid : { x: width / 2, y: height / 2 };
  }
  const cwBlobs = moving.filter((m) => m.totalAngle < -0.5);
  const ccwBlobs = moving.filter((m) => m.totalAngle > 0.5);
  let oddBlob = moving[0];
  if (cwBlobs.length > ccwBlobs.length && ccwBlobs.length > 0) {
    oddBlob = ccwBlobs.sort((a, b) => b.totalAngle - a.totalAngle)[0];
  } else if (ccwBlobs.length > cwBlobs.length && cwBlobs.length > 0) {
    oddBlob = cwBlobs.sort((a, b) => a.totalAngle - b.totalAngle)[0];
  } else {
    oddBlob = moving.sort((a, b) => Math.abs(b.totalAngle) - Math.abs(a.totalAngle))[0];
  }
  return oddBlob.mid;
}
async function analyzeCaptchaGif(gifUrl, type, log) {
  try {
    const res = await fetch(gifUrl);
    if (!res.ok) {
      log(`[captcha-gif] HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    log(`[captcha-gif] GIF ${buf.length}B`);
    const frames = composeFrames(buf);
    log(`[captcha-gif] ${frames.length}fr ${frames[0].width}x${frames[0].height}`);
    if (frames.length < 2) return null;
    const pt = type === "driftodd" ? solveDriftodd(frames) : solveCoherence(frames);
    log(`[captcha-gif] type=${type} \u2192 (${Math.round(pt.x)}, ${Math.round(pt.y)})`);
    return pt;
  } catch (e) {
    log(`[captcha-gif] l\u1ED7i: ${String(e)}`);
    return null;
  }
}
export {
  analyzeCaptchaGif
};
