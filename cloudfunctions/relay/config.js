// 按你的源站修改这里(其余代码一般不用动)
module.exports = {
  // 境外源站(只读 JSON 接口), 必须是 https; 测试时可用环境变量 RELAY_ORIGIN 覆盖
  ORIGIN: process.env.RELAY_ORIGIN || 'https://api.example.com',
  // 放行的路径: 精确路径 或 正则。不在这里的一律拒绝 —— 云函数不是通用代理
  ALLOW_PATHS: ['/api/summary', '/api/items', '/api/item'],
  ALLOW_PATTERNS: [/^\/static-data\/(?:index|[a-z0-9-]{1,40})\.json$/],
  // 放行的查询参数(其余丢弃), 每个值最长 64 字符
  ALLOW_PARAMS: ['id', 'page', 'page_size', 'q'],
  // 缓存: 新鲜期内直接返回云数据库里的副本; 源站取不到时, 过期但在 STALE_MS 内的旧数据兜底
  FRESH_MS: 30 * 60 * 1000,
  STALE_MS: 24 * 60 * 60 * 1000,
  // 跨境请求单次超时(毫秒), 依次重试; 合计要小于云函数超时(控制台设 20 秒)
  ATTEMPT_TIMEOUTS: [4000, 5000, 6000],
  // 定时触发器预热的请求: [路径, 参数]
  PREWARM: [['/api/summary', {}], ['/api/items', { page: 1, page_size: 20 }]],
  COLLECTION: 'relay_cache',
  USER_AGENT: 'wx-cloud-relay/1.0'
};
