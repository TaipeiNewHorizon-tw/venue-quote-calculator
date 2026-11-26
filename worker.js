// 場地租借費用試算 —— Cloudflare Worker
//
// 這個檔案讓網站從「純靜態頁面」多了一個小後台：
//   GET  /api/config   任何人都可以讀，取得目前生效的優惠折扣（給前台試算用）
//   POST /api/login    管理者輸入密碼登入，密碼正確會核發一個有效期 2 小時的登入憑證（存在 Cookie 裡）
//   POST /api/config   已登入的管理者才能呼叫，用來更新折扣，會寫進 KV 儲存，全站客戶馬上看到新折扣
//   POST /api/logout   清除登入憑證
// 其他所有網址（/、/index.html…）都照舊交給靜態檔案處理，行為不變。
//
// 需要事先在 Cloudflare 後台設定好兩件事，才能正常運作：
//   1. 建立一個 KV Namespace，並在 wrangler.jsonc 的 kv_namespaces.id 貼上它的 ID
//   2. 在 Worker 的 Settings → Variables and Secrets 新增一個名叫 ADMIN_PASSWORD 的 Secret，
//      值就是管理者要用的密碼（絕對不要把密碼直接寫在程式碼或 GitHub 裡）
// 詳細步驟請看隨附的設定說明。
 
const CONFIG_KEY = "venue_config";
const SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 小時
 
const DEFAULT_CONFIG = {
  discount: 0.8,
  discountLabel: "8折"
};
 
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
 
    if (url.pathname === "/api/config" && request.method === "GET") {
      return handleGetConfig(env);
    }
    if (url.pathname === "/api/login" && request.method === "POST") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/api/config" && request.method === "POST") {
      return handleUpdateConfig(request, env);
    }
    if (url.pathname === "/api/logout" && request.method === "POST") {
      return handleLogout();
    }
    if (url.pathname === "/api/track" && request.method === "POST") {
      return handleTrack(request, env, url);
    }
    if (url.pathname === "/api/metrics" && request.method === "GET") {
      return handleMetrics(request, env);
    }
 
    // 其他請求（頁面本身、圖片等）交給靜態檔案處理
    return env.ASSETS.fetch(request);
  }
};
 
// ---------------------------------------------------------------------------
// 匿名使用計數（給彙總儀表板 tnh-hub 看「今日試算次數」）
//
// 只記「次數」：每天一筆 KV（stats:YYYY-MM-DD → {estimate, apply_click}），
// 不記 IP、不設 Cookie、不記任何試算內容或客戶資料。「今日」以臺北時間（UTC+8）計。
//   estimate     這次造訪第一次算出大於 0 的總金額（每次造訪前端最多送一次）
//   apply_click  按了「前往使用辦法與申請表格」
// 防濫用：/api/track 是公開端點，任何人都能呼叫，所以
//   1. 有 Origin 標頭時必須與本站同源；
//   2. 每天最多接受 STATS_DAILY_CAP 次事件，超過就直接忽略、不再寫 KV
//      （KV 免費方案每天只有 1000 次寫入，要留給管理者調折扣用）。
// ---------------------------------------------------------------------------
const STATS_EVENTS = ["estimate", "apply_click"];
const STATS_DAILY_CAP = 500;
const STATS_TTL_SECONDS = 14 * 24 * 60 * 60;

function taipeiDate(ms) {
  return new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function readStats(env, date) {
  const stored = await env.CONFIG_KV.get("stats:" + date, "json");
  return {
    estimate: (stored && Number(stored.estimate)) || 0,
    apply_click: (stored && Number(stored.apply_click)) || 0
  };
}

async function handleTrack(request, env, url) {
  const noContent = new Response(null, { status: 204 });
  const origin = request.headers.get("Origin");
  if (origin) {
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === url.host; } catch (e) {}
    if (!sameOrigin) return new Response(null, { status: 403 });
  }
  const body = await safeReadJson(request);
  const event = body && body.event;
  if (STATS_EVENTS.indexOf(event) === -1) return new Response(null, { status: 400 });
  if (!env.CONFIG_KV) return noContent;
  try {
    const date = taipeiDate(Date.now());
    const stats = await readStats(env, date);
    if (stats.estimate + stats.apply_click >= STATS_DAILY_CAP) return noContent;
    stats[event] += 1;
    await env.CONFIG_KV.put("stats:" + date, JSON.stringify(stats), { expirationTtl: STATS_TTL_SECONDS });
  } catch (e) {
    // 計數失敗不能影響試算頁
  }
  return noContent;
}

