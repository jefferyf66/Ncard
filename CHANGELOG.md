# 更新日志

本文件格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [1.3.0] - 2026-08-19

### Added
- 访客数据 per-card 化：`initVisits` 的 `getMyVisitorStats` / `getRecentVisitors` / `getMyVisitorDashboard` 三聚合 action 新增可选 `cardId` 维度（缺省保持全局聚合，向后兼容）
- 名片详情页新增「访客分析」区（仅名片主人可见）：本名片访客数 / 重复访问 / 最近访客 Top5，「查看全部」跳访客页单卡筛选
- 访客页支持 `?cardId=` 单卡筛选；单卡模式头部自适应「本名片访客」+ 卡片名，第三指标切换为「最近访客」，并提供「全部名片 ›」回全局
- 团队能力增强：公开团队目录、整组分享、团队详情点成员查看其在本团队下的托管名片、owner 专属解散团队（级联清理成员 / 名片关联 / 邀请码）
- 首页「添加到桌面」实现优化

### Changed
- 首页 UI 对齐设计系统（对齐 / 错误态 / 统计语义修复）
- 首页头部重排：我的团队左移并带实时团队数，添加到桌面归位右上
- 首页团队入口移出头部，改置底部固定双按钮栏（方案C）

### Removed
- 首页「名片数据」三宫格（我的访客 / 多次来访 / 名片夹）与「最近访客」列表整块移除（访问数据改为随具体名片走，归位于详情页 per-card 维度）
- 首页 4 个纯 CSS 图标死代码样式（icon-users / icon-eye / icon-add / icon-user）

## [1.2.0] - 2026-08-17

### Fixed
- 修复 `edit` 页 `page-content` 闭合标签缺失导致的 WXML 编译错误

## [1.1.4] - 2026-08-14

### Added
- 团队租户功能设计方案 v0.4（`artifacts/team-tenant-design.md`，D1–D12 已确认：多团队、组织字段覆盖层、邀请码+分享卡片、创建查重四层机制）
- 微信 openid 快速登录机制设计方案 v0.2（`artifacts/user-login-design.md`，已对照官方文档核验：免 `wx.login`、`getUserProfile` 失效改 `chooseAvatar`+`nickname`）
- 统一详细实施方案 `artifacts/implementation-plan-v2.md`

### Changed
- 新增 `miniprogram/config/storage.js` 作为云存储 HTTPS 基址唯一真源，移除 `app.js` / `shareCard.js` / `edit/index.js` / `index/index.js` 共 5 处硬编码 `636c-cloudbase-...`
- `miniprogram/pages/profile/index.js` 关于弹窗版本号改为读取 `app.globalData.version`（单一真源）
- 替换 `crop` / `shareCard` / `index` 三处弃用 `wx.getSystemInfoSync()` 为官方推荐 `getWindowInfo` / `getDeviceInfo` / `getAppBaseInfo`

### Chore
- `.gitignore` 新增 `.workbuddy/` 规则，取消跟踪内部产物（memory / cache / screenshots / artifacts），不再进版本库

## [1.1.3] - 2026-06-18

### Fixed
- **分享气泡卡片接收方不可见**：根因为 MP 后台「分享安全校验」开关导致服务端验签失败。关闭开关即解决。
  
### Changed
- `pages/edit/index.js`: `saveCard` 改为 Promise 链等待分享图生成；新增 `_generateAndStoreShareImage`（15s 超时 + `.jpg` 上传 + HTTPS CDN URL 存储）
- `pages/index/index.js`: `onShareAppMessage(options)` 利用 `options.target.dataset` 获取卡片 ID；三层降级（预存图→实时生成→头像）；`cloud://`自动转 HTTPS；同步返回
- `utils/shareCard.js`: `fileType: 'jpg'` + `quality: 0.7`（控制 <128KB）
- `app.js`: `resolveCloudFileIDs` 简化为直接拼接 HTTPS URL
- `wx.showShareMenu`: 移除 `withShareTicket` 参数

### Removed
- `cloudfunctions/resolveCloudUrls/` — 云函数不再需要
- `miniprogram/config/cardStyle.test.js` — 测试文件

## [1.1.2] - 2026-06-18

### Fixed
- 分享气泡卡片接收方不可见（6 轮代码迭代：时序竞态 + cloud:// 跨设备 + 扩展名格式 + downloadFile 域名 + 缓存 busting）

## [1.1.1] - 2026-06-17

### Fixed
- `index.wxml` UTF-8 编码损坏导致 WXML 编译 `unexpected end` 错误
- 首页约 20 个缺失 CSS 类补全，纯 CSS 图标实现

### Changed
- 无名片时隐藏右下角新增名片悬浮按钮，空状态提示文案优化
- 恢复 `pages/crop/` 头像裁切页完整功能（movable-area 缩放 + Canvas 400×400 裁切 + 九宫格辅助线）

### Removed
- `wx.addFavorite` 非法 API 调用、`handleVisitorAction` 死代码、`_loadRecentVisitors` 废弃方法

## [1.1.0] - 2026-06-17

### Fixed
- **P0**: 删除无消费场景的 `getQrCode` 云函数
- **P0**: `index.wxml` 重复渲染节点删除
- **P0**: `initVisits`/`deleteCard` 补充 `wx-server-sdk` 依赖
- **P1**: `selectDefaultCard` 改为 `cards.isDefault` 云端持久化 + 本地缓存双写
- **P1**: `profile.loadCardList` 添加 `_openid` 过滤
- **P1**: `DOCUMENTATION.md`/`DEPLOYMENT-GUIDE.md` 过时引用修正

### Changed
- `visitors/index.js` ES5→ES6 全面改写
- `sitemap.json` 隐私页面禁止收录
- `profile/index.js` 主题色切换增加到 `visitor_profiles.themeColor` 云同步

### Removed
- 首页/访客页空壳操作按钮

## [1.0.9] - 2026-06-16

### Added
- 分享卡片 Canvas 生成器 v8：精确 5:4 比例（600×480），Banner 触顶 + 间隙居中布局
- Canvas 序列化锁（`_canvasLock`）防止多卡片并发生成竞态
- 编辑页保存后 `cardsNeedRefresh` 联动首页刷新
- `cardStyle.js` 统一样式数据源

### Fixed
- 分享卡片右侧截断（非 5:4 被微信裁剪）
- 多卡片并发生成时第二张名片头像降级
- 编辑后首页/预览页数据不刷新

## [1.0.8] - 2026-06-16

### Added
- 三级匿名访客身份识别（L1 注册→L2 授权→L3 卡片用户）
- `getMyVisitorDashboard` 云函数合并三路查询
- 非阻断式授权引导条（当天冷却期）

### Changed
- 自定义隐私弹窗 → 微信官方隐私弹窗（`__usePrivacyCheck__: true`）
- 云函数增加 `downloadFile`→base64 降级路径修复跨用户头像访问

### Fixed
- 云存储「仅创建者可读写」时跨用户头像 `STORAGE_EXCEED_AUTHORITY`

## [1.0.8] - 2026-06-13

### Changed
- 首页发名片按钮使用微信原生 `open-type="share"`，异步预生成分享卡片

### Fixed
- 首页发名片按钮点击后跳转到预览页
- 事件冒泡阻止失效

## [1.0.0] - 2026-06-01

### Added
- 初始发布：名片 CRUD、OCR 扫描、名片预览、访客记录、数据概览、个人中心
- 品牌蓝设计系统（#3B82F6 主色 + 编辑器字体钮形 + 暖调渐变背景）
- 底部 TabBar 三页导航
