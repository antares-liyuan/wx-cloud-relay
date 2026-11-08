// node --test tests/  —— 用本地 HTTP 源站 + 内存版云数据库测试, 不需要微信环境
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');

let hits = 0, mode = 'ok';
const server = http.createServer((req, res) => {
  hits++;
  if (mode === 'down') { req.socket.destroy(); return; }
  if (req.url.startsWith('/api/missing')) { res.writeHead(404); return res.end(); }
  const body = JSON.stringify({ url: req.url, n: hits });
  if (/gzip/.test(req.headers['accept-encoding'] || '')) { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); return res.end(zlib.gzipSync(body)); }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(body);
});

function memDb() {
  const docs = {};
  return { docs, collection: () => ({ doc: id => ({ get: async () => { if (!docs[id]) throw new Error('no'); return { data: docs[id] }; }, set: async ({ data }) => { docs[id] = data; } }) }), createCollection: async () => {} };
}

test('relay: whitelist, gzip, param filtering, cache, 404 no-retry, stale fallback, prewarm', async () => {
  await new Promise(r => server.listen(0, r));
  process.env.RELAY_ORIGIN = 'http://127.0.0.1:' + server.address().port;
  const relay = require('../cloudfunctions/relay/index.js');
  const C = require('../cloudfunctions/relay/config.js');
  C.ATTEMPT_TIMEOUTS = [300, 300, 300];
  const db = memDb(); relay._internal.setDb(db);

  assert.deepEqual(await relay.main({ path: '/etc/passwd' }), { error: 'path not allowed' });
  assert.deepEqual(await relay.main({ path: '/static-data/../x.json' }), { error: 'path not allowed' });

  const r1 = await relay.main({ path: '/api/items', params: { page: 2, evil: 'x' } });
  assert.equal(r1.status, 200); assert.equal(r1.data.url, '/api/items?page=2');       // 非白名单参数被丢弃, 解压正确
  const r2 = await relay.main({ path: '/api/items', params: { page: 2 } });
  assert.equal(r2.cached, true); assert.equal(r2.data.n, r1.data.n);                     // 新鲜期内不打源站

  const before = hits;
  assert.deepEqual(await relay.main({ path: '/api/item', params: { id: 'missing' } }).then(r => r.status), 200);
  const nf = await (async () => { C.ALLOW_PATHS.push('/api/missing'); return relay.main({ path: '/api/missing' }); })();
  assert.equal(nf.status, 404); assert.equal(hits - before, 2);                         // 404 只请求一次

  Object.values(db.docs).forEach(d => { d.at -= 2 * C.FRESH_MS; });                       // 让缓存过期
  mode = 'down';
  const stale = await relay.main({ path: '/api/items', params: { page: 2 } });
  assert.equal(stale.stale, true); assert.equal(stale.data.url, '/api/items?page=2');   // 源站挂了用旧数据兜底
  assert.match((await relay.main({ path: '/api/summary' })).error, /upstream/);         // 没有旧数据就报错

  mode = 'ok';
  const pw = await relay.main({ Type: 'Timer', TriggerName: 'prewarm' });
  assert.deepEqual(pw, { prewarm: 2, ok: 2 });
  server.close();
});
