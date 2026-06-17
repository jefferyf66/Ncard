# 科博名片小程序 - 项目文档

---

## 1. 项目概述

**项目名称**：科博名片（Kebo Business Card）

**项目简介**：一款专业的电子名片管理微信小程序，支持名片创建、编辑、预览、分享、访客追踪、名片夹管理等功能，采用微信云开发技术栈实现。

**技术栈**：

| 分类 | 技术 | 说明 |
|------|------|------|
| 框架 | 微信小程序 | 原生（style: v2） |
| 后端 | 微信云开发 | DYNAMIC_CURRENT_ENV |
| 数据库 | 云开发 NoSQL | 5 个活跃集合 |
| 云函数 | Node.js (wx-server-sdk) | 5 个云函数 |
| 基础库 | 3.16.0 | project.config.json 配置 |
| 隐私 | 官方弹窗模式 | `__usePrivacyCheck__: true` |

**AppID**：`wxd15d78bd1a5b75ef`

---

## 2. 技术架构

### 2.1 双线程架构

微信小程序采用双线程模型：

- **渲染层（WebView）**：负责 WXML 模板渲染和 WXSS 样式计算，每个页面运行在独立的 WebView 线程中
- **逻辑层（JsCore）**：负责 JS 逻辑执行，所有页面共享同一个 JsCore 线程

两层通过微信 Native 层进行通信，`setData` 调用会触发从逻辑层到渲染层的数据传递。

### 2.2 云开发架构

