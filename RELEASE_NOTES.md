# Ncard 名片小程序 Release Notes

---

## v1.1.2 (2026-06-18)

### 🐛 分享气泡卡片接收方不可见修复（P0，6 轮迭代）

**问题**：分享名片到微信聊天后，发送方预览正常，但接收方气泡消息标题降级为小程序名、图片空白。

**根因（三轮定位）**：
1. **时序竞态**：`edit/index.js:_generateAndStoreShareImage()` 在 `navigateBack(1500ms)` 前未完成（Canvas+上传需 ~2800ms），页面销毁导致 shareImageUrl 从未成功写入 DB
2. **cloud:// 不可跨设备**：微信文档宣称基础库 2.8.1+ 支持 cloud:// 作为 imageUrl，实测仅发送方可用，接收方无法解析
3. **扩展名/格式不匹配**：`canvasToTempFilePath({ fileType: 'jpg' })` 但 `cloudPath` 使用 `.png` 扩展名 → 微信真机严格校验格式失败

**修复**：

| 文件 | 修改 |
|------|------|
| `pages/edit/index.js` | `saveCard` Promise 链等待分享图生成；`_generateAndStoreShareImage` 返回 Promise + 15s 超时；`cloud://` → HTTPS CDN URL 存储；`.png` → `.jpg` 扩展名 |
| `pages/index/index.js` | `onShareAppMessage(options)` 利用 `options.target.dataset` 获取卡片 ID（不依赖 bindtap 时序）；全部路径同步返回；存量 `cloud://` 自动转 HTTPS + 缓存 busting 时间戳；Canvas 后台生成改为 fire-and-forget；空卡防护；try-catch 保护 |
| `utils/shareCard.js` | `fileType: 'png'` → `'jpg'`，`quality: 0.7`（<128KB 微信硬限制） |

**部署要求**：
- MP 后台 → downloadFile合法域名 → 添加 `https://636c-cloudbase-d0gqgpu422d7e544f-1432712671.tcb.qcloud.la`
- 存量卡片需编辑保存一次触发新分享图生成
- 接收方可能需删除聊天记录清除微信客户端缓存

### ⚠️ 部署检查清单

- [ ] MP 后台 downloadFile 合法域名已配置（`tcb.qcloud.la` CDN 域名）
- [ ] 存量卡片重新编辑保存生成 JPEG 分享图
- [ ] 真机双端验证分享气泡显示

---

## v1.1.1 (2026-06-17)

### 🐛 首页编译错误修复 + UX 优化 + crop 页面恢复

**紧急修复**：
- `index.wxml` UTF-8 编码损坏导致 WXML 编译 `unexpected end` 错误（10 行中文截断），从 git 历史恢复干净版本

**UX 优化**：
- 无名片时隐藏右下角新增名片悬浮按钮（`wx:if="{{!isEmpty}}"`），避免空白区域出现无意义按钮
- 空状态提示文案更新："点击右上角创建您的第一张名片" → "点击按钮创建您的第一张名片"
- 悬浮按钮与名片列表数据联动：创建第一张名片后自动恢复显示

**crop 头像裁切恢复**：
- 从 git 历史恢复 `miniprogram/pages/crop/` 完整功能（movable-area 缩放 + Canvas 400×400 裁切 + 九宫格辅助线）
- `app.json` 注册 `pages/crop/index`
- edit 页恢复 `chooseAvatar → globalData.cropImageSrc → crop → onCropResult → _uploadAvatar` 完整调用链

**首页 CSS 补全**：
- 补全约 20 个缺失的 CSS 类（loading-state、stat-divider、visitor-list/content、view-all-btn、agreement-footer 等）
- 纯 CSS 图标实现（icon-card/users/eye/add/user）

**死代码清理**：
- 删除 `wx.addFavorite` 非法 API 调用、`handleVisitorAction` 死代码、`_loadRecentVisitors` 废弃方法
- 删除 `crop` 和 `test` 页面目录（crop 已恢复并重新注册）

---

## v1.1.0 (2026-06-17)

### 🏥 深度审核修复（12 项）

基于代码深度诊断审核，全面修复阻塞上线和影响代码质量的问题。