// 給 tnh-hub 讀取：需要 Authorization: Bearer <METRICS_TOKEN>（Worker Secret）。
// 沒設定 METRICS_TOKEN 時一律拒絕。只回數字。
async function handleMetrics(request, env) {
  if (!env.METRICS_TOKEN) {
    return jsonResponse({ error: "尚未設定 METRICS_TOKEN" }, 503);
  }
  const m = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "");
  const given = await hmacHex("metrics-compare", m ? m[1] : "");
  const want = await hmacHex("metrics-compare", env.METRICS_TOKEN);
  if (!timingSafeEqual(given, want)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  if (!env.CONFIG_KV) {
    return jsonResponse({ error: "尚未設定 KV 儲存空間" }, 500);
  }
  const date = taipeiDate(Date.now());
  const stats = await readStats(env, date);
  return jsonResponse({
    system: "quote",
    now: new Date().toISOString(),
    date: date,
    estimates_today: stats.estimate,
    apply_clicks_today: stats.apply_click
  }, 200, { "Cache-Control": "no-store" });
}

async function handleGetConfig(env) {
  const config = await readConfig(env);
  return jsonResponse(
    { discount: config.discount, discountLabel: config.discountLabel },
    200,
    { "Cache-Control": "no-store" }
  );
}
 
async function handleLogin(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return jsonResponse({ ok: false, error: "伺服器尚未設定管理密碼，請先在 Cloudflare 後台設定 ADMIN_PASSWORD" }, 500);
  }
  const body = await safeReadJson(request);
  const password = body && body.password;
  if (!password || password !== env.ADMIN_PASSWORD) {
    return jsonResponse({ ok: false, error: "密碼錯誤" }, 401);
  }
  const token = await makeSessionToken(env.ADMIN_PASSWORD);
  return jsonResponse({ ok: true }, 200, {
    "Set-Cookie": SESSION_COOKIE + "=" + token + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + Math.floor(SESSION_TTL_MS / 1000)
  });
}
 
async function handleLogout() {
  return jsonResponse({ ok: true }, 200, {
    "Set-Cookie": SESSION_COOKIE + "=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
  });
}
 
async function handleUpdateConfig(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return jsonResponse({ ok: false, error: "伺服器尚未設定管理密碼，請先在 Cloudflare 後台設定 ADMIN_PASSWORD" }, 500);
  }
  const authed = await isAuthed(request, env);
  if (!authed) {
    return jsonResponse({ ok: false, error: "請先登入" }, 401);
  }
 
  const body = await safeReadJson(request);
  const percent = Number(body && body.discountPercent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return jsonResponse({ ok: false, error: "折扣數字不正確，請輸入 1～100 之間（例如 80 代表 8 折）" }, 400);
  }
 
  const discount = Math.round(percent * 1000) / 100000; // 保留精度，避免浮點數誤差
  const discountLabel = formatDiscountLabel(percent);
  const config = {
    discount: discount,
    discountLabel: discountLabel,
    updatedAt: new Date().toISOString()
  };
 
  if (!env.CONFIG_KV) {
    return jsonResponse({ ok: false, error: "伺服器尚未設定 KV 儲存空間，請先在 Cloudflare 後台建立並綁定 KV Namespace" }, 500);
  }
  await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(config));
 
  return jsonResponse({ ok: true, discount: discount, discountLabel: discountLabel });
}
 
async function readConfig(env) {
  if (!env.CONFIG_KV) return DEFAULT_CONFIG;
  try {
    const stored = await env.CONFIG_KV.get(CONFIG_KEY, "json");
    if (stored && typeof stored.discount === "number" && stored.discountLabel) {
      return stored;
    }
  } catch (e) {
    // KV 讀取失敗就退回預設值，不要讓試算頁面掛掉
  }
  return DEFAULT_CONFIG;
}
 
// 80 -> "8折", 75 -> "7.5折", 100 -> "不打折"
function formatDiscountLabel(percent) {
  if (percent >= 100) return "不打折";
  const tenScale = percent / 10;
  const label = Number.isInteger(tenScale) ? String(tenScale) : tenScale.toFixed(1).replace(/\.0$/, "");
  return label + "折";
}
 
async function isAuthed(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp("(?:^|;\\s*)" + SESSION_COOKIE + "=([^;]+)"));
  const token = match && match[1];
  if (!token) return false;
  return verifySessionToken(token, env.ADMIN_PASSWORD);
}
 
async function makeSessionToken(secret) {
  const expiry = Date.now() + SESSION_TTL_MS;
  const sig = await hmacHex(secret, String(expiry));
  return expiry + "." + sig;
}
 
async function verifySessionToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expiry = Number(parts[0]);
  const sig = parts[1];
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  const expected = await hmacHex(secret, String(expiry));
  return timingSafeEqual(expected, sig);
}
 
async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sigBuf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
 
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
 
async function safeReadJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}
 
function jsonResponse(obj, status, extraHeaders) {
  const headers = Object.assign({ "Content-Type": "application/json; charset=UTF-8" }, extraHeaders || {});
  return new Response(JSON.stringify(obj), { status: status || 200, headers: headers });
}