```
┌─────────────────────────────────────────────────────────────┐
│                    微信小程序客户端                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │   页面层     │ │   工具模块   │ │   app.js    │          │
│  │ (7 Pages)   │ │ (utils/)    │ │ (全局方法)   │          │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘          │
└─────────│────────────────│────────────────│─────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                    微信云开发平台                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │  云数据库    │ │  云函数      │ │  云存储      │          │
│  │ (5 集合)    │ │ (5 函数)    │ │ (3 目录)    │          │
│  │ cards       │ │ getOpenId   │ │ avatars/    │          │
│  │ visits      │ │ initVisits  │ │ attachments/│          │
│  │ user_save_  │ │ deleteCard  │ │ qrcodes/    │          │
│  │ cards       │ │ resolve     │ │             │          │
│  │ visitor_    │ │ CloudUrls   │ │             │          │
│  │ profiles    │ │ getQrCode   │ │             │          │
│  │ config      │ │             │ │             │          │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 页面路由表

| 页面路径 | 页面名称 | 功能描述 | 是否首页 |
|---------|---------|---------|---------|
| `pages/index/index` | 首页 | 名片列表、访客统计、分享卡片生成 | ✅ |
| `pages/edit/index` | 编辑页 | 创建/编辑名片信息 | - |
| `pages/preview/index` | 预览页 | 名片详情展示、操作、访客记录 | - |
| `pages/visitors/index` | 访客页 | 访客统计与记录管理 | - |
| `pages/agreement/index` | 协议页 | 隐私政策、用户服务协议 | - |
| `pages/list/index` | 名片夹 | 保存的他人名片列表 | - |
| `pages/profile/index` | 个人中心 | 主题选择、默认名片、设置 | - |

> **注意**：无 tabBar 配置，所有页面通过 `wx.navigateTo` 导航，首页 `pages/index/index` 为入口页。

---

## 3. 目录结构

```
Ncard/
├── cloudfunctions/                # 云函数目录
│   ├── getOpenId/                 # 获取用户 OpenID
│   │   └── index.js
│   ├── initVisits/                # 访客记录管理（多 action）
│   │   └── index.js
│   ├── deleteCard/                # 级联删除名片
│   │   └── index.js
│   ├── resolveCloudUrls/          # cloud:// → HTTPS URL 转换
│   │   └── index.js
│   ├── getQrCode/                 # 生成小程序码
│   │   └── index.js
│   ├── parseCard/                 # （旧版，未激活）
│   └── quickstartFunctions/       # （模板生成，未激活）
├── miniprogram/                   # 小程序源码
│   ├── config/                    # 配置模块
│   │   ├── cardStyle.js           # 名片样式/Canvas 绘制参数
│   │   └── cardStyle.test.js      # cardStyle 单元测试
│   ├── images/                    # 静态资源
│   │   ├── avatar.png             # 默认头像
│   │   └── icons/                 # 应用图标
│   │       ├── logo-app-144.png
│   │       ├── logo-app-288.png
│   │       ├── logo-app-432.png
│   │       └── logo-app.svg
│   ├── pages/                     # 页面目录
│   │   ├── index/                 # 首页
│   │   ├── edit/                  # 编辑页
│   │   ├── preview/               # 预览页
│   │   ├── visitors/              # 访客页
│   │   ├── agreement/             # 协议页
│   │   ├── list/                  # 名片夹
│   │   └── profile/               # 个人中心
│   ├── test/                      # 测试文件
│   │   ├── shareCard.test.js
│   │   └── shareFlow.test.js
│   ├── utils/                     # 工具模块
│   │   ├── shareCard.js           # 分享卡片 Canvas 生成
│   │   └── share.js               # 分享标题构建
│   ├── app.js                     # 应用入口 + 全局工具方法
│   ├── app.json                   # 全局配置
│   ├── app.wxss                   # 全局样式
│   └── sitemap.json               # 站点地图
├── project.config.json            # 项目配置
├── .gitignore                     # Git 忽略配置
└── DOCUMENTATION.md               # 本文档
```

---

## 4. 数据库集合

### 4.1 cards — 名片集合

| 字段名 | 类型 | 含义 | 必填 | 默认值 |
|--------|------|------|------|--------|
| _id | string | 文档ID（自动生成） | 自动 | - |
| _openid | string | 创建者 OpenID（云开发自动写入） | 自动 | - |
| name | string | 姓名 | 是 | - |
| position | string | 职位 | 否 | '' |
| company | string | 公司名称 | 是 | - |
| phone | string | 手机号码 | 否 | '' |
| email | string | 邮箱地址 | 否 | '' |
| address | string | 地址 | 否 | '' |
| avatar | string | 头像（云存储 fileID 或 HTTPS URL） | 否 | '' |
| personalIntro | string | 个人介绍 | 否 | '' |
| businessIntro | string | 业务介绍 | 否 | '' |
| experiences | array | 过往经历列表 | 否 | [] |
| attachments | array | 附件列表 | 否 | [] |
| wechatOfficial | object | 公众号信息 | 否 | `{name:'',desc:'',url:''}` |
| companyWebsite | object | 公司主页信息 | 否 | `{name:'',url:'',desc:''}` |
| publicSettings | object | 各模块公开/隐藏开关 | 否 | 见下方 |
| isDefault | boolean | 是否为默认名片 | 否 | false |
| createTime | Date | 创建时间 | 自动 | new Date() |
| updateTime | Date | 更新时间 | 自动 | new Date() |

**publicSettings 对象**：

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| showPersonalIntro | boolean | true | 是否公开个人介绍 |
| showBusinessIntro | boolean | true | 是否公开业务介绍 |
| showExperiences | boolean | true | 是否公开过往经历 |
| showWechatOfficial | boolean | true | 是否公开公众号信息 |
| showCompanyWebsite | boolean | true | 是否公开公司主页 |
| showAttachments | boolean | true | 是否公开附件 |

**experiences 数组元素**：

| 字段 | 类型 | 含义 |
|------|------|------|
| company | string | 公司名称 |
| position | string | 职位 |
| period | string | 工作时间 |
| desc | string | 描述 |

**attachments 数组元素**：

| 字段 | 类型 | 含义 |
|------|------|------|
| name | string | 文件名 |
| url | string | 云存储 fileID |
| size | string | 文件大小 |
| time | string | 上传时间 |

### 4.2 visits — 访客记录集合

| 字段名 | 类型 | 含义 |
|--------|------|------|
| _id | string | 文档ID |
| cardId | string | 被访问名片 ID |
| cardOwnerId | string | 名片所有者 OpenID |
| visitorOpenId | string | 访客 OpenID |
| visitorName | string | 访客姓名（L2/L3 身份时填充） |
| visitorAvatar | string | 访客头像 URL（L2/L3 身份时填充） |
| visitorPosition | string | 访客职位（L3 身份时填充） |
| visitorCompany | string | 访客公司（L3 身份时填充） |
| visitorPhone | string | 访客电话（L3 身份时填充） |
| visitorLevel | number | 访客身份等级（1=匿名 / 2=已授权 / 3=卡片用户） |
| visitCount | number | 累计来访次数 |
| visitTime | Date | 最近访问时间 |
| source | string | 访问来源（direct/share/scan） |
| actions | array | 访问行为记录 |

### 4.3 user_save_cards — 名片夹集合

| 字段名 | 类型 | 含义 |
|--------|------|------|
| _id | string | 文档ID |
| _openid | string | 保存者 OpenID（云开发自动写入） |
| cardId | string | 保存的名片 ID |
| cardOwnerOpenId | string | 名片所有者 OpenID |
| savedAt | Date | 保存时间 |

### 4.4 visitor_profiles — 访客身份集合

| 字段名 | 类型 | 含义 |
|--------|------|------|
| _id | string | 文档ID |
| openid | string | 用户 OpenID |
| nickname | string | 微信昵称（L2 授权后填充）或真实姓名（L3 卡片用户） |
| avatarUrl | string | 头像 URL |
| themeColor | string | 用户选择的主题色（如 `#3B82F6`） |
| createdAt | Date | 创建时间 |
| updatedAt | Date | 更新时间 |