#### P0 阻塞上线（3 项）

| # | 问题 | 修复 |
|---|------|------|
| 1 | `getQrCode` 云函数代码缺失 | 评估后确认无前端消费场景，**删除整个云函数** |
| 2 | `index.wxml` empty-state 重复渲染节点 | 删除第31-34行裸露重复子元素 |
| 3 | `initVisits`/`deleteCard` 缺少 `wx-server-sdk` 依赖 | package.json 补充 `dependencies` |

#### P1 上线前修复（4 项）

| # | 问题 | 修复 |
|---|------|------|
| 4 | `selectDefaultCard` 选择未持久化 | cards 集合 `isDefault` 字段云端持久化 + 本地缓存双写 |
| 5 | `DOCUMENTATION.md` 10+ 处与代码不一致 | 全面重写，对齐当前代码实际状态 |
| 6 | `DEPLOYMENT-GUIDE.md` 集合/功能/权限描述错误 | 修订集合名、移除 OCR/TabBar 过时引用 |
| 7 | `profile.loadCardList` 无显式 `_openid` 过滤 | 添加 `.where({ _openid: myOpenId })` |

#### P2 上线后优化（5 项）

| # | 问题 | 修复 |
|---|------|------|
| 8 | 主题选择仅本地存储，换设备丢失 | visitor_profiles 增加 `themeColor` 字段云同步 |
| 9 | 首页/访客页空壳操作按钮 | WXML 中移除 `visitor-button` 元素 |
| 10 | `visitors/index.js` ES5/ES6 混用 | 全面改写为 ES6（const/let + 箭头函数 + 展开运算符） |
| 11 | `sitemap.json` 默认全允许 | preview/visitors/list/profile 禁止搜索引擎收录 |
| 12 | `edit` 页 crop 页面死代码 | chooseAvatar 改为直接上传，删除 `onCropResult` |

### 📊 变更统计

```
修改文件：
- miniprogram/pages/index/index.wxml          (重复节点删除 + visitor-button 移除)
- miniprogram/pages/visitors/index.wxml        (visitor-button 移除)
- miniprogram/pages/visitors/index.js           (ES5→ES6 全面改写)
- miniprogram/pages/profile/index.js           (默认名片云持久化 + 主题云同步 + loadCardList 过滤)
- miniprogram/pages/profile/index.wxml          (版本号 v1.0.6 → v1.0.9)
- miniprogram/pages/edit/index.js              (chooseAvatar 直接上传 + 删除 onCropResult)
- miniprogram/sitemap.json                     (隐私页面禁止收录)
- cloudfunctions/initVisits/package.json        (补充 wx-server-sdk 依赖)
- cloudfunctions/deleteCard/package.json        (补充 wx-server-sdk 依赖)
- DOCUMENTATION.md                             (全面重写)
- DEPLOYMENT-GUIDE.md                          (修订过时内容)

删除文件：
- cloudfunctions/getQrCode/                    (整目录删除，无消费场景)
```

### ⚠️ 部署检查清单

- [ ] 部署 3 个云函数到生产环境（getOpenId / initVisits / deleteCard）
- [ ] 云控制台确认 `visitor_profiles` 集合存在（新增 themeColor 字段需要此集合）
- [ ] 云控制台确认 `cards` 集合支持 `isDefault` 字段写入
- [ ] MP 后台配置隐私保护指引（勾选「收集你选中的照片或视频文件」+「获取你的相机权限」）
- [ ] 提交微信审核
- [ ] 云控制台 → 存储权限 → 改为「仅创建者可读写」
- [ ] 删除云存储中的孤儿目录（avatar/、avartar/、scans/、cards/）

---

## v1.0.9 (2026-06-16)

### 🎨 分享卡片 v8 重构：5:4 比例规范导出

**问题根因**：微信分享图显示容器强制 5:4 比例，非 5:4 图片会被居中裁剪，导致右侧内容被截断。

