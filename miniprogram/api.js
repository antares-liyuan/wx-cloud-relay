// 小程序端: 经云函数 relay 取数, 加一层本机缓存 —— 5 分钟内重复打开直接用本机数据, 网络失败时 24 小时内的旧数据兜底
const LOCAL_FRESH_MS = 5 * 60 * 1000;
const LOCAL_STALE_MS = 24 * 60 * 60 * 1000;

function storageKey(path, params) {
  return 'relay:' + path + '?' + Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
}
function readLocal(key) {
  try { const v = wx.getStorageSync(key); return v && v.at && v.data ? v : null; } catch (_) { return null; }
}
function writeLocal(key, data) {
  try { wx.setStorageSync(key, { at: Date.now(), data }); } catch (_) { /* 存储满了不影响展示 */ }
}
function viaCloud(path, params) {
  return wx.cloud.callFunction({ name: 'relay', data: { path, params } }).then(res => {
    const r = res && res.result;
    if (!r || typeof r !== 'object') throw new Error('bad response');
    if (r.error) throw new Error(r.error);
    return r.data;
  }, error => {
    const msg = (error && error.errMsg) || '';
    throw new Error(/timed out|timeout|504003/i.test(msg) ? '网络较慢，请稍后下拉刷新重试' : (msg || '网络请求失败'));
  });
}
function request(path, params) {
  params = params || {};
  const key = storageKey(path, params);
  const local = readLocal(key);
  if (local && Date.now() - local.at < LOCAL_FRESH_MS) return Promise.resolve(local.data);
  return viaCloud(path, params).then(data => { writeLocal(key, data); return data; }, error => {
    if (local && Date.now() - local.at < LOCAL_STALE_MS) return local.data;
    throw error;
  });
}
module.exports = { request };
// app.js 里先初始化: wx.cloud.init({ env: '你的云开发环境ID', traceUser: false });