### 4.5 config — 全局配置集合

用于存储小程序全局配置信息（如版本号、功能开关等）。

---

## 5. 云函数

### 5.1 getOpenId

**功能**：获取当前用户的 OpenID、AppID、UnionID

**入口参数**：无（从 `cloud.getWXContext()` 获取）

**返回值**：

```javascript
{
  success: true,
  data: {
    openid: string,
    appid: string,
    unionid: string   // 可能为空
  }
}
```

### 5.2 initVisits

**功能**：访客记录管理（多 action 云函数），支持以下操作：

| Action | 功能 | 关键参数 |
|--------|------|---------|
| `ensureCollection` | 确保 visits 集合存在 | 无 |
| `recordVisit` | 记录一次名片访问 | cardId, visitorOpenId, cardOwnerId, source |
| `getMyVisitorStats` | 获取访客统计 | cardOwnerId |
| `getRecentVisitors` | 获取最近访客列表 | cardOwnerId, limit |
| `getMyVisitorDashboard` | 获取访客仪表盘（统计+最近访客合并调用） | cardOwnerId |

**recordVisit 三级访客身份识别（enrichment）**：

| 等级 | 条件 | 显示方式 |
|------|------|---------|
| L3 | 访客有自己的名片（cards 集合中查到） | 真实姓名 + 头像 + 职位 + 公司 |
| L2 | 访客在 visitor_profiles 中有授权记录 | 微信昵称 + 头像 |
| L1 | 以上均无 | "访客 #XXXX"（OpenID 后4位） |

**recordVisit 去重逻辑**：
- 30 分钟内同一用户访问同一名片：更新 `visitTime` + `visitCount++` + 身份 enrichment 升级
- 超过 30 分钟：创建新记录
- 访问自己的名片：跳过不记录（`skipped: true`）

**getMyVisitorDashboard 返回值**：

```javascript
{
  ok: true,
  visitors: number,        // 访客总数
  viewed: number,          // 多次来访数
  recentVisitors: array    // 最近20条访客记录
}
```

### 5.3 deleteCard

**功能**：级联删除名片（数据库 + 云存储），校验所有权

**入口参数**：`cardId`

**处理流程**：

1. 查询 cards 文档，校验 `_openid === 调用者 openid`
2. 收集需要删除的云存储文件（avatar + attachments 中的 cloud:// URL）
3. 并行执行清理操作（Promise.all，allSettled 容错）：
   - 删除 cards 文档
   - 删除 user_save_cards 中所有保存记录
   - 删除 visits 中所有访客记录
   - 删除云存储文件
4. 汇总结果，部分失败仍算基本成功

**返回值**：

```javascript
{
  ok: boolean,
  allSettled: true,
  results: array,         // 每步操作结果
  failedCount: number,
  message: string
}
```

### 5.4 resolveCloudUrls

**功能**：批量将 `cloud://` 文件 ID 转换为 HTTPS URL，绕开云存储 ACL 权限限制

**入口参数**：`fileIDs`（string 数组）

**处理流程**：

1. **Step 1**：批量 `getTempFileURL`（对当前用户有权限的文件直接获取临时 URL）
2. **Step 2**：对 Step 1 失败的文件（ACL 拒绝），降级 `downloadFile`（管理员权限） → base64 data URL

