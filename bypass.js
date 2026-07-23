import { Router } from "express";
import { bypassPlatoboost } from "../lib/platoboost.js";
import { bypassGatewayPlatoboost } from "../lib/gateway-platoboost.js";
import { bypassLootLink, bypassWorkInk, bypassBoostInk, bypassLinkvertise, bypassLootLabs } from "../lib/lootlink.js";
const router = Router();
function detectUrlType(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h.includes("platorelay.com")) return "platorelay";
    if (h.includes("platoboost.com")) return "gateway";
    if (h.includes("loot.link")) return "lootlink";
    if (h.includes("lootlabs.gg")) return "lootlabs";
    if (h.includes("work.ink")) return "workink";
    if (h.includes("boost.ink")) return "boostink";
    if (h.includes("linkvertise.com")) return "linkvertise";
  } catch {
  }
  return "unknown";
}
async function runBypass(url, onLog, lootResult) {
  const type = detectUrlType(url.trim());
  onLog(`Platform: ${type}`);
  if (type === "platorelay") {
    return bypassPlatoboost(url.trim(), onLog, lootResult);
  } else if (type === "gateway") {
    return bypassGatewayPlatoboost(url.trim(), onLog);
  } else if (type === "lootlabs") {
    const destUrl = await bypassLootLabs(url.trim(), onLog);
    if (!destUrl) return { success: false, error: "Kh\xF4ng bypass \u0111\u01B0\u1EE3c LootLabs" };
    onLog(`\u2192 platorelay URL: ${destUrl.slice(0, 80)}`);
    return bypassPlatoboost(destUrl, onLog);
  } else if (type === "lootlink") {
    const destUrl = await bypassLootLink(url.trim(), onLog);
    if (!destUrl) return { success: false, error: "Kh\xF4ng bypass \u0111\u01B0\u1EE3c loot.link" };
    onLog(`\u2192 platorelay URL: ${destUrl.slice(0, 80)}`);
    return bypassPlatoboost(destUrl, onLog);
  } else if (type === "workink") {
    const destUrl = await bypassWorkInk(url.trim(), onLog);
    if (!destUrl) return { success: false, error: "Kh\xF4ng bypass \u0111\u01B0\u1EE3c work.ink" };
    return bypassPlatoboost(destUrl, onLog);
  } else if (type === "boostink") {
    const destUrl = await bypassBoostInk(url.trim(), onLog);
    if (!destUrl) return { success: false, error: "Kh\xF4ng bypass \u0111\u01B0\u1EE3c boost.ink" };
    return bypassPlatoboost(destUrl, onLog);
  } else if (type === "linkvertise") {
    const destUrl = await bypassLinkvertise(url.trim(), onLog);
    if (!destUrl) return { success: false, error: "Kh\xF4ng bypass \u0111\u01B0\u1EE3c Linkvertise (Cloudflare b\u1EA3o v\u1EC7)" };
    return bypassPlatoboost(destUrl, onLog);
  } else {
    return { success: false, error: `URL kh\xF4ng \u0111\u01B0\u1EE3c h\u1ED7 tr\u1EE3. H\u1ED7 tr\u1EE3: auth.platorelay.com, gateway.platoboost.com, loot.link, work.ink, boost.ink, linkvertise.com` };
  }
}
router.post("/bypass", async (req, res) => {
  const { url, lootResult } = req.body;
  if (!url || typeof url !== "string") {
    res.status(400).json({ success: false, error: "Thi\u1EBFu tr\u01B0\u1EDDng 'url'" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}

`);
      if (typeof res.flush === "function") res.flush();
    } catch {
    }
  };
  const onLog = (msg) => {
    req.log.info(msg);
    send({ type: "log", msg });
  };
  try {
    const result = await runBypass(url, onLog, lootResult?.trim() || void 0);
    send({ type: "result", ...result });
  } catch (err) {
    req.log.error({ err }, "bypass error");
    send({ type: "result", success: false, error: "L\u1ED7i server" });
  } finally {
    res.end();
  }
});
var bypass_default = router;
export {
  bypass_default as default,
  runBypass
};
