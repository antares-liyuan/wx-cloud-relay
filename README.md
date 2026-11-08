# wx-cloud-relay

**服务器在境外、小程序要上线**时用的云开发中转：小程序 → 云函数 → 你的境外 API，带白名单、缓存和兜底。

A WeChat Cloud Function relay for mini programs whose API server is outside mainland China.

## 为什么需要它

小程序的 `request` 合法域名必须完成 ICP 备案，而境外服务器做不了备案。微信云开发的云函数可以访问外网，
于是让小程序只调云函数、云函数再去拉境外接口。直接这么做会遇到三个问题，这个模板都处理了：

| 问题 | 处理 |
|---|---|
| 云函数被当成开放代理 | 只放行 `ALLOW_PATHS` / `ALLOW_PATTERNS` 里的路径和 `ALLOW_PARAMS` 里的参数，值限长 |
| 跨境网络慢、偶发超时 | 分段超时重试（默认 4s/5s/6s，合计小于云函数超时） |
| 每次打开都跨境取数 | 云数据库缓存：30 分钟内直接返回；源站取不到时 24 小时内的旧数据兜底；定时触发器预热常用接口 |

小程序端的 `miniprogram/api.js` 再加一层本机缓存：5 分钟内重复打开不发请求，断网时用旧数据。

## 用法

1. 改 `cloudfunctions/relay/config.js`：`ORIGIN`（你的 https 源站）、放行路径和参数、缓存时长。
2. 云开发控制台建集合 `relay_cache`；把云函数超时设为 20 秒。
3. 微信开发者工具里右键 `cloudfunctions/relay` →「上传并部署：云端安装依赖」，`config.json` 里的定时触发器会每 10 分钟预热一次。
4. 小程序里：

```js
// app.js
wx.cloud.init({ env: '你的云环境ID' });

// 页面
const api = require('../../utils/api.js');   // 即 miniprogram/api.js
api.request('/api/items', { page: 1 }).then(data => this.setData({ items: data.items }));
```

> 源站只适合放**公开、只读**的数据。不要通过它转发需要登录态或写操作的接口。

## 测试

```bash
node tests/test_relay.js      # 本地起一个假源站, 测白名单/缓存/兜底
```

## License

MIT