**内存缓存机制**：
- 缓存结构：`fileID → { tempFileURL, expireAt }`
- 临时 URL 有效期 2h，缓存 115 分钟
- 至少剩余 1 分钟才复用缓存

**返回值**：

```javascript
{
  urls: {                    // fileID → URL 映射
    "cloud://xxx": "https://...",     // getTempFileURL 成功
    "cloud://yyy": "data:image/..."   // downloadFile 降级
  }
}
```

### 5.5 getQrCode

**功能**：生成名片小程序码，上传到云存储

**入口参数**：

| 参数 | 类型 | 含义 |
|------|------|------|
| cardId | string | 名片 ID（作为 scene 参数，最长 32 字符） |
| page | string | 落地页路径，默认 `pages/preview/index` |

**处理流程**：

1. 调用 `cloud.openapi.wxacode.getUnlimited()` 生成小程序码
2. 根据 `contentType` 确定扩展名（jpg/png）
3. 上传到云存储 `qrcodes/{cardId}.{ext}`
4. 返回 fileID

**返回值**：

```javascript
{ fileID: string }   // 成功
{ error: string }    // 失败
```

---

## 6. 云存储路径

| 路径 | 用途 | 上传方 |
|------|------|--------|
| `avatars/` | 用户头像 | edit 页（`chooseAvatar` → `_uploadAvatar`） |
| `attachments/` | 名片附件图片 | edit 页（`chooseAttachment`） |
| `qrcodes/` | 名片小程序码 | getQrCode 云函数 |

**文件命名规则**：
- 头像：`avatars/{timestamp}.jpg`
- 附件：`attachments/attachment_{timestamp}.jpg`
- 小程序码：`qrcodes/{cardId}.{ext}`

**清理策略**：
- 头像更换时自动删除旧文件（`_uploadAvatar` 中 `wx.cloud.deleteFile`）
- 附件删除时自动删除云文件（`deleteAttachment` 中 `wx.cloud.deleteFile`）
- 名片删除时通过 `deleteCard` 云函数级联清理所有关联文件

---

## 7. 页面说明

### 7.1 首页（pages/index/index）

**核心功能**：

1. **名片列表** — 按创建时间倒序展示用户名片，支持分页加载（每页 10 条）
2. **访客统计** — 我的访客 / 多次来访 / 名片数 三栏统计
3. **最近访客** — 展示最近 5 位访客，按 visitorLevel 显示不同身份信息
4. **分享卡片生成** — Canvas 2D 离屏绘制名片分享图，支持 5:4 比例适配微信气泡
5. **快捷入口** — 创建名片、名片夹、全部访客
6. **添加到桌面** — 引导用户添加小程序到手机桌面
7. **隐私协议** — 支持打开微信官方隐私协议页或降级到自定义协议页

**生命周期**：

- `onLoad` → `loadCards(true)` + `initShareMenu()`
- `onShow` → 静默注册 visitor_profiles + 检查缓存刷新标志/5 分钟过期策略

**数据加载策略**：

- 名片数据 10 秒超时降级到缓存
- 访客数据三级降级：云函数 → 直接查库 → 静默失败
- `cardsNeedRefresh` 缓存标志：编辑页返回时强制刷新

**分享机制**：

- `onShareAppMessage`：支持 Promise 异步等待 Canvas 生成完成（最多 8 秒，超时降级到头像）
- `onShareTimeline`：朋友圈分享，同样支持 Promise 异步
- 后台预生成：加载完成后延迟 600ms 预生成前 2 张卡片的分享图
- 按卡片 ID 独立锁定，避免全局锁阻塞不同卡片的并行生成
- Canvas 节点未就绪时自动退避重试（最多 3 次，延迟 100/300/600ms）

**关键方法**：

