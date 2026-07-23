import { createCipheriv, createHash, randomBytes } from "crypto";
import WebSocket from "ws";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
function transformUuid(uuid) {
  const upper = [...uuid].filter((c) => c >= "A" && c <= "Z");
  const keyStr = upper.slice(0, 4).join("") || "KEY1";
  const uuidBytes = Buffer.from(uuid, "utf8");
  const keyBytes = Buffer.from(keyStr, "utf8");
  const xor = Buffer.alloc(uuidBytes.length);
  for (let i = 0; i < uuidBytes.length; i++) xor[i] = uuidBytes[i] ^ keyBytes[i % keyBytes.length];
  return xor.toString("base64");
}
function buildBotdPayload(sessionUuid) {
  const transformed = transformUuid(sessionUuid);
  const aesKey = createHash("sha256").update(transformed).digest();
  const iv = randomBytes(12);
  const timestamp = Date.now();
  const nonce = Math.floor(Math.random() * 3e3) + 1;
  const timeVal = Math.floor(Math.random() * 5e3) + 100;
  const botd = {
    bot: false,
    timestamp,
    webGLSolution: { uuid: sessionUuid, nonce, time: timeVal }
  };
  const plaintext = Buffer.from(JSON.stringify(botd), "utf8");
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, encrypted, tag]);
  return JSON.stringify({ ...botd, encrypted: combined.toString("base64") });
}
function decryptWsPayload(encoded) {
  const buf = Buffer.from(encoded, "base64");
  const key = buf.slice(0, 5);
  const data = buf.slice(5);
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % 5];
  return out.toString("utf8").trim();
}
function parseCdnTidKey(html) {
  const cdn = (html.match(/p\['CDN_DOMAIN'\]\s*=\s*'([^']+)'/) ?? html.match(/CDN_DOMAIN['":\s]+([^'"\s,;]+)/))?.[1];
  const tid = (html.match(/p\['TID'\]\s*=\s*(\d+)/) ?? html.match(/TID['":\s]+(\d+)/))?.[1];
  const key = (html.match(/p\['KEY'\]\s*=\s*"([^"]+)"/) ?? html.match(/KEY['":\s]+"([^"]+)"/))?.[1];
  const isLLBS = /p\['TIER_ID'\]/.test(html) || /p\['NUM_OF_TASKS'\]/.test(html);
  if (!cdn || !tid || !key) return null;
  return { cdn, tid, key, isLLBS };
}
async function fetchCdnParams(cdn, tid) {
  try {
    const r = await fetch(`https://${cdn}/?tid=${tid}&params_only=1`, {
      headers: { "User-Agent": UA, "Accept": "*/*" }
    });
    const text = await r.text();
    const inner = text.trim().replace(/^[\s(]+/, "").replace(/[);]+$/, "");
    let arr = null;
    try {
      arr = JSON.parse(`[${inner}]`);
    } catch {
    }
    if (!arr || arr.length < 30) return null;
    const wsDomain = typeof arr[9] === "string" ? arr[9] : null;
    const tcDomain = typeof arr[29] === "string" ? arr[29] : null;
    if (!wsDomain || !tcDomain) return null;
    return { tcDomain, wsDomain };
  } catch {
    return null;
  }
}
function wsConnect(wsDomain, urid, taskId, key, sessionId, isLLBS, tid, cookies, log, timeoutMs = 21e4) {
  return new Promise((resolve) => {
    const url = `wss://${wsDomain}/c?uid=${urid}&cat=${taskId}&key=${key}&session_id=${sessionId}&is_loot=${isLLBS}&tid=${tid}`;
    log(`[lootlabs] WS \u2192 ${url.slice(0, 100)} (timeout=${timeoutMs / 1e3}s)`);
    let done = false;
    const finish = (val) => {
      if (!done) {
        done = true;
        resolve(val);
      }
    };
    const timer = setTimeout(() => {
      log(`[lootlabs] WS timeout ${timeoutMs / 1e3}s`);
      finish(null);
    }, timeoutMs);
    let ws;
    try {
      ws = new WebSocket(url, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          "Cookie": cookies,
          "Origin": `https://${wsDomain.split(".").slice(1).join(".")}`
        }
      });
    } catch (e) {
      log(`[lootlabs] WS init error: ${String(e)}`);
      clearTimeout(timer);
      resolve(null);
      return;
    }
    ws.on("open", () => {
      ws.send("0");
    });
    let pingInterval;
    ws.on("open", () => {
      pingInterval = setInterval(() => {
        if (!done) ws.send("0");
      }, 3e3);
    });
    ws.on("message", (data) => {
      const msg = typeof data === "string" ? data : data.toString();
      log(`[lootlabs] WS msg: ${msg.slice(0, 80)}`);
      if (msg.startsWith("r:")) {
        clearTimeout(timer);
        clearInterval(pingInterval);
        ws.close();
        try {
          const result = decryptWsPayload(msg.slice(2));
          log(`[lootlabs] WS \u2713 result: ${result.slice(0, 100)}`);
          finish(result);
        } catch (e) {
          log(`[lootlabs] WS decrypt error: ${String(e)}`);
          finish(null);
        }
      }
    });
    ws.on("error", (e) => {
      log(`[lootlabs] WS error: ${String(e)}`);
      clearTimeout(timer);
      clearInterval(pingInterval);
      finish(null);
    });
    ws.on("close", () => {
      clearTimeout(timer);
      clearInterval(pingInterval);
      finish(null);
    });
  });
}
async function bypassLootLabs(rawUrl, log) {
  log(`[lootlabs] target: ${rawUrl.slice(0, 100)}`);
  let html = "";
  let cookies = "";
  try {
    const res = await fetch(rawUrl, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    log(`[lootlabs] GET page \u2192 HTTP ${res.status}`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    cookies = setCookie.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
    html = await res.text();
  } catch (e) {
    log(`[lootlabs] page fetch error: ${String(e)}`);
    return null;
  }
  const uuidMatch = html.match(/document\.session\s*=\s*['"]([^'"]+)['"]/);
  if (!uuidMatch) {
    log("[lootlabs] session UUID not found in page HTML");
    return null;
  }
  const sessionUuid = uuidMatch[1];
  log(`[lootlabs] session UUID: ${sessionUuid}`);
  const cdnInfo = parseCdnTidKey(html);
  if (!cdnInfo) {
    log("[lootlabs] CDN/TID/KEY not found in HTML");
    return null;
  }
  log(`[lootlabs] CDN=${cdnInfo.cdn} TID=${cdnInfo.tid} isLLBS=${cdnInfo.isLLBS}`);
  const cdnParams = await fetchCdnParams(cdnInfo.cdn, cdnInfo.tid);
  if (!cdnParams) {
    log("[lootlabs] CDN params fetch failed");
    return null;
  }
  log(`[lootlabs] tcDomain=${cdnParams.tcDomain} wsDomain=${cdnParams.wsDomain}`);
  fetch(`https://${new URL(rawUrl).hostname}/verify`, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", "Referer": rawUrl, "Cookie": cookies },
    body: JSON.stringify({ session: sessionUuid })
  }).catch(() => {
  });
  const botdPayload = buildBotdPayload(sessionUuid);
  const sessionId = String(Math.floor(Math.random() * 9e17) + 1e17);
  const cookieId = String(Math.floor(Math.random() * 9e8) + 1e8);
  const tcBody = {
    tid: parseInt(cdnInfo.tid, 10),
    bl: [10],
    session: sessionId,
    max_tasks: 1,
    design_id: 139,
    cur_url: rawUrl,
    doc_ref: "",
    num_of_tasks: "",
    is_loot: cdnInfo.isLLBS,
    rkey: cdnInfo.key,
    cookie_id: cookieId,
    botd: botdPayload,
    botds: sessionUuid,
    offer: "0",
    tier_id: 4,
    taboola_user_sync: "",
    fid: -1,
    clid: crypto.randomUUID(),
    additional_info: {},
    allow_unlocker: true,
    desktop_design: 0,
    show_unlocker: true,
    test_unlocker_app: -1,
    unlocker_only: 0
  };
  log(`[lootlabs] POST /tc \u2192 ${cdnParams.tcDomain}`);
  let urid = "";
  let taskId = 0;
  let autoCompleteSeconds = 180;
  try {
    const tcRes = await fetch(`https://${cdnParams.tcDomain}/tc`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Cookie": `ci=${Math.floor(Math.random() * 9e15) + 1e15}`
      },
      body: JSON.stringify(tcBody)
    });
    log(`[lootlabs] /tc \u2192 HTTP ${tcRes.status}`);
    if (tcRes.status === 428) {
      log("[lootlabs] /tc 428 \u2014 botd rejected");
      return null;
    }
    if (!tcRes.ok) {
      log(`[lootlabs] /tc non-200`);
      return null;
    }
    const tcData = await tcRes.json();
    const entry = Array.isArray(tcData) ? tcData[0] : tcData;
    urid = entry?.urid ?? "";
    taskId = entry?.task_id ?? 0;
    const actionPixelUrl = entry?.action_pixel_url ?? "";
    autoCompleteSeconds = entry?.auto_complete_seconds ?? 180;
    log(`[lootlabs] urid=${urid} taskId=${taskId} autoComplete=${autoCompleteSeconds}s pixel=${actionPixelUrl.slice(0, 50)}`);
    if (actionPixelUrl) {
      const pixelFull = actionPixelUrl.startsWith("//") ? `https:${actionPixelUrl}` : actionPixelUrl;
      fetch(pixelFull, { headers: { "User-Agent": UA, "Referer": rawUrl } }).catch(() => {
      });
    }
    fetch(
      `https://enaightdecipie.com/?event=task_clicked&session_id=${taskId}&info=1`,
      { headers: { "User-Agent": UA } }
    ).catch(() => {
    });
    for (let i = 0; i < 3; i++) {
      fetch(`https://${i}.${cdnParams.wsDomain}/st?uid=${urid}&cat=${taskId}`, {
        method: "POST",
        headers: { "User-Agent": UA, "Cookie": cookies }
      }).catch(() => {
      });
    }
  } catch (e) {
    log(`[lootlabs] /tc error: ${String(e)}`);
    return null;
  }
  if (!urid) {
    log("[lootlabs] no urid from /tc");
    return null;
  }
  await new Promise((r) => setTimeout(r, 800));
  const serverIdx = parseInt(urid.slice(-5), 10) % 3;
  const order = [serverIdx, ...[0, 1, 2].filter((i) => i !== serverIdx)];
  const wsTimeoutMs = Math.min((autoCompleteSeconds + 30) * 1e3, 24e4);
  for (const idx of order) {
    const server = `${idx}.${cdnParams.wsDomain}`;
    const result = await wsConnect(server, urid, taskId, cdnInfo.key, sessionId, cdnInfo.isLLBS ? "True" : "False", cdnInfo.tid, cookies, log, wsTimeoutMs);
    if (result && result.startsWith("http")) {
      log(`[lootlabs] \u2713 destination: ${result}`);
      return result;
    }
    if (result) {
      log(`[lootlabs] WS returned non-URL: ${result.slice(0, 100)}`);
    }
  }
  log("[lootlabs] WebSocket bypass exhausted all servers");
  return null;
}
const BASE_HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none"
};
const API_HEADERS = {
  "User-Agent": UA,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/json",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin"
};
function extractCookies(res) {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}
async function tryLootLinkApi(id, cookies, log) {
  const endpoints = [
    `https://loot.link/api/links/${id}`,
    `https://loot.link/api/link/${id}`,
    `https://loot.link/api/v1/links/${id}`,
    `https://loot.link/api/v1/link/${id}`
  ];
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, {
        headers: { ...API_HEADERS, "Cookie": cookies, "Referer": `https://loot.link/${id}` }
      });
      if (!r.ok) continue;
      const data = await r.json();
      log(`[loot] ${ep} \u2192 ${JSON.stringify(data).slice(0, 150)}`);
      const url = data.url ?? data.link ?? data.redirect ?? data.destination;
      if (url && typeof url === "string") return url;
    } catch {
    }
  }
  return null;
}
async function tryLootLinkContinue(id, cookies, log) {
  const endpoints = [
    { url: `https://loot.link/api/links/${id}/click`, method: "POST" },
    { url: `https://loot.link/api/links/${id}/continue`, method: "POST" },
    { url: `https://loot.link/api/links/${id}/reward`, method: "POST" },
    { url: `https://loot.link/api/v1/links/${id}/click`, method: "POST" },
    { url: `https://loot.link/continue/${id}`, method: "GET" },
    { url: `https://loot.link/redirect/${id}`, method: "GET" }
  ];
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep.url, {
        method: ep.method,
        headers: { ...API_HEADERS, "Cookie": cookies, "Referer": `https://loot.link/${id}` },
        body: ep.method === "POST" ? JSON.stringify({ id }) : void 0,
        redirect: "manual"
      });
      const loc = r.headers.get("location");
      if (loc && loc.includes("platorelay")) {
        log(`[loot] redirect \u2192 ${loc.slice(0, 100)}`);
        return loc;
      }
      if (!r.ok) continue;
      const text = await r.text();
      log(`[loot] ${ep.url} \u2192 ${text.slice(0, 150)}`);
      try {
        const data = JSON.parse(text);
        const url = data.url ?? data.link ?? data.redirect ?? data.result;
        if (url && typeof url === "string") return url;
      } catch {
      }
    } catch {
    }
  }
  return null;
}
async function bypassLootLink(rawUrl, log) {
  log(`[loot] target: ${rawUrl.slice(0, 80)}`);
  let id = "";
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    id = parts[0];
  } catch {
  }
  if (!id) {
    log("[loot] kh\xF4ng parse \u0111\u01B0\u1EE3c id");
    return null;
  }
  log(`[loot] id: ${id}`);
  let cookies = "";
  try {
    const pageRes = await fetch(`https://loot.link/${id}`, {
      headers: BASE_HEADERS,
      redirect: "manual"
    });
    log(`[loot] page HTTP ${pageRes.status}`);
    const loc = pageRes.headers.get("location");
    if (loc && loc.includes("platorelay")) {
      log(`[loot] direct redirect`);
      return loc;
    }
    cookies = extractCookies(pageRes);
    if (pageRes.ok || pageRes.status === 200) {
      const html = await pageRes.text();
      const platMatch = html.match(/https?:\/\/auth\.platorelay\.com\/[^\s"'<]+/);
      if (platMatch) {
        log(`[loot] found platorelay in HTML`);
        return platMatch[0];
      }
      const urlMatch = html.match(/"url"\s*:\s*"(https?:\/\/[^"]+)"/);
      if (urlMatch) {
        log(`[loot] found url in HTML`);
        return urlMatch[1];
      }
    }
  } catch (e) {
    log(`[loot] page fetch error: ${String(e)}`);
  }
  await new Promise((r) => setTimeout(r, 2e3));
  const fromApi = await tryLootLinkApi(id, cookies, log);
  if (fromApi) return fromApi;
  const fromContinue = await tryLootLinkContinue(id, cookies, log);
  if (fromContinue) return fromContinue;
  log("[loot] t\u1EA5t c\u1EA3 ph\u01B0\u01A1ng ph\xE1p th\u1EA5t b\u1EA1i");
  return null;
}
async function bypassWorkInk(rawUrl, log) {
  log(`[work.ink] target: ${rawUrl.slice(0, 80)}`);
  let id = "";
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    id = parts[0];
  } catch {
  }
  if (!id) {
    log("[work.ink] kh\xF4ng parse \u0111\u01B0\u1EE3c id");
    return null;
  }
  let cookies = "";
  try {
    const pageRes = await fetch(`https://work.ink/${id}`, {
      headers: BASE_HEADERS,
      redirect: "manual"
    });
    log(`[work.ink] page HTTP ${pageRes.status}`);
    cookies = extractCookies(pageRes);
    const loc = pageRes.headers.get("location");
    if (loc && loc.includes("platorelay")) return loc;
    if (pageRes.ok) {
      const html = await pageRes.text();
      const platMatch = html.match(/https?:\/\/auth\.platorelay\.com\/[^\s"'<]+/);
      if (platMatch) return platMatch[0];
    }
  } catch (e) {
    log(`[work.ink] page error: ${String(e)}`);
  }
  await new Promise((r) => setTimeout(r, 2e3));
  for (const ep of [
    `https://work.ink/api/links/${id}`,
    `https://work.ink/api/v1/links/${id}/click`,
    `https://work.ink/go/${id}`
  ]) {
    try {
      const r = await fetch(ep, {
        headers: { ...API_HEADERS, "Cookie": cookies, "Referer": `https://work.ink/${id}` },
        redirect: "manual"
      });
      const loc = r.headers.get("location");
      if (loc && loc.includes("platorelay")) {
        log(`[work.ink] redirect from ${ep}`);
        return loc;
      }
      if (!r.ok) continue;
      const text = await r.text();
      try {
        const data = JSON.parse(text);
        const url = data.url ?? data.link ?? data.redirect;
        if (url) {
          log(`[work.ink] url from ${ep}`);
          return url;
        }
      } catch {
      }
    } catch {
    }
  }
  log("[work.ink] th\u1EA5t b\u1EA1i");
  return null;
}
async function bypassBoostInk(rawUrl, log) {
  log(`[boost.ink] target: ${rawUrl.slice(0, 80)}`);
  let id = "";
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    id = parts[0];
  } catch {
  }
  if (!id) {
    log("[boost.ink] kh\xF4ng parse \u0111\u01B0\u1EE3c id");
    return null;
  }
  let cookies = "";
  try {
    const pageRes = await fetch(`https://boost.ink/${id}`, {
      headers: BASE_HEADERS,
      redirect: "manual"
    });
    log(`[boost.ink] page HTTP ${pageRes.status}`);
    cookies = extractCookies(pageRes);
    const loc = pageRes.headers.get("location");
    if (loc && loc.includes("platorelay")) return loc;
    if (pageRes.ok) {
      const html = await pageRes.text();
      const platMatch = html.match(/https?:\/\/auth\.platorelay\.com\/[^\s"'<]+/);
      if (platMatch) return platMatch[0];
      const urlMatch = html.match(/"(?:url|link|redirect)"\s*:\s*"(https?:\/\/[^"]+)"/);
      if (urlMatch) return urlMatch[1];
    }
  } catch (e) {
    log(`[boost.ink] error: ${String(e)}`);
  }
  await new Promise((r) => setTimeout(r, 2e3));
  for (const ep of [
    `https://boost.ink/api/links/${id}`,
    `https://boost.ink/api/v1/links/${id}/click`,
    `https://boost.ink/go/${id}`,
    `https://boost.ink/continue/${id}`
  ]) {
    try {
      const r = await fetch(ep, {
        method: ep.includes("click") ? "POST" : "GET",
        headers: { ...API_HEADERS, "Cookie": cookies, "Referer": `https://boost.ink/${id}` },
        redirect: "manual"
      });
      const loc = r.headers.get("location");
      if (loc && loc.includes("platorelay")) return loc;
      if (!r.ok) continue;
      const data = await r.json();
      const url = data.url ?? data.link ?? data.redirect;
      if (url) return url;
    } catch {
    }
  }
  log("[boost.ink] th\u1EA5t b\u1EA1i");
  return null;
}
async function bypassLinkvertise(rawUrl, log) {
  log(`[linkvertise] target: ${rawUrl.slice(0, 80)}`);
  try {
    const pageRes = await fetch(rawUrl, {
      headers: {
        ...BASE_HEADERS,
        "Sec-CH-UA": '"Google Chrome";v="136", "Chromium";v="136", "Not:A-Brand";v="24"',
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"Windows"'
      },
      redirect: "follow"
    });
    log(`[linkvertise] page HTTP ${pageRes.status}`);
    const html = await pageRes.text();
    const platMatch = html.match(/https?:\/\/auth\.platorelay\.com\/[^\s"'<]+/);
    if (platMatch) return platMatch[0];
    const idMatch = html.match(/link_id['":\s]+(\d+)/);
    const userMatch = html.match(/user_id['":\s]+(\d+)/);
    if (idMatch && userMatch) {
      const linkId = idMatch[1];
      const userId = userMatch[1];
      log(`[linkvertise] found ids: link=${linkId} user=${userId}`);
      const apiRes = await fetch(`https://api.linkvertise.com/api/v1/links/${userId}/${linkId}/visit`, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Origin": "https://linkvertise.com",
          "Referer": rawUrl
        },
        body: JSON.stringify({})
      });
      const apiData = await apiRes.json();
      log(`[linkvertise] api \u2192 ${JSON.stringify(apiData).slice(0, 150)}`);
      const url = apiData.url ?? apiData.data?.url;
      if (url) return url;
    }
  } catch (e) {
    log(`[linkvertise] error: ${String(e)}`);
  }
  log("[linkvertise] th\u1EA5t b\u1EA1i (Cloudflare b\u1EA3o v\u1EC7)");
  return null;
}
export {
  bypassBoostInk,
  bypassLinkvertise,
  bypassLootLabs,
  bypassLootLink,
  bypassWorkInk
};
