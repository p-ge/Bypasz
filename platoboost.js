import crypto from "crypto";
import { analyzeCaptchaGif } from "./captcha-solver.js";
const CHROME_VERSIONS = [120, 123, 124, 131, 136];
const IMPERSONATE_UA = {
  120: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  123: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  124: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  131: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  136: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
};
const SCREEN_RESOLUTIONS = [
  [1920, 1080],
  [1366, 768],
  [1536, 864],
  [1440, 900],
  [1280, 720]
];
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}
function getParam(url, param) {
  try {
    const u = new URL(url);
    return u.searchParams.get(param);
  } catch {
    const match = url.match(new RegExp(`[?&]${param}=([^&]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }
}
function encryptCTR(plain, keyStr, ivStr) {
  const key = Buffer.from(keyStr, "utf8").slice(0, 16);
  const iv = Buffer.from(ivStr, "utf8").slice(0, 16);
  const cipher = crypto.createCipheriv("aes-128-ctr", key, iv);
  return Buffer.concat([
    cipher.update(Buffer.from(plain, "utf8")),
    cipher.final()
  ]).toString("hex");
}
function generateStream(ticket) {
  const now = Date.now();
  const clickTime = now - randomInt(80, 400);
  const clickX = randomInt(350, 550);
  const clickY = randomInt(280, 420);
  const events = [
    { event: 1, data: { x: clickX, y: clickY, target: "BUTTON", time: clickTime } },
    { event: 1, data: { x: clickX, y: clickY, target: "BUTTON", time: clickTime } },
    { event: 0, data: { x: clickX + randomInt(-15, 15), y: clickY + randomInt(-15, 15), target: "BUTTON", time: clickTime - randomInt(30, 150) } },
    { event: 5, data: { time: now, length: 0 } }
  ];
  const keyStr = ticket.slice(0, 16);
  const ivStr = ticket.slice(16, 32);
  return encryptCTR(JSON.stringify({ events }), keyStr, ivStr);
}
function buildHeaders(chromeVersion, ticket, extra = {}) {
  const ua = IMPERSONATE_UA[chromeVersion];
  const brandStr = `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not:A-Brand";v="24"`;
  return {
    "User-Agent": ua,
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Sec-CH-UA": brandStr,
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Client-Name": "platoboost webclient",
    "X-Client-Version": "5.3.2",
    "Referer": `https://auth.platorelay.com/${ticket}/`,
    ...extra
  };
}
function buildMeta(ticket, chromeVersion) {
  if (!ticket || ticket.length < 32) return "empty";
  const keyStr = ticket.slice(0, 16);
  const ivStr = ticket.slice(16, 32);
  const [w, h] = randomChoice(SCREEN_RESOLUTIONS);
  const ua = IMPERSONATE_UA[chromeVersion];
  const info = [
    { name: "screen", data: { width: w, height: h, availWidth: w, availHeight: h, colorDepth: 24, pixelDepth: 24, orientation: { type: "landscape-primary", angle: 0 } } },
    {
      name: "navigator",
      data: {
        userAgent: ua,
        platform: "Win32",
        maxTouchPoints: 0,
        plugins: { length: 5, item: [
          { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Microsoft Edge PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "WebKit built-in PDF", filename: "internal-pdf-viewer", description: "Portable Document Format" }
        ] },
        mimeTypes: { length: 2, item: [
          { type: "application/pdf", description: "Portable Document Format", suffixes: "pdf" },
          { type: "text/pdf", description: "Portable Document Format", suffixes: "pdf" }
        ] }
      }
    },
    { name: "performance", data: Date.now() },
    { name: "history", data: { length: randomInt(1, 4) } },
    { name: "webdriver", webdriver: false },
    { name: "connection", data: { effectiveType: "4g", downlink: Math.round(randomFloat(1.5, 10) * 10) / 10, rtt: randomChoice([50, 100, 150, 200]), saveData: false } }
  ];
  try {
    return encryptCTR(JSON.stringify({ browserInfo: info }), keyStr, ivStr);
  } catch {
    return "empty";
  }
}
async function checkKey(ticket, headers, log) {
  try {
    const res = await fetch(`https://auth.platorelay.com/api/session/status?ticket=${ticket}`, { headers });
    const data = await res.json();
    log(`[checkKey] HTTP ${res.status} \u2192 ${JSON.stringify(data).slice(0, 180)}`);
    const inner = data?.data;
    const key = inner?.key;
    if (typeof key === "string" && key !== "KEY_NOT_FOUND" && key.trim().length > 0) return key;
    return null;
  } catch (e) {
    log(`[checkKey] l\u1ED7i: ${String(e)}`);
    return null;
  }
}
async function solveSingleCaptcha(chromeVersion, log, attempt) {
  const ua = IMPERSONATE_UA[chromeVersion];
  const brandStr = `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not:A-Brand";v="24"`;
  const capHeaders = {
    "User-Agent": ua,
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-CH-UA": brandStr,
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Origin": "https://auth.platorelay.com",
    "Referer": "https://auth.platorelay.com/"
  };
  try {
    const chalRes = await fetch("https://captcha.platorelay.com/api/challenge", { headers: capHeaders });
    if (!chalRes.ok) {
      log(`[captcha#${attempt}] challenge HTTP ${chalRes.status}`);
      return null;
    }
    const chalData = await chalRes.json();
    const chalId = chalData.challenge_id;
    const imageRelPath = chalData.image;
    const type = chalData.type ?? "coherence";
    if (!chalId || !imageRelPath) {
      log(`[captcha#${attempt}] bad challenge: ${JSON.stringify(chalData).slice(0, 80)}`);
      return null;
    }
    log(`[captcha#${attempt}] type=${type} id=${chalId.slice(0, 8)}...`);
    const fullImageUrl = `https://captcha.platorelay.com${imageRelPath}`;
    const pt = await analyzeCaptchaGif(fullImageUrl, type, log);
    if (!pt) {
      log(`[captcha#${attempt}] kh\xF4ng ph\xE2n t\xEDch \u0111\u01B0\u1EE3c GIF`);
      return null;
    }
    const ansRes = await fetch("https://captcha.platorelay.com/api/answer", {
      method: "POST",
      headers: { ...capHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_id: chalId, x: Math.round(pt.x), y: Math.round(pt.y) })
    });
    const ansData = await ansRes.json();
    if (ansData.success) {
      log(`[captcha#${attempt}] \u2713 th\xE0nh c\xF4ng`);
      return ansData.token;
    }
    log(`[captcha#${attempt}] sai: ${JSON.stringify(ansData).slice(0, 80)}`);
    return null;
  } catch (e) {
    log(`[captcha#${attempt}] l\u1ED7i: ${String(e)}`);
    return null;
  }
}
async function raceCapthaSolve(chromeVersion, concurrency, log, baseAttempt) {
  return new Promise((resolve) => {
    let done = false;
    let settled = 0;
    for (let i = 0; i < concurrency; i++) {
      solveSingleCaptcha(chromeVersion, log, baseAttempt + i).then((token) => {
        settled++;
        if (token && !done) {
          done = true;
          resolve(token);
        } else if (settled >= concurrency && !done) resolve(null);
      });
    }
  });
}
async function doStep(ticket, hashParam, chromeVersion, headers, meta, captcha, log) {
  const payload = { captcha, meta, stream: generateStream(ticket), resolved: true };
  let stepUrl = `https://auth.platorelay.com/api/session/step?ticket=${ticket}&service=2`;
  if (hashParam) stepUrl += `&hash=${hashParam}`;
  const res = await fetch(stepUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    const text = await res.text().catch(() => "");
    log(`[step] HTTP ${res.status} \u2192 non-JSON: ${text.slice(0, 100)}`);
    return { success: false, _raw: text };
  }
  log(`[step] HTTP ${res.status} \u2192 ${JSON.stringify(data).slice(0, 250)}`);
  return data;
}
async function bypassTicket(ticket, hashParam, chromeVersion, log) {
  const headers = buildHeaders(chromeVersion, ticket);
  const metaPromise = fetch(`https://auth.platorelay.com/api/session/metadata?ticket=${ticket}`, { headers }).then((r) => log(`[meta] HTTP ${r.status}`)).catch((e) => log(`[meta] l\u1ED7i: ${String(e)}`));
  const captchaRacePromise = raceCapthaSolve(chromeVersion, 2, log, 1);
  await metaPromise;
  const meta = buildMeta(ticket, chromeVersion);
  log("Th\u1EED step kh\xF4ng captcha...");
  const d1 = await doStep(ticket, hashParam, chromeVersion, headers, meta, null, log);
  const d1inner = d1?.data;
  if (d1inner?.url) {
    log("B\u01B0\u1EDBc 1 \u2192 loot-link");
    return { lootUrl: d1inner.url };
  }
  const keyNow = await checkKey(ticket, headers, log);
  if (keyNow) return { key: keyNow };
  log("\u0110\u1EE3i captcha t\u1EEB race \u0111ang ch\u1EA1y...");
  const cap1 = await captchaRacePromise;
  if (cap1) {
    log("C\xF3 captcha token (t\u1EEB parallel race), g\u1EEDi step...");
    const freshMeta = buildMeta(ticket, chromeVersion);
    const d2 = await doStep(ticket, hashParam, chromeVersion, headers, freshMeta, cap1, log);
    const d2inner = d2?.data;
    if (d2inner?.url) {
      log("Step \u2192 loot-link");
      return { lootUrl: d2inner.url };
    }
    const keyAfter = await checkKey(ticket, headers, log);
    if (keyAfter) return { key: keyAfter };
  } else {
    log("Captcha race kh\xF4ng th\xE0nh c\xF4ng, th\u1EED th\xEAm...");
  }
  for (let round = 0; round < 3; round++) {
    log(`Captcha round ${round + 2}/4 (2 concurrent)...`);
    const cap = await raceCapthaSolve(chromeVersion, 2, log, (round + 1) * 2 + 1);
    if (!cap) {
      log(`Round ${round + 2} th\u1EA5t b\u1EA1i`);
      continue;
    }
    log("C\xF3 captcha token, g\u1EEDi step...");
    const m = buildMeta(ticket, chromeVersion);
    const d = await doStep(ticket, hashParam, chromeVersion, headers, m, cap, log);
    const di = d?.data;
    if (di?.url) {
      log("Step \u2192 loot-link");
      return { lootUrl: di.url };
    }
    const k = await checkKey(ticket, headers, log);
    if (k) return { key: k };
    const resp = JSON.stringify(d).toLowerCase();
    if (!resp.match(/captcha|complete|verify/)) {
      log("Kh\xF4ng c\xF2n c\u1EA7n captcha");
      break;
    }
  }
  const finalKey = await checkKey(ticket, headers, log);
  if (finalKey) return { key: finalKey };
  return { error: "Kh\xF4ng qua \u0111\u01B0\u1EE3c step sau t\u1EA5t c\u1EA3 l\u1EA7n th\u1EED" };
}
async function bypassPlatoboost(url, onLog, preloadedTicket2Url) {
  const ticket = getParam(url, "d");
  const hashParam = getParam(url, "hash");
  if (!ticket) return { success: false, error: "URL kh\xF4ng h\u1EE3p l\u1EC7, thi\u1EBFu tham s\u1ED1 'd'" };
  onLog(`Ticket: ${ticket.slice(0, 20)}... | Hash: ${hashParam ?? "kh\xF4ng c\xF3"}`);
  const chromeVersion = randomChoice(CHROME_VERSIONS);
  onLog(`Chrome v${chromeVersion}`);
  const headers = buildHeaders(chromeVersion, ticket);
  onLog("Ki\u1EC3m tra key + kh\u1EDFi \u0111\u1ED9ng bypass song song...");
  const [existing] = await Promise.all([
    checkKey(ticket, headers, onLog)
  ]);
  if (existing) {
    onLog("Key \u0111\xE3 c\xF3!");
    return { success: true, key: existing };
  }
  let bypassedUrl = null;
  if (preloadedTicket2Url) {
    onLog(`\u{1F517} D\xF9ng Loot URL do user cung c\u1EA5p \u2014 b\u1ECF qua b\u01B0\u1EDBc lootlabs`);
    bypassedUrl = preloadedTicket2Url.trim();
  } else {
    onLog("B\u1EAFt \u0111\u1EA7u bypass...");
    const step1 = await bypassTicket(ticket, hashParam, chromeVersion, onLog);
    if (step1.key) return { success: true, key: step1.key };
    if (step1.error && !step1.lootUrl) return { success: false, error: step1.error };
    if (!step1.lootUrl) return { success: false, error: "Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c loot-link" };
    onLog(`Loot-link: ${step1.lootUrl.slice(0, 80)}...`);
    const lootDomain = (() => {
      try {
        return new URL(step1.lootUrl).hostname;
      } catch {
        return "";
      }
    })();
    onLog(`\u0110ang bypass loot-link (${lootDomain}) natively...`);
    if (lootDomain.includes("lootlabs.gg")) {
      try {
        const { bypassLootLabsPuppeteer } = await import("./lootlabs-puppeteer.js");
        bypassedUrl = await bypassLootLabsPuppeteer(step1.lootUrl, onLog);
      } catch (e) {
        onLog(`[lootlabs] puppeteer kh\xF4ng kh\u1EA3 d\u1EE5ng: ${String(e)}, th\u1EED API...`);
      }
      if (!bypassedUrl) {
        const { bypassLootLabs } = await import("./lootlink.js");
        bypassedUrl = await bypassLootLabs(step1.lootUrl, onLog);
      }
    } else if (lootDomain.includes("loot.link")) {
      const { bypassLootLink } = await import("./lootlink.js");
      bypassedUrl = await bypassLootLink(step1.lootUrl, onLog);
    } else if (lootDomain.includes("work.ink")) {
      const { bypassWorkInk } = await import("./lootlink.js");
      bypassedUrl = await bypassWorkInk(step1.lootUrl, onLog);
    } else if (lootDomain.includes("boost.ink")) {
      const { bypassBoostInk } = await import("./lootlink.js");
      bypassedUrl = await bypassBoostInk(step1.lootUrl, onLog);
    } else if (lootDomain.includes("linkvertise")) {
      const { bypassLinkvertise } = await import("./lootlink.js");
      bypassedUrl = await bypassLinkvertise(step1.lootUrl, onLog);
    } else {
      onLog(`[loot] domain kh\xF4ng nh\u1EADn ra: ${lootDomain}, th\u1EED fetch tr\u1EF1c ti\u1EBFp...`);
      try {
        const r = await fetch(step1.lootUrl, {
          headers: { "User-Agent": IMPERSONATE_UA[chromeVersion] },
          redirect: "follow"
        });
        const text = await r.text();
        const m = text.match(/https?:\/\/auth\.platorelay\.com\/[^\s"'<]+/);
        if (m) bypassedUrl = m[0];
      } catch {
      }
    }
    if (!bypassedUrl) return { success: false, error: `Kh\xF4ng bypass \u0111\u01B0\u1EE3c loot-link (${lootDomain}) \u2014 th\u1EED d\xF9ng service kh\xE1c l\u1EA5y URL ticket2 r\u1ED3i paste v\xE0o \xF4 "Loot URL"` };
  }
  onLog(`Loot bypassed \u2192 ${bypassedUrl.slice(0, 80)}`);
  const ticket2 = getParam(bypassedUrl, "d");
  const hash2 = getParam(bypassedUrl, "hash");
  if (!ticket2) return { success: false, error: "Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c ticket t\u1EEB loot-link" };
  onLog(`Ticket 2: ${ticket2.slice(0, 20)}...`);
  const headers2 = buildHeaders(chromeVersion, ticket2);
  const [key2immediate, step2Result] = await Promise.all([
    checkKey(ticket2, headers2, onLog),
    bypassTicket(ticket2, hash2, chromeVersion, onLog)
  ]);
  if (key2immediate) return { success: true, key: key2immediate };
  if (step2Result.key) return { success: true, key: step2Result.key };
  const finalKey = await checkKey(ticket2, headers2, onLog);
  if (finalKey) return { success: true, key: finalKey };
  return { success: false, error: step2Result.error ?? "Bypass ho\xE0n t\u1EA5t nh\u01B0ng kh\xF4ng t\xECm th\u1EA5y key" };
}
export {
  bypassPlatoboost
};