| 方法名 | 功能 |
|--------|------|
| `loadCards(isRefresh, callback)` | 加载名片列表，isRefresh=true 重置分页 |
| `loadVisitorData()` | 并行加载名片夹数量 + 访客统计 |
| `_loadVisitorStats()` | 云函数方式加载访客统计 |
| `_loadVisitorStatsDirect()` | 降级：直接查 visits 集合 |
| `_processRecentVisitors(rawVisits)` | 客户端聚合去重 → Top5 → 格式化 |
| `_aggregateVisitors(visits)` | 按 visitorOpenId 归并访客记录 |
| `_formatVisitorItem(v)` | 按等级格式化访客展示数据 |
| `_preGenerateShareCardWithKey(card, cardId, retryCount)` | 生成分享卡片图片（带重试） |
| `_preGenerateVisibleCards(cards)` | 后台预生成前 2 张卡片的分享图 |
| `onShareButtonTap(e)` | 分享按钮点击：设置 shareCardData 并触发生成 |
| `onAvatarError(e)` | 头像加载失败降级为默认头像 |
| `_registerVisitorProfile()` | 静默注册访客身份（idempotent） |

---

### 7.2 编辑页（pages/edit/index）

**核心功能**：

1. **头像上传** — 直接打开系统相册选择图片，上传到云存储（无裁切页）
2. **基本信息** — 姓名、职位、公司、电话、邮箱、地址
3. **个人介绍** — 多行文本输入，可切换公开/隐藏
4. **业务介绍** — 多行文本输入，可切换公开/隐藏
5. **过往经历** — 可添加/删除多条工作经历，支持拖拽排序（touchmove）
6. **公众号信息** — 名称、简介、链接，可切换公开/隐藏
7. **公司主页** — 名称、地址、描述，可切换公开/隐藏
8. **名片附件** — 图片附件上传/删除，可切换公开/隐藏

**头像上传流程**：

```
点击头像 → wx.chooseImage({ sourceType: ['album'] })
  → 直接上传到云存储 avatars/ 目录
  → 删除旧头像云文件
  → 更新 data.avatar
```

> **注意**：已移除裁切页（crop），选图后直接上传，不再跳转。

**保存逻辑**：

- 新建（无 `id`）→ `collection('cards').add()`
- 编辑（有 `id`）→ `collection('cards').doc(id).update()`
- 保存前自动过滤空白经历条目（`company || position` 为空则移除）
- 保存成功后同步更新 `visitor_profiles`（将真实姓名/头像写入，升级为 L3 卡片用户）
- 设置 `cardsNeedRefresh` 缓存标志通知首页刷新
- 1.5 秒后自动返回

**表单验证**：

| 字段 | 规则 | 错误提示 |
|------|------|---------|
| name | 非空 | 请输入姓名 |
| company | 非空 | 请输入公司名称 |
| phone | `/^1[3-9]\d{9}$/`（选填） | 请输入正确的手机号码 |
| email | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`（选填） | 请输入正确的邮箱地址 |

---

### 7.3 预览页（pages/preview/index）

**核心功能**：

1. **名片详情展示** — 头像、姓名、职位、公司、联系方式、介绍、经历等
2. **访客记录** — 访问他人名片时自动记录（含三级身份识别）
3. **cloud:// 头像解析** — 通过 `resolveCloudFileIDs` 将云文件 ID 转为 HTTPS URL
4. **保存/移除名片** — 保存他人名片到名片夹（user_save_cards）
5. **保存通讯录** — 调用 `wx.addPhoneContact` 保存到手机通讯录
6. **联系方式操作** — 电话（拨打/复制）、邮箱（复制）、地址（复制）
7. **公众号/公司主页** — 复制链接到剪贴板
8. **附件下载** — 下载云文件并打开预览
9. **编辑/删除** — 所有者可编辑和级联删除名片
10. **匿名访客授权引导** — L1 访客访问时底部展示授权引导条

**访客记录机制**：

```
loadCard(id) → 数据就绪后 → recordVisit(id, options)
  ├── getOpenId() 获取 visitorOpenId
  ├── 自有名片：跳过不记录
  └── initVisits 云函数 recordVisit
       ├── 三级身份 enrichment (L3 → L2 → L1)
       ├── 30 分钟内重复：更新 visitTime + visitCount++
       └── 新访问：创建新记录
```

**cloud:// 头像解析**：

```
_resolveCardAvatar(card)
  ├── cloud:// 头像 → app.resolveCloudFileIDs() → 替换为 HTTPS URL
  └── 解析失败 → 兜底为 /images/avatar.png
