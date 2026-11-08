// wx-cloud-relay: 小程序 → 微信云开发云函数 → 境外源站。缓存为主、跨境为辅。
// 小程序 wx.request 的合法域名必须完成 ICP 备案, 境外服务器无法备案; 云函数调用不受合法域名限制,
// 由它代取源站数据, 再把结果缓存在云数据库(大陆内读取, 几十毫秒), 跨境链路只在缓存过期时才走。
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const C = require('./config');

const origin = new URL(C.ORIGIN);
const lib = origin.protocol === 'http:' ? http : https;
const agent = new lib.Agent({ keepAlive: true, maxSockets: 8 });      // 热实例复用连接, 省掉跨境 TLS 握手

let db = null;
try {
  const cloud = require('wx-server-sdk');
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  db = cloud.database();
} catch (e) { db = null; }                // 本地测试或未安装依赖时只走直连

function allowed(path) {
  return typeof path === 'string' && (C.ALLOW_PATHS.includes(path) || C.ALLOW_PATTERNS.some(re => re.test(path)));
}
function cleanParams(p) {
  const out = {};
  Object.keys(p || {}).sort().forEach(k => {
    if (C.ALLOW_PARAMS.includes(k) && p[k] !== undefined && p[k] !== null && p[k] !== '') out[k] = String(p[k]).slice(0, 64);
  });
  return out;
}
function cacheKey(path, params) {        // 云数据库 _id 只用字母数字和 _ -
  const raw = path + '__' + Object.keys(params).map(k => k + '_' + params[k]).join('_');
  return raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
}

function fetchOnce(path, params, timeout) {
  const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  return new Promise((resolve, reject) => {
    const req = lib.get({
      protocol: origin.protocol, hostname: origin.hostname, port: origin.port || undefined,
      path: path + (qs ? '?' + qs : ''), agent, timeout,
      headers: { 'User-Agent': C.USER_AGENT, 'Accept': 'application/json', 'Accept-Encoding': 'gzip' }
    }, res => {
      const stream = res.headers['content-encoding'] === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => { body += chunk; if (body.length > 4e6) req.destroy(new Error('too large')); });
      stream.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) { const e = new Error('HTTP ' + res.statusCode); e.statusCode = res.statusCode; return reject(e); }
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('bad json')); }
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function fetchLive(path, params) {
  let last;
  for (const t of C.ATTEMPT_TIMEOUTS) {
    try { return await fetchOnce(path, params, t); }
    catch (e) { last = e; if (e.statusCode >= 400 && e.statusCode < 500) break; }     // 4xx 重试无意义
  }
  throw last;
}

async function readCache(key) {
  if (!db) return null;
  try { const r = await db.collection(C.COLLECTION).doc(key).get(); return r && r.data; } catch (e) { return null; }
}
async function writeCache(key, data) {
  if (!db) return;
  const doc = { data: { payload: data, at: Date.now() } };
  try { await db.collection(C.COLLECTION).doc(key).set(doc); }
  catch (e) {
    try { await db.createCollection(C.COLLECTION); await db.collection(C.COLLECTION).doc(key).set(doc); } catch (e2) { /* 缓存失败不影响返回 */ }
  }
}

async function serve(path, rawParams) {
  if (!allowed(path)) return { error: 'path not allowed' };
  const params = cleanParams(rawParams);
  const key = cacheKey(path, params);
  const cached = await readCache(key);
  if (cached && Date.now() - cached.at < C.FRESH_MS) return { status: 200, data: cached.payload, cached: true };
  try {
    const data = await fetchLive(path, params);
    await writeCache(key, data);
    return { status: 200, data };
  } catch (e) {
    if (e.statusCode === 404) return { status: 404, error: 'not found' };
    if (cached && Date.now() - cached.at < C.STALE_MS) return { status: 200, data: cached.payload, cached: true, stale: true };
    return { error: 'upstream unavailable, please retry later' };
  }
}

async function prewarm() {
  const res = await Promise.allSettled(C.PREWARM.map(async ([path, p]) => {
    const params = cleanParams(p);
    await writeCache(cacheKey(path, params), await fetchLive(path, params));
  }));
  return { prewarm: res.length, ok: res.filter(r => r.status === 'fulfilled').length };
}

exports.main = async (event) => {
  if (event && (event.Type === 'Timer' || event.TriggerName)) return prewarm();
  return serve(event && event.path, (event && event.params) || {});
};
exports._internal = { allowed, cleanParams, cacheKey, serve, prewarm, setDb: d => { db = d; } };