**v8 方案 D — Banner 触顶 + 透明间隙 + 底部留白**：
```
┌─────────────────────────┐  y=0
│  浅蓝 Banner（CTA触顶）  │  ~80px
├─────────────────────────┤
│   透明间隙（上下均分）    │  ~30px  ← 上半部留白
├─────────────────────────┤
│                         │
│      名片卡片主体        │  ~419px（与首页 WXML 一致）
│                         │
├─────────────────────────┤
│   底部透明留白           │  ~30px  ← 下半部留白
└─────────────────────────┘  总计 480px（600×480 = 精确 5:4）
```

**技术要点**：
- `_computeCanvasSize()` → 计算出 `canvasTotalH=480`、`extraTop` 间隙
- `cardOffsetY = bannerH + gapTop`，Banner 自然锚定 y=0，无需 `ctx.translate`
- 导出时使用 `layout.totalH`（480）作为目标高度，保证精确 5:4

### 🔒 Canvas 序列化锁

**问题**：多张名片共用 `#shareCanvas`，并发生成时 Canvas 状态被覆盖，导致第二张名片头像降级为占位符。

**修复**：
- 新增 `_canvasLock` Promise 链，所有 `generate()` 调用排队执行
- `_layoutPromise` 从全局单例改为 `{[contactCount]: Promise}` 字典
- 防止不同联系方式数的卡片并发布局计算互相污染

### 🔗 编辑 → 首页/预览页数据刷新联动

**问题**：编辑名片后返回首页/预览页，列表不刷新，分享缓存使用旧数据。

**修复**：
- `edit/index.js`：保存成功后设置 `cardsNeedRefresh` + `lastCardUpdate` 缓存标志
- `index/index.js`：`onShow` 检测 `cardsNeedRefresh` → 强制重新加载 + 清除分享图片缓存
- `preview/index.js`：`onShow` 始终重新加载名片（移除 `isError` 前置条件）

### 📐 首页 Canvas 尺寸动态计算

- `canvasWidth/canvasHeight` 从 `cardStyle` 配置动态计算，不再硬编码
- `canvasHeight = Math.round(fitted.width * 4 / 5)` — 确保与 shareCard 一致
- 后台预生成分享卡片（`_preGenerateVisibleCards`），避免用户点击分享时图片未就绪

### 🏗️ 架构改进

- **引入 `cardStyle.js` 统一数据源**：shareCard 和 index 共用同一套样式配置
  - `CARD.cardWidth`、`calcCardHeight()`、`rpxToCanvas()`、`fitToBubbleSize()` 等
  - 告别硬编码像素值，尺寸调整只需改一处
- **布局缓存分层**：`_layoutCache` 按 `宽度×高度_联系方式数` 分键存储
- **版本化缓存 key**：`v3_` 前缀，数据结构变更时旧缓存自动失效

### 📊 变更统计

```
9 files changed, 1201 insertions(+), 458 deletions(-)
```

| 类别 | 文件 | 变化 |
|------|------|------|
| 分享卡片核心 | `utils/shareCard.js` | +709/-396 (v2→v4 重写) |
| 首页逻辑 | `pages/index/index.js` | +326/-? |
| 首页模板/样式 | `index.wxml` `index.wxss` | 微调 |
| 编辑/预览联动 | `edit/index.js` `preview/index.js` | +7 |
| 项目记忆 | `.workbuddy/memory/` | 工作日志 |

### 🐛 修复的 Bug

| Bug | 根因 | 修复 |
|-----|------|------|
| 分享卡片右侧截断 | Canvas 导出非 5:4 比例被微信居中裁剪 | 强制导出 600×480（5:4），透明区填充 |
| 第二张名片头像降级 | 多卡片共享 Canvas 竞态 | `_canvasLock` 序列化锁 |
| 布局缓存串扰 | 全局单例 `_layoutPromise` | 按 `contactCount` 分键 |
| 编辑后首页不刷新 | 缺少数据变更通知机制 | `cardsNeedRefresh` 缓存标志 |
| 预览页使用旧数据 | `onShow` 仅在 `isError` 时才重新加载 | 始终重新加载 |

---

## v1.0.8 (2026-06-16)

### 🆕 访客追踪系统两期优化