```

**授权引导条**：

- 仅对 L1（匿名）访客展示
- 当天内拒绝后不再显示（冷却期：同一自然日，`auth_banner_dismissed_date` Storage）
- 用户点击"授权" → `wx.getUserProfile` 获取昵称/头像 → 写入 visitor_profiles
- 官方隐私弹窗模式下，`wx.getUserProfile` 的 errCode 103/104 会统一提示

**名片所有权判断**：

```
_checkCardOwnership(cardId)
  ├── openId === card._openid → isOwner: true
  └── 否则 → 查询 user_save_cards → isSaved: true/false
```

**级联删除**：

```
deleteCard() → deleteCard 云函数
  ├── 校验所有权
  ├── 并行清理：cards + user_save_cards + visits + 云存储文件
  └── 降级：云函数未部署时直接删 cards 文档
```

---

### 7.4 访客页（pages/visitors/index）

**核心功能**：

1. **统计数据** — 访客数 / 多次来访 / 名片夹数量 三栏
2. **访客列表** — 最近访客（最多 50 条），含身份信息、访问次数、来源描述

**数据加载策略**：

```
loadVisitors()
  ├── 获取 openId
  ├── 并行：user_save_cards.count() + initVisits(getMyVisitorStats)
  ├── initVisits(getRecentVisitors) → _processVisitors()
  └── 降级：_loadVisitorsDirect()（直接查 visits 集合）
```

**客户端聚合**：

- `_mergeVisitorsByOpenId(visitors)`：同一 visitorOpenId 的多次访问归并为一条，累加 visitCount
- 与首页 `_aggregateVisitors` 逻辑保持一致

---

### 7.5 协议页（pages/agreement/index）

**核心功能**：隐私政策 + 用户服务协议展示，支持 Tab 切换

- 通过 URL 参数 `tab` 控制初始展示：`privacy`（默认）或 `service`
- 内容以 HTML 富文本形式内嵌在 JS 中（`getPrivacyContent()` / `getServiceContent()`）
- 首页通过 `wx.openPrivacyContract` 打开微信官方隐私协议页，降级时跳转此页面
- 隐私政策更新/生效日期：2026年6月3日

---

### 7.6 名片夹（pages/list/index）

**核心功能**：展示用户保存的他人名片列表

**数据流程**：

```
loadCards()
  ├── getOpenId()
  ├── 查询 user_save_cards（按 savedAt 倒序）
  ├── 提取 cardId 列表 → _fetchCardsByIds()
  │    ├── 批量查询 cards 集合
  │    ├── 解析 cloud:// 头像为 HTTPS URL
  │    └── 兜底：未解析成功的 cloud:// 替换为 /images/avatar.png
  └── 支持下拉刷新
```

---

### 7.7 个人中心（pages/profile/index）

**核心功能**：

1. **主题色选择** — 6 种配色方案，本地 + 云端双写（visitor_profiles.themeColor）
2. **默认名片设置** — 从自己的名片列表中选择默认名片（cards.isDefault），云端持久化
3. **快捷导航** — 名片夹、访客统计入口
4. **清空缓存** — `wx.clearStorageSync()`
5. **关于** — 版本信息弹窗（v1.0.9）

**主题配色方案**：

| 主题名称 | 颜色值 |
|---------|--------|
| 品牌蓝 | #3B82F6 |
| 活力橙 | #FF6A00 |
| 清新绿 | #00B42A |
| 玫瑰红 | #F53F3F |
| 香槟金 | #D9A94C |
| 神秘紫 | #722ED1 |

**默认名片设置流程**：

```
selectDefaultCard(e)
  ├── 清除旧默认名片（cards.isDefault = false）
  ├── 设置新默认名片（cards.isDefault = true）
  └── 同步本地缓存（defaultCardId, defaultCardName）
```

**设置加载策略**：云端优先，本地 Storage 降级

```
_loadSettings()
  ├── 并行：visitor_profiles（主题色）+ cards（isDefault）
  └── 降级：从本地 Storage 读取
```

---

## 8. 核心功能流程

### 8.1 名片创建流程

```
首页 → 点击"创建名片" → wx.navigateTo('/pages/edit/index')
  → 填写名片信息（头像、姓名、职位、公司等）
  → 点击保存 → validate() → saveCard()
     ├── collection('cards').add()
     ├── _syncVisitorProfile()（升级为 L3 卡片用户）
     ├── 设置 cardsNeedRefresh 缓存标志
     └── 1.5 秒后 navigateBack()
