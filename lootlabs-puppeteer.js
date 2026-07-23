import { execSync } from "child_process";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);

function getChromiumPath() {
  // On Render, let puppeteer download its own Chromium
  return undefined;
}

const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-web-security",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-blink-features=AutomationControlled",
  "--window-size=1280,720"
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

function extractPlatorelay(text) {
  if (!text) return null;
  const pm = text.match(/https?:\/\/auth\.platorelay\.com\/[^\s"'<\\]+/);
  if (pm) return pm[0];
  if (text.startsWith("http")) return text;
  try {
    const d = JSON.parse(text);
    for (const k of ["url", "link", "redirect", "destination", "data"]) {
      const v = d[k];
      if (typeof v === "string" && v.startsWith("http")) return v;
    }
  } catch {
  }
  return null;
}

async function bypassLootLabsPuppeteer(rawUrl, log) {
  log("[lootlabs] Kh\u1EDFi \u0111\u1ED9ng Chromium...");
  const executablePath = getChromiumPath();
  let puppeteer;
  try {
    puppeteer = _require("puppeteer");
  } catch {
    try {
      puppeteer = _require("puppeteer-core");
    } catch (e) {
      log(`[lootlabs] no puppeteer: ${e}`);
      return null;
    }
  }
  let browser = null;
  let destination = null;
  let sessionUuid = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: PUPPETEER_ARGS,
      timeout: 3e4
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(function() {
      Object.defineProperty(navigator, "webdriver", { get: function() {
        return false;
      } });
    });
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(UA);
    await page.setRequestInterception(true);
    const taskApis = [];
    page.on("request", (req) => {
      const url = req.url();
      const method = req.method();
      const body = req.postData() ?? "";
      if (url.includes("/verify") && method === "POST" && body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed.session && typeof parsed.session === "string") {
            sessionUuid = parsed.session;
            log(`[lootlabs] \u2713 session UUID: ${sessionUuid}`);
          }
        } catch {
        }
      }
      if (!url.match(/\.(png|jpg|gif|css|woff|ico|svg)(\?|$)/i)) {
        if (url.includes("lootlabs") || url.includes("lootlink")) {
          if (!url.includes("hotjar") && !url.includes("cdn-cgi/rum")) {
            log(`[lootlabs] \u2192 ${method} ${url.slice(0, 120)}${body ? ` | ${body.slice(0, 80)}` : ""}`);
          }
        }
      }
      req.continue();
    });
    page.on("response", async (res) => {
      try {
        const url = res.url();
        const status = res.status();
        if (!url.includes("lootlabs") && !url.includes("lootlink")) return;
        if (url.match(/\.(png|jpg|gif|css|woff|ico|svg)(\?|$)/i)) return;
        if (url.includes("hotjar") || url.includes("cdn-cgi")) return;
        const body = await res.text().catch(() => "");
        const method = res.request().method();
        const reqBody = res.request().postData() ?? "";
        taskApis.push({ method, url, reqBody, status, respBody: body.slice(0, 300) });
        log(`[lootlabs] \u2190 ${status} ${url.slice(0, 100)}: "${body.slice(0, 100)}"`);
        if (!destination) {
          const found = extractPlatorelay(body);
          if (found) {
            log(`[lootlabs] \u2713 intercepted: ${found.slice(0, 80)}`);
            destination = found;
          }
        }
      } catch {
      }
    });
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (url.includes("platorelay") && !destination) {
        log(`[lootlabs] \u2713 redirect: ${url.slice(0, 80)}`);
        destination = url;
      }
    });
    log(`[lootlabs] Navigate \u2192 ${rawUrl.slice(0, 80)}`);
    try {
      await page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout: 25e3 });
    } catch (e) {
      log(`[lootlabs] goto: ${String(e).slice(0, 60)}`);
    }
    for (let i = 0; i < 8; i++) {
      const title = await page.title().catch(() => "");
      if (!title.toLowerCase().includes("just a moment")) {
        log(`[lootlabs] CF OK: "${title}"`);
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (destination) return destination;
    await new Promise((r) => setTimeout(r, 4e3));
    if (destination) return destination;
    log(`[lootlabs] session UUID: ${sessionUuid}`);
    const pageInfo = await page.evaluate(function() {
      const w = globalThis;
      const doc = w.document;
      const html = doc.documentElement.innerHTML;
      const uuidMatch = html.match(/["']([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})["']/gi);
      const uuids = uuidMatch ? [...new Set(uuidMatch.map((m) => m.replace(/["']/g, "")))] : [];
      const links = Array.from(doc.querySelectorAll("a[href]")).map((a) => ({ href: a.href, text: a.innerText?.slice(0, 50), id: a.id, cls: a.className?.slice(0, 40) })).filter((l) => l.href && !l.href.includes("lootlabs"));
      const taskEls = Array.from(doc.querySelectorAll("[data-task-id],[data-id],[data-task],[id*='task'],[class*='task-item']")).slice(0, 10).map((el) => ({
        tag: el.tagName,
        id: el.id,
        cls: el.className?.slice(0, 60),
        data: JSON.stringify(el.dataset).slice(0, 100),
        text: el.innerText?.slice(0, 60),
        href: el.href
      }));
      const wVars = {};
      for (const k of Object.keys(w)) {
        if (k.match(/task|loot|session|config|app/i) && typeof w[k] !== "function") {
          try {
            wVars[k] = JSON.stringify(w[k]).slice(0, 200);
          } catch {
          }
        }
      }
      const scriptUrls = html.match(/https?:\/\/[^\s"'<>]{10,}/g) || [];
      const sponsorUrls2 = scriptUrls.filter(
        (u) => !u.includes("lootlabs") && !u.includes("stripe") && !u.includes("hotjar") && !u.includes("taboola") && !u.includes("google") && !u.includes("cdn")
      ).slice(0, 10);
      return {
        title: doc.title,
        uuids: uuids.slice(0, 5),
        taskEls,
        links: links.slice(0, 10),
        wVars,
        sponsorUrls: sponsorUrls2,
        bodyText: doc.body?.innerText?.slice(0, 300) || ""
      };
    }).catch(() => null);
    if (pageInfo) {
      log(`[lootlabs] title="${pageInfo.title}"`);
      log(`[lootlabs] bodyText: "${pageInfo.bodyText.slice(0, 200)}"`);
      const body = pageInfo.bodyText ?? "";
      const hasDownloadTask = /download.{0,30}install/i.test(body);
      const hasUnlockr = /unlockr/i.test(body);
      if (hasDownloadTask && hasUnlockr) {
        log("[lootlabs] \u26A0\uFE0F Trang y\xEAu c\u1EA7u Unlockr subscription ho\u1EB7c c\xE0i app th\u1EADt \u2014 kh\xF4ng th\u1EC3 bypass server-side");
        log("[lootlabs] \u{1F4A1} D\xF9ng service kh\xE1c \u0111\u1EC3 l\u1EA5y URL ticket2, r\u1ED3i paste v\xE0o \xF4 'Loot URL' tr\xEAn giao di\u1EC7n");
        return null;
      }
      log(`[lootlabs] UUIDs in page: ${JSON.stringify(pageInfo.uuids)}`);
      log(`[lootlabs] taskEls: ${JSON.stringify(pageInfo.taskEls).slice(0, 300)}`);
      log(`[lootlabs] links: ${JSON.stringify(pageInfo.links).slice(0, 200)}`);
      log(`[lootlabs] wVars: ${JSON.stringify(pageInfo.wVars).slice(0, 200)}`);
      if (pageInfo.sponsorUrls?.length) log(`[lootlabs] sponsorUrls: ${JSON.stringify(pageInfo.sponsorUrls)}`);
      if (!sessionUuid && pageInfo.uuids?.length) {
        sessionUuid = pageInfo.uuids[0];
        log(`[lootlabs] session UUID from page HTML: ${sessionUuid}`);
      }
    }
    if (destination) return destination;
    const cookies = await page.cookies();
    log(`[lootlabs] Cookies: ${cookies.map((c) => c.name).join(", ")}`);
    if (sessionUuid) {
      log(`[lootlabs] POST /verify with session UUID...`);
      const postVerify = await page.evaluate(async function(uuid) {
        try {
          const r = await fetch("https://links.lootlabs.gg/verify", {
            method: "POST",
            credentials: "include",
            headers: { "Accept": "application/json, text/plain, */*", "Content-Type": "application/json" },
            body: JSON.stringify({ session: uuid })
          });
          return { status: r.status, body: await r.text() };
        } catch (e) {
          return { status: 0, body: String(e) };
        }
      }, sessionUuid).catch(() => null);
      if (postVerify) {
        log(`[lootlabs] POST /verify: ${postVerify.status} "${postVerify.body?.slice(0, 150)}"`);
        const found = extractPlatorelay(postVerify.body ?? "");
        if (found) return found;
      }
      log(`[lootlabs] Trying task completion APIs...`);
      const taskApis2 = await page.evaluate(async function(uuid) {
        const endpoints = [
          { url: `https://links.lootlabs.gg/tasks/${uuid}`, method: "GET" },
          { url: `https://lootlabs.gg/api/tasks/${uuid}`, method: "GET" },
          { url: `https://links.lootlabs.gg/tasks`, method: "GET" },
          { url: `https://links.lootlabs.gg/session/${uuid}`, method: "GET" },
          { url: `https://links.lootlabs.gg/session/${uuid}/tasks`, method: "GET" },
          { url: `https://links.lootlabs.gg/complete`, method: "POST" },
          { url: `https://links.lootlabs.gg/complete/${uuid}`, method: "GET" },
          { url: `https://links.lootlabs.gg/done`, method: "POST" }
        ];
        const results = [];
        for (const ep of endpoints) {
          try {
            const r = await fetch(ep.url, {
              method: ep.method,
              credentials: "include",
              headers: { "Accept": "application/json", "Content-Type": "application/json" },
              body: ep.method === "POST" ? JSON.stringify({ session: uuid }) : void 0
            });
            const body = await r.text();
            if (body) results.push(`${ep.method} ${ep.url.slice(40)} \u2192 ${r.status}: ${body.slice(0, 80)}`);
          } catch {
          }
        }
        return results;
      }, sessionUuid).catch(() => []);
      for (const r of taskApis2) log(`[lootlabs] API: ${r}`);
    }
    if (destination) return destination;
    const sponsorUrls = pageInfo?.sponsorUrls ?? [];
    if (sponsorUrls.length > 0) {
      log(`[lootlabs] Visiting ${sponsorUrls.length} sponsor URLs...`);
      for (const url of sponsorUrls.slice(0, 3)) {
        try {
          log(`[lootlabs] Visit task URL: ${url.slice(0, 80)}`);
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 1e4 }).catch(() => {
          });
          await new Promise((r) => setTimeout(r, 2e3));
          if (destination) return destination;
        } catch {
        }
      }
      await page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout: 15e3 }).catch(() => {
      });
      await new Promise((r) => setTimeout(r, 2e3));
    }
    if (destination) return destination;
    log(`[lootlabs] Aggressive task clicking...`);
    const taskSelectors = [
      '[id*="task"]:not([id*="Unlockr"]):not([id*="unlockr"])',
      '[class*="task-item"]',
      '[class*="task-link"]',
      'a[href*="ad"]',
      'a[href*="sponsor"]',
      "[data-task]"
    ];
    for (const sel of taskSelectors) {
      try {
        const els = await page.$$(sel);
        for (const el of els) {
          try {
            const txt = await page.evaluate((e) => e.innerText, el).catch(() => "");
            const href = await page.evaluate((e) => e.href || e.getAttribute("href"), el).catch(() => "");
            log(`[lootlabs] Click task: "${String(txt).slice(0, 40)}" href="${String(href).slice(0, 60)}"`);
            await el.click().catch(() => {
            });
            await new Promise((r) => setTimeout(r, 1e3));
            if (destination) return destination;
          } catch {
          }
        }
      } catch {
      }
    }
    log("[lootlabs] Final poll (30s, POST with session UUID)...");
    const pollStart = Date.now();
    let pollN = 0;
    while (Date.now() - pollStart < 3e4) {
      if (destination) return destination;
      pollN++;
      const pr = sessionUuid ? await page.evaluate(async function(uuid) {
        try {
          const r = await fetch("https://links.lootlabs.gg/verify", {
            method: "POST",
            credentials: "include",
            headers: { "Accept": "application/json, text/plain, */*", "Content-Type": "application/json" },
            body: JSON.stringify({ session: uuid })
          });
          return { status: r.status, body: await r.text() };
        } catch (e) {
          return { status: 0, body: String(e) };
        }
      }, sessionUuid).catch(() => null) : null;
      if (pr?.body) {
        const found = extractPlatorelay(pr.body);
        if (found) {
          log(`[lootlabs] \u2713 poll #${pollN}: ${found.slice(0, 80)}`);
          return found;
        }
        log(`[lootlabs] poll #${pollN} +${((Date.now() - pollStart) / 1e3).toFixed(0)}s: "${pr.body.slice(0, 60)}"`);
      }
      await new Promise((r) => setTimeout(r, 5e3));
    }
    log("[lootlabs] H\u1EBFt th\u1EDDi gian 30s poll");
    return null;
  } catch (e) {
    log(`[lootlabs] Fatal: ${String(e).slice(0, 150)}`);
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {
      });
      log("[lootlabs] Browser closed");
    }
  }
}

export {
  bypassLootLabsPuppeteer
};