**静默注册访客身份**
- 用户首次使用小程序时，`onShow` 自动将 openid 记录到 `visitor_profiles` 集合
- 三级身份体系：L1(openid) → L2(微信昵称+头像) → L3(真名+头像)
- 创建名片后自动升级为 L3，`_syncVisitorProfile()` upsert 真名+头像

**云函数调用合并**
- 新增 `getMyVisitorDashboard` action，三路 `Promise.all` 一次返回：
  - 访客总数（排除自己）
  - 回访数（访问 ≥2 次）
  - 最近 20 条访客记录
- `_processRecentVisitors()` 共用聚合函数，消除重复逻辑

**auth-banner 优化**
- 移除 3s `setTimeout` 延迟，改为立即显示
- 冷却期从 7 天时间戳改为同日日期字符串比较
- 存储 key: `auth_banner_dismissed_date`

**profile 页面清理**
- 删除 `getUserInfo()` 死代码
- 移除登录按钮（头像昵称填写）
- 未登录默认名改为「微信用户」

---

### 🔒 隐私协议：官方弹窗切换

**从自定义弹窗（Option A）切换到微信官方隐私弹窗（Option B）**

| 改动项 | 说明 |
|--------|------|
| `app.js` | 删除 `_privacyResolve` / `initPrivacy()` / `wx.onNeedPrivacyAuthorization` 监听 |
| `app.js` | 新增 `showPrivacyError(err)` — 识别官方弹窗拒绝后 errCode 103/104 |
| `index.js` | 删除 `checkPrivacySetting` / `handlePrivacyAgree` / `handlePrivacyDecline` / `preventTouchMove` |
| `index.wxml` | 删除自定义隐私弹窗 UI 区块（~25 行） |
| `index.wxss` | 删除 10 个隐私弹窗样式块（~65 行） |
| `index.js` | `openPrivacyPolicy` → `wx.openPrivacyContract({})`（微信内置协议页） |
| `edit.js` | 2 处 `chooseImage` fail 增加隐私错误识别 |
| `preview.js` | 5 处 `setClipboardData` 增加 fail 回调 |

**行为变化**：首次调用云开发 API 时微信自动弹出官方弹窗；拒绝后隐私 API 返回 103/104 错误码，`showPrivacyError` 统一提示。

---

### 🐛 修复：跨用户头像无法显示

**根因**：云存储设为「仅创建者可读写」时，云函数中的 `cloud.getTempFileURL()` 仍遵守文件 ACL，跨用户返回 `STORAGE_EXCEED_AUTHORITY`。

**修复**：云函数增加 `downloadFile` → base64 data URL 降级路径：

```
getTempFileURL (批量)
  ├─ status=0 → HTTPS URL ✅
  └─ status≠0 → downloadFile → Buffer → base64 data URL ✅
       └─ 失败 → 空 URL → 客户端兜底默认头像
```

**客户端兜底**：`list/index.js` 新增 `_fallbackCloudAvatars()`，将未解析的 `cloud://` URL 替换为 `/images/avatar.png`。

---

### 🎨 UI 优化（自 v1.0.7 累积）

- 首页名片布局与参考设计稿对齐
- 移除首页 Canvas 渲染，使用传统布局
- 右下角新增名片悬浮按钮恢复
- 底部按钮区域对比色配色优化
- 发名片按钮移入卡片内部
- 优化联系方式显示，移除详情页发名片按钮
- `shareCard.js` canvas 分享卡片容错增强

---

### 📊 变更统计

```
22 files changed, 1890 insertions(+), 1607 deletions(-)
```

| 类别 | 文件数 | 净变化 |
|------|--------|--------|
| 云函数 | 3 | +139 |
| 页面逻辑 | 5 | +85 |
| 页面模板/样式 | 5 | -760/+525 |
| 工具/配置 | 3 | +38 |
| 文档/记忆 | 6 | +473 |

---

### ⚠️ 部署检查清单

- [ ] 确认云存储「仅创建者可读写」权限配置
- [ ] 确认 `visitor_profiles` 集合索引：`openid`（唯一）、`createdAt`
- [ ] 确认隐私协议在微信后台已配置
- [ ] 测试跨用户头像显示
- [ ] 测试官方隐私弹窗首次启动行为