```

### 8.2 名片分享流程

```
首页 → 点击分享按钮 → onShareButtonTap(e)
  → _preGenerateShareCardWithKey(card, cardId)
     ├── shareCard.generate('#shareCanvas', card, options)
     │     └── Canvas 2D 绘制名片卡片图
     ├── 成功 → 缓存到 _shareImageCache[cardId]
     └── Canvas 未就绪 → 退避重试（最多 3 次）

用户触发分享 → onShareAppMessage()
  ├── 快速路径：缓存命中 → 直接返回
  └── 慢速路径：Promise 轮询等待（150ms 间隔，最多 8 秒）
       └── 超时降级：使用头像 URL 或空
```

### 8.3 访客追踪流程

```
用户 B 打开用户 A 的名片（preview 页）
  → loadCard() → 数据就绪后 → recordVisit()
     ├── getOpenId() 获取 visitorOpenId
     ├── 自有名片跳过
     └── initVisits(action: 'recordVisit')
          ├── L3 检查：visitor 有自己的名片 → 真名+头像
          ├── L2 检查：visitor_profiles 有授权 → 昵称+头像
          ├── L1：匿名 → visitorLevel = 1
          ├── 30 分钟内去重：visitCount++
          └── 新记录：创建

用户 A 查看访客 → 首页 / visitors 页
  → initVisits(getMyVisitorDashboard / getRecentVisitors)
  → 客户端聚合去重 → 格式化展示
```

### 8.4 名片夹流程

```
预览他人名片 → 保存名片 → saveCard()
  → user_save_cards.add({ cardId, cardOwnerOpenId, savedAt })

名片夹页面 → loadCards()
  → 查询 user_save_cards → 提取 cardId 列表
  → 批量查询 cards → 解析 cloud:// 头像 → 展示
