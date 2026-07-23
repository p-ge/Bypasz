import { analyzeCaptchaGif } from "./captcha-solver.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
function buildHeaders(extra = {}) {
  return {
    "User-Agent": UA,
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Origin": "https://gateway.platoboost.com",
    "Referer": "https://gateway.platoboost.com/",
    "Sec-CH-UA": '"Google Chrome";v="136", "Chromium";v="136", "Not:A-Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    ...extra
  };
}
async function checkGatewayKey(id, log) {
  try {
    const r = await fetch(`https://gateway.platoboost.com/api/authentications/${id}`, {
      headers: buildHeaders()
    });
    const data = await r.json();
    log(`[gw] check \u2192 HTTP ${r.status} ${JSON.stringify(data).slice(0, 150)}`);
    const key = data.key;
    if (key && key.length > 5) return key;
    return null;
  } catch (e) {
    log(`[gw] check error: ${String(e)}`);
    return null;
  }
}
async function solveGatewayCaptcha(id, log) {
  try {
    const r = await fetch(`https://gateway.platoboost.com/api/authentications/${id}/captcha`, {
      headers: buildHeaders()
    });
    if (!r.ok) {
      log(`[gw-cap] HTTP ${r.status}`);
      return null;
    }
    const data = await r.json();
    log(`[gw-cap] challenge: ${JSON.stringify(data).slice(0, 200)}`);
    const token = data.token;
    if (token) {
      log("[gw-cap] token already in challenge response");
      return token;
    }
    const imageUrl = data.image;
    const type = data.type ?? "coherence";
    const captchaBase = "https://gateway.platoboost.com";
    if (imageUrl) {
      const fullImageUrl = imageUrl.startsWith("http") ? imageUrl : `${captchaBase}${imageUrl}`;
      const pt = await analyzeCaptchaGif(fullImageUrl, type, log);
      if (!pt) return null;
      const ansRes = await fetch(`https://gateway.platoboost.com/api/authentications/${id}/captcha`, {
        method: "POST",
        headers: { ...buildHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ x: Math.round(pt.x), y: Math.round(pt.y) })
      });
      const ansData = await ansRes.json();
      log(`[gw-cap] answer \u2192 ${JSON.stringify(ansData).slice(0, 150)}`);
      const tok = ansData.token;
      if (tok) return tok;
    }
    return null;
  } catch (e) {
    log(`[gw-cap] error: ${String(e)}`);
    return null;
  }
}
async function submitGatewayStep(id, captchaToken, log) {
  try {
    const body = { captcha: captchaToken };
    const r = await fetch(`https://gateway.platoboost.com/api/authentications/${id}`, {
      method: "PUT",
      headers: { ...buildHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    log(`[gw-step] HTTP ${r.status} \u2192 ${JSON.stringify(data).slice(0, 200)}`);
    const key = data.key;
    if (key && key.length > 5) return { key };
    const text = JSON.stringify(data).toLowerCase();
    if (text.includes("captcha")) return { needsCaptcha: true };
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return {};
  } catch (e) {
    log(`[gw-step] error: ${String(e)}`);
    return { error: String(e) };
  }
}
async function bypassGatewayPlatoboost(url, log) {
  let id = null;
  try {
    const u = new URL(url);
    id = u.searchParams.get("id");
  } catch {
  }
  if (!id) {
    const m = url.match(/[?&]id=([^&]+)/);
    id = m ? m[1] : null;
  }
  if (!id) return { success: false, error: "URL kh\xF4ng h\u1EE3p l\u1EC7, thi\u1EBFu tham s\u1ED1 'id'" };
  log(`[gw] id: ${id}`);
  const existingKey = await checkGatewayKey(id, log);
  if (existingKey) {
    log("[gw] key \u0111\xE3 c\xF3!");
    return { success: true, key: existingKey };
  }
  log("[gw] th\u1EED step kh\xF4ng captcha...");
  const step1 = await submitGatewayStep(id, null, log);
  if (step1.key) return { success: true, key: step1.key };
  const key1 = await checkGatewayKey(id, log);
  if (key1) return { success: true, key: key1 };
  for (let attempt = 0; attempt < 5; attempt++) {
    log(`[gw] gi\u1EA3i captcha l\u1EA7n ${attempt + 1}...`);
    const capToken = await solveGatewayCaptcha(id, log);
    if (!capToken) {
      log("[gw] kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c captcha token");
      await new Promise((r) => setTimeout(r, 2e3));
      continue;
    }
    log("[gw] c\xF3 captcha token, g\u1EEDi step...");
    const step = await submitGatewayStep(id, capToken, log);
    if (step.key) return { success: true, key: step.key };
    const key = await checkGatewayKey(id, log);
    if (key) return { success: true, key };
    if (!step.needsCaptcha) break;
    await new Promise((r) => setTimeout(r, 2e3));
  }
  const finalKey = await checkGatewayKey(id, log);
  if (finalKey) return { success: true, key: finalKey };
  return { success: false, error: "gateway.platoboost.com: kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c key" };
}
export {
  bypassGatewayPlatoboost
};