```

---

## 9. API 接口说明（app.js 全局方法）

### 9.1 globalData

| 字段 | 类型 | 含义 |
|------|------|------|
| userInfo | object\|null | 微信用户信息 |
| systemInfo | object\|null | 系统/设备/窗口信息（合并 windowInfo + deviceInfo + appBaseInfo） |
| _openId | string | 用户 OpenID（getOpenId 内部缓存） |

### 9.2 生命周期方法

| 方法名 | 功能 | 说明 |
|--------|------|------|
| `onLaunch()` | 应用启动 | 调用 `getSystemInfo()` + `initCloud()` |
| `getSystemInfo()` | 获取系统信息 | 合并 getWindowInfo + getDeviceInfo + getAppBaseInfo，存入 globalData.systemInfo |
| `initCloud()` | 初始化云开发 | `wx.cloud.init({ traceUser: true, env: DYNAMIC_CURRENT_ENV })` |

### 9.3 工具方法

| 方法名 | 签名 | 功能 |
|--------|------|------|
| `showLoading` | `showLoading(title = '加载中...')` | 显示加载提示（带遮罩） |
| `hideLoading` | `hideLoading()` | 隐藏加载提示 |
| `showError` | `showError(title = '操作失败', duration = 2000)` | 显示错误 Toast（icon: none） |
| `showSuccess` | `showSuccess(title = '操作成功', duration = 1500)` | 显示成功 Toast（icon: success） |
| `getCache` | `getCache(key)` → value\|null | 读取带过期时间的缓存 |
| `setCache` | `setCache(key, value, expire = 300000)` | 写入带过期时间的缓存（默认 5 分钟） |
| `formatTime` | `formatTime(date)` → `'YYYY-MM-DD'` | 格式化日期 |
| `getOpenId` | `getOpenId()` → `Promise<string>` | 获取用户 OpenID（带 globalData._openId 缓存） |
| `showPrivacyError` | `showPrivacyError(err)` → boolean | 识别隐私授权拒绝（errCode 103/104），统一提示 |
| `resolveCloudFileIDs` | `resolveCloudFileIDs(fileIDs)` → `Promise<Object>` | 批量将 cloud:// ID 转为 HTTPS URL（调用 resolveCloudUrls 云函数，失败降级 getTempFileURL） |

---

## 10. 样式系统

### 10.1 全局样式（app.wxss）

| 选择器 | 规则 | 说明 |
|--------|------|------|
| `page` | font-family: 系统字体栈; font-size: 28rpx; color: #1F2937; background: #F9FAFB; line-height: 1.6 | 全局排版基准 |
| `view, text` | box-sizing: border-box | 统一盒模型 |
| `image` | display: block | 消除图片底部间隙 |
| `button` | margin/padding/border/background/line-height 重置 | 清除微信默认按钮样式 |
| `button::after` | border: none | 清除默认边框 |
| `button:focus` | outline: none | 清除焦点轮廓 |
| `.container` | min-height: 100vh; padding: 24rpx | 页面容器 |
| `.avatar` | border-radius: 50%; background: #F9FAFB | 头像圆形裁切 |

### 10.2 全局配置（app.json 窗口样式）

| 配置项 | 值 | 说明 |
|--------|------|------|
| navigationBarBackgroundColor | #3B82F6 | 导航栏品牌蓝 |
| navigationBarTitleText | 科博名片 | 导航栏标题 |
| navigationBarTextStyle | white | 导航栏文字白色 |
| backgroundColor | #F5F7FA | 页面背景色 |
| backgroundTextStyle | light | 下拉刷新样式 |

### 10.3 页面级样式

各页面在自身 `index.wxss` 中定义局部样式，遵循 BEM-like 命名规范，不依赖全局原子类。

---

## 11. 隐私与安全

### 11.1 隐私授权机制

- **官方弹窗模式**：`app.json` 声明 `"__usePrivacyCheck__": true`，微信自动在用户首次调用隐私 API 时弹出官方隐私协议弹窗
- **无需手动检查**：不再使用 `wx.getPrivacySetting` 或 `wx.onNeedPrivacyAuthorization` 手动管理隐私流程
- **隐私错误统一处理**：`app.showPrivacyError(err)` 识别 errCode 103/104，统一提示"需要同意隐私协议后才能使用此功能"
- **协议页面**：`/pages/agreement/index` 作为 `wx.openPrivacyContract` 的降级方案

### 11.2 数据安全

1. **HTTPS 传输**：所有网络请求通过微信云开发 API 加密传输
2. **用户隔离**：名片数据按 `_openid` 隔离，首页/名片夹均按当前用户过滤
3. **自访过滤**：visits 记录中不记录自己访问自己的名片
4. **所有权校验**：删除名片时在云函数端校验 `_openid === 调用者 openid`
5. **云存储 ACL**：`resolveCloudUrls` 云函数以管理员身份代理文件访问，绕开"仅创建者可读写"限制
6. **敏感信息可选**：手机号码、邮箱为选填项，用户自主决定

### 11.3 权限处理

- **相册权限**：编辑页头像/附件选择时，拒绝权限引导去系统设置开启
- **通讯录权限**：保存通讯录时，拒绝权限给出明确提示
- **剪贴板**：复制电话/邮箱/地址/链接时，隐私拒绝统一处理
- **无额外权限声明**：app.json 未声明 `scope.camera` 或 `scope.writePhotosAlbum`

---

## 12. 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|---------|
| v1.0.0 | 2024-06 | 初始版本：基础名片功能 |
| v1.0.1 | 2024-06 | 添加过往经历、附件、个人介绍、业务介绍模块 |
| v1.0.2 | 2024-06 | 添加公众号链接、公司主页模块，公开/隐藏开关 |
| v1.0.3 | 2024-06 | 添加名片夹页、访客页；访客统计三级降级策略；recordVisit 记录机制 |
| v1.0.4 | 2024-06 | 移除裁切页（crop），头像直接上传；重构头像上传流程 |
| v1.0.5 | 2025-01 | 添加 resolveCloudUrls 云函数，修复跨设备头像不可见问题 |
| v1.0.6 | 2025-03 | 添加 deleteCard 云函数级联删除；三级访客身份识别（L1/L2/L3） |
| v1.0.7 | 2025-06 | 分享卡片 Canvas 生成重构，支持 Promise 异步等待和后台预生成 |
| v1.0.8 | 2025-12 | 匿名访客授权引导条；visitor_profiles 静默注册；官方隐私弹窗模式 |
| v1.0.9 | 2026-06 | 添加 getQrCode 云函数；主题色/默认名片云端持久化；文档对齐实际代码 |

---

**文档版本**: v3.0
**最后更新**: 2026年6月17日
**更新说明**: 基于全部源文件重新扫描，修正页面路由、云函数列表、数据模型、app.js 方法签名、app.wxss 样式描述等，删除不存在的页面/组件/集合/权限引用
