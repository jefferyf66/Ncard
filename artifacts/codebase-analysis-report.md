# 科博名片（Ncard）代码库全面分析报告

> 分析日期：2026-06-17 | 项目版本：v1.0.9 | AppID：`wxd15d78bd1a5b75ef`

---

## 1. 代码库结构

### 1.1 目录层级总览

```
Ncard/                              ← 项目根目录
├── miniprogram/                    ← 小程序前端源码（miniprogramRoot）
│   ├── app.js                      ← App 全局实例（云开发初始化 + 全局工具方法）
│   ├── app.json                    ← 全局配置（7 页面路由 + 云开发 + 隐私弹窗）
│   ├── app.wxss                    ← 全统一样式（字体/盒模型/头像/容器）
│   ├── sitemap.json                ← 微信搜索索引配置
│   ├── config/
│   │   └── cardStyle.js            ← 名片样式单一数据源（CARD 冻结常量 + 工具函数）
│   ├── utils/
│   │   ├── shareCard.js            ← Canvas 分享卡片生成器 v8（5:4 导出）
│   │   └── share.js                ← 分享标题构建工具
│   ├── images/
│   │   ├── avatar.png              ← 默认头像占位图
│   │   └── (icons/、tab/ 图标目录)
│   └── pages/
│       ├── index/                  ← 首页（名片列表 + 访客统计 + 分享预生成）
│       ├── edit/                   ← 编辑页（创建/编辑名片 + 头像上传）
│       ├── preview/                ← 预览页（名片详情 + 智能操作 + L2 授权）
│       ├── visitors/               ← 访客页（三级身份展示 + 统计）
│       ├── list/                   ← 名片夹（收藏的他人名片）
│       ├── profile/                ← 个人中心（主题/设置/关于）
│       └── agreement/              ← 协议页（隐私政策 + 服务条款）
├── cloudfunctions/                 ← 云函数目录（cloudfunctionRoot）
│   ├── getOpenId/                  ← 获取用户 OpenID/AppID/UnionID
│   ├── getQrCode/                  ← 生成小程序码（已定义但文件缺失）
│   ├── initVisits/                 ← 访客管理（5 个 action：ensureCollection/recordVisit/getMyVisitorStats/getRecentVisitors/getMyVisitorDashboard）
│   ├── deleteCard/                 ← 级联删除名片（cards + user_save_cards + visits + 云存储文件）
│   └── resolveCloudUrls/           ← cloud://→HTTPS 安全代理（getTempFileURL + downloadFile 降级）
├── project.config.json             ← 项目配置（AppID/基础库/编译设置）
├── project.private.config.json     ← 个人配置（不纳入版本控制）
├── README.md                       ← 项目说明
├── CHANGELOG.md                    ← 更新日志
├── RELEASE_NOTES.md                ← 版本发布说明
├── DOCUMENTATION.md                ← 详细设计文档
├── DEPLOYMENT-GUIDE.md             ← 部署上线指南
└── artifacts/                      ← 工作产出物
    └── data-audit-report.md        ← 数据审计报告
```

### 1.2 核心文件职责

| 文件 | 行数（约） | 职责 |
|------|-----------|------|
| `app.js` | 190 | 全局 App 实例：云开发初始化、openId 缓存、cloud:// 代理、缓存工具、隐私错误处理 |
| `app.json` | 22 | 页面路由（7页）、窗口样式、云开发开关、隐私弹窗开关 |
| `config/cardStyle.js` | ~150 | 名片视觉常量单一数据源（rpx→Canvas 转换、气泡适配、高度计算） |
| `utils/shareCard.js` | ~700 | Canvas 2D 分享图生成：Banner+名片+5:4 导出、序列化锁、缓存、头像降级 |
| `utils/share.js` | 37 | 分享标题截断工具（Unicode 码点计数，20 字上限） |
| `pages/index/index.js` | ~400 | 首页核心：名片分页加载、访客 dashboard、分享预生成、Canvas 尺寸动态计算 |
| `pages/edit/index.js` | ~500 | 名片 CRUD：表单验证、头像上传/裁切、经历拖拽排序、visitor_profile 同步 |
| `pages/preview/index.js` | ~400 | 名片预览：访问记录、cloud:// 头像解析、所有者判断、保存/删除、L2 授权引导 |
| `cloudfunctions/initVisits/index.js` | 229 | 访客管理核心：30 分钟去重、三级身份 enrichment（L3→L2→L1） |

---

## 2. 技术栈识别

### 2.1 语言与框架

| 类别 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 前端框架 | 微信小程序原生 | style: v2 | 无跨端框架（Taro/uni-app），纯原生 WXML/WXSS/JS |
| 前端语法 | JavaScript (ES5+) | — | 开发者工具 babel 转译，代码混用 ES5(var) 和 ES6(const/arrow) |
| 模板语言 | WXML | — | 微信自定义模板语法，支持 wx:if/wx:for/数据绑定 |
| 样式语言 | WXSS | — | CSS 子集 + rpx 响应式单位，不支持 CSS 变量（仅 --status-bar-height） |
| 后端运行时 | 微信云开发 | 2.0+ | 云数据库 + 云函数 + 云存储，Serverless 架构 |
| 云函数 | Node.js + wx-server-sdk | ~2.6.3 | 仅 getOpenId 声明了依赖，其余云函数隐式依赖 |

### 2.2 依赖库

| 依赖 | 版本 | 用途 | 位置 |
|------|------|------|------|
| wx-server-sdk | ~2.6.3 | 云函数 SDK | `cloudfunctions/getOpenId/package.json` |
| Canvas 2D API | 基础库 3.16.0 | 分享卡片绘制 | `utils/shareCard.js` |
| wx.cloud | 内置 | 云开发客户端 SDK | 全局 |

### 2.3 无第三方 UI 库

项目未引入 TDesign、Vant Weapp 等 UI 组件库，所有组件均为原生 WXML 手写实现。

---

## 3. 开发环境配置

### 3.1 项目配置（project.config.json）

| 配置项 | 值 | 说明 |
|--------|-----|------|
| appid | `wxd15d78bd1a5b75ef` | 小程序 AppID |
| projectname | `ncard` | 项目名称 |
| libVersion | `3.16.0` | 基础库版本 |
| miniprogramRoot | `miniprogram/` | 前端源码目录 |
| cloudfunctionRoot | `cloudfunctions/` | 云函数目录 |
| es6 | true | ES6 转 ES5 开启 |
| enhance | true | 增强编译开启 |
| postcss | true | PostCSS 自动补全 |
| minified | true | 代码压缩 |
| swc / disableSWC | false / true | SWC 编译器禁用 |
| lazyCodeLoading | 未配置 | 按需注入未启用 |

### 3.2 全局配置（app.json）

| 配置项 | 值 |
|--------|-----|
| 页面数 | 7（index/edit/preview/visitors/agreement/list/profile） |
| 导航栏色 | #3B82F6（品牌蓝） |
| 导航栏文字 | 白色 / "科博名片" |
| cloud | true（启用云开发） |
| __usePrivacyCheck__ | true（官方隐私弹窗） |
| tabBar | 无（全部 navigateTo 导航） |

### 3.3 本地运行方式

```bash
# 1. 使用微信开发者工具打开项目根目录
# 2. 工具自动识别 miniprogramRoot 和 cloudfunctionRoot
# 3. 云开发需在工具中开通并选择环境
# 4. 云函数需右键「上传并部署：云端安装依赖」
# 5. 云数据库需在控制台手动创建 4 个集合
```

### 3.4 环境切换

- 云开发环境：`wx.cloud.DYNAMIC_CURRENT_ENV`（跟随开发者工具选中的环境）
- 无 dev/staging/prod 环境变量区分机制
- 发布后建议改为固定环境 ID

---

## 4. 代码架构概览

### 4.1 整体架构模式

```
┌──────────────────────────────────────────────────────────────────┐
│                     微信小程序客户端（双线程）                     │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │    渲染层（WebView）   │  │        逻辑层（JSCore）          │ │
│  │  WXML 模板渲染        │  │  app.js 全局实例                 │ │
│  │  WXSS 样式计算        │  │  页面 JS (Page/Component)        │ │
│  │  数据绑定 {{}}        │←→│  setData 桥接通信                │ │
│  └──────────────────────┘  └──────────┬───────────────────────┘ │
└─────────────────────────────────────────│────────────────────────┘
                                          │ wx.cloud API
                                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                       微信云开发（Serverless）                    │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────────────┐│
│  │  云数据库     │  │   云函数          │  │   云存储             ││
│  │  cards       │  │   getOpenId       │  │   avatars/          ││
│  │  visits      │  │   initVisits      │  │   attachments/      ││
│  │  user_save_  │  │   deleteCard      │  │   qrcodes/          ││
│  │  cards       │  │   resolveCloudUrls│  │                     ││
│  │  visitor_    │  │   getQrCode       │  │  权限：仅创建者读写   ││
│  │  profiles    │  │                   │  │                     ││
│  └─────────────┘  └──────────────────┘  └─────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

**架构特征**：
- **无后端服务器**：完全依赖微信云开发 Serverless 架构
- **双线程模型**：小程序逻辑层与渲染层分离，setData 是唯一通信桥梁
- **客户端聚合**：访客去重、数据格式化在客户端完成，云函数仅提供原始数据
- **三级降级设计**：云函数 → 客户端直接查库 → 静默失败，贯穿多个模块

### 4.2 数据流向

```
首页加载流程：
onLoad → loadCards() → getOpenId() → cards.where({_openid}) → 渲染名片列表
                                          ↓
                                      _preGenerateVisibleCards() → Canvas 分享图
                                          ↓
                                      _loadVisitorStats() → initVisits(getMyVisitorDashboard)
                                          ↓ 成功                          ↓ 失败
                                      三路 Promise.all              _loadVisitorStatsDirect()
                                      (总数/回访/最近)               直接查 visits 集合

分享流程：
onShareAppMessage() → shareCard.generate() → Canvas 2D 绘制
  → canvasToTempFilePath(600×480, 5:4) → 返回 {imageUrl}

访客访问流程：
preview/onLoad → getOpenId() → initVisits(recordVisit)
  → L3 检查(cards.where) → L2 检查(visitor_profiles) → L1 匿名
  → 写入 visits 集合（含 enrichment 字段）
```

### 4.3 模块间依赖关系

```
pages/index  ─────→  app.js (getOpenId, resolveCloudFileIDs, formatTime)
              ─────→  config/cardStyle.js (CARD, rpxToCanvas, fitToBubbleSize)
              ─────→  utils/shareCard.js (generate, getCurrentDimensions)
              ─────→  utils/share.js (buildShareTitle)

pages/edit   ─────→  app.js (getOpenId, showPrivacyError)
              ─────→  cloudfunctions/getOpenId (间接)
              ─────→  cloud db: cards, visitor_profiles

pages/preview ────→  app.js (getOpenId, resolveCloudFileIDs, showPrivacyError)
              ─────→  cloudfunctions/initVisits (recordVisit)
              ─────→  cloudfunctions/deleteCard (级联删除)
              ─────→  cloud db: cards, visits, user_save_cards, visitor_profiles

pages/visitors ────→  app.js (getOpenId, formatTime)
              ─────→  cloudfunctions/initVisits (getMyVisitorStats, getRecentVisitors)
              ─────→  cloud db: visits, user_save_cards

pages/list   ─────→  app.js (getOpenId, resolveCloudFileIDs)
              ─────→  cloud db: user_save_cards, cards

pages/profile ────→  app.js (globalData)
              ─────→  cloud db: cards

app.js       ─────→  cloudfunctions/getOpenId
              ─────→  cloudfunctions/resolveCloudUrls
              ─────→  wx.cloud.getTempFileURL (降级)

shareCard.js ─────→  config/cardStyle.js (CARD, rpxToCanvas, fitToBubbleSize)
              ─────→  app.js (resolveCloudFileIDs, getOpenId)
              ─────→  cloudfunctions/resolveCloudUrls (间接)
```

---

## 5. 现有功能梳理

### 5.1 核心功能模块

| 模块 | 页面 | 核心能力 | 数据源 |
|------|------|---------|--------|
| **名片管理** | index + edit + preview | 创建/编辑/删除名片，14+ 字段（基础+扩展） | cards 集合 |
| **名片收藏** | list + preview | 保存他人名片到名片夹，取消保存 | user_save_cards 集合 |
| **访客追踪** | visitors + preview | 访问记录、三级身份识别、统计仪表盘 | visits + visitor_profiles 集合 |
| **分享卡片** | index + preview | Canvas 2D 生成 5:4 分享图，异步预生成 | Canvas + 云存储 |
| **隐私合规** | agreement + 全局 | 官方隐私弹窗 + 协议展示 + errCode 处理 | app.json 配置 |
| **个人中心** | profile | 主题切换（6色）、默认名片、清缓存 | Storage 本地 |
| **云存储代理** | 全局（app.js） | cloud:// → HTTPS URL 安全转换 | resolveCloudUrls 云函数 |

### 5.2 名片数据字段

**基础字段**：name（必填）、company（必填）、position、phone、email、address、avatar

**扩展字段**：personalIntro（500字）、businessIntro（1000字）、experiences（数组，拖拽排序）、attachments（数组，云文件）、wechatOfficial（名称/简介/链接）、companyWebsite（名称/地址/描述）

**控制字段**：publicSettings（6 个布尔开关，控制各扩展模块公开/隐藏）

### 5.3 访客身份三级体系

| 级别 | 识别条件 | 展示信息 | 数据来源 |
|------|---------|---------|---------|
| L3 | 访客有自己的名片（cards._openid 匹配） | 真名+头像+职位+公司+电话 | cards 集合 |
| L2 | 访客授权了微信昵称（visitor_profiles 存在） | 微信昵称+头像 | visitor_profiles 集合 |
| L1 | 既无名片也未授权 | "访客 #XXXX"+默认图标 | openid 后4位 |

### 5.4 关键业务逻辑

- **30 分钟去重**：同一访客 30 分钟内访问同一名片，更新时间+计数递增，不新建记录
- **自己访问跳过**：visitorOpenId === cardOwnerId 时不记录访问
- **身份升级**：创建名片后自动将 visitor_profiles 升级为 L3（_syncVisitorProfile）
- **编辑后刷新联动**：edit 保存后设置 cardsNeedRefresh 标志，index/preview onShow 时检测并重载
- **分享图缓存**：按 `cardKey_宽x高_联系方式数c_v{版本}` 缓存，数据变化自动失效
- **Canvas 序列化锁**：`_canvasLock` Promise 链，防止多名片并发生成导致头像降级

---

## 6. 代码质量评估

### 6.1 代码规范

| 维度 | 评价 | 说明 |
|------|------|------|
| 命名规范 | ⭐⭐⭐⭐ | 页面方法命名清晰（loadCards, goToPreview），私有方法 `_` 前缀一致 |
| 代码风格 | ⭐⭐⭐ | ES5(var) 和 ES6(const/arrow) 混用，同一文件内不一致（visitors 页全 ES5，index 页混用） |
| 注释质量 | ⭐⭐⭐⭐ | 关键逻辑有中文注释，云函数有完整 JSDoc，shareCard.js 有架构说明头 |
| 错误处理 | ⭐⭐⭐⭐ | 三级降级贯穿全项目，.catch() 链完整，隐私错误有统一处理 |
| 函数拆分 | ⭐⭐⭐ | 部分页面方法较长（index.js _doLoadCards ~100 行），可进一步拆分 |

### 6.2 测试覆盖

| 类型 | 状态 | 说明 |
|------|------|------|
| 单元测试 | ❌ 无 | 无任何测试框架或测试文件 |
| 集成测试 | ❌ 无 | 云函数无自动化测试 |
| E2E 测试 | ❌ 无 | 无 miniprogram-automator 或类似工具 |
| 手动测试 | ✅ 部分 | 通过微信开发者工具真机预览 |

### 6.3 技术债务与待优化点

#### 🔴 高优先级

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | **getQrCode 云函数文件缺失** | `cloudfunctions/getQrCode/` | app.json 注册了但无 index.js，调用会失败 |
| 2 | **DOCUMENTATION.md 严重过时** | 根目录 | 仍记录 crop 页面、scans 集合、TabBar、旧版隐私弹窗等已移除内容 |
| 3 | **DEPLOYMENT-GUIDE.md 过时** | 根目录 | 引用 scans/users 集合、scope.camera 权限、OCR 扫描等已删除功能 |
| 4 | **initVisits 云函数未声明 wx-server-sdk 依赖** | `cloudfunctions/initVisits/package.json` | 无 dependencies 字段，部署可能失败 |
| 5 | **index.wxml 存在重复内容** | 第 21-34 行与第 31-34 行重复 | empty-state 块渲染两次 |

#### 🟡 中优先级

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| 6 | ES5/ES6 语法混用 | visitors.js 全 var，index.js 混用 | 统一为 ES6+（有 babel 转译保底） |
| 7 | profile 页功能未完成 | `loadCardList()` 无 _openid 过滤 | 所有人名片都可见，应限制为自己创建的 |
| 8 | profile 主题切换仅存 Storage | 无后端持久化 | 换设备/清缓存后主题重置 |
| 9 | profile 默认名片设置无实际作用 | `selectDefaultCard` 仅 showToast | 未关联到首页默认展示逻辑 |
| 10 | visitors 页 handleAction 仅 showToast | "交换名片"/"请问是谁" | 无实际后端交互，纯占位 |
| 11 | 无 sitemap.json 内容审核 | — | 微信搜索收录策略未配置 |
| 12 | 无自定义组件抽取 | 全部页面内联 | 名片卡片在 index/preview/list 三处重复 |

#### 🟢 低优先级

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| 13 | app.wxss 极简（仅 43 行） | — | DOCUMENTATION.md 记录了大量工具类但实际不存在 |
| 14 | 无全局 loading/empty/error 组件 | — | 每个页面重复实现三态 UI |
| 15 | 无请求频率控制 | — | 云函数调用无防抖/节流 |
| 16 | resolveCloudUrls base64 降级开销大 | 云函数 | 大头像转 base64 后 data URL 可达数百 KB |
| 17 | 无微信消息推送集成 | — | 订阅消息未使用 |

---

## 7. 后续开发建议

### 7.1 上线前必须完成

1. **部署全部 5 个云函数**（getOpenId / initVisits / deleteCard / resolveCloudUrls / getQrCode）
   - 注意：getQrCode 缺失 index.js，需补充或从 app.json 移除引用
   - initVisits/deleteCard/resolveCloudUrls 需在 package.json 中声明 wx-server-sdk 依赖

2. **云控制台创建 4 个集合**：cards、visits、user_save_cards、visitor_profiles

3. **MP 后台配置隐私保护指引**：勾选「收集你选中的照片或视频文件」+「获取你的相机权限」

4. **云存储权限收紧**：改为「仅创建者可读写」

5. **删除云存储孤儿目录**：avatar/、avartar/、scans/、cards/

6. **清理过时文档**：DOCUMENTATION.md 和 DEPLOYMENT-GUIDE.md 需全面更新

7. **修复 index.wxml 重复内容**：第 21-34 行 empty-state 块出现两次

### 7.2 架构优化方向

1. **抽取名片卡片组件**：`<card-item>` 组件供 index/preview/list 三页复用，减少样式和逻辑重复

2. **抽取三态组件**：`<loading-state>` / `<empty-state>` / `<error-state>` 全局复用

3. **统一异步风格**：全量迁移至 async/await + Promise（当前 callback/Promise/async 混用）

4. **添加全局请求层**：封装 wx.cloud.callFunction 为统一 Promise 接口，含超时/重试/错误码映射

5. **引入状态管理**：Mobx-miniprogram 或自定义 store 替代 globalData + Storage 的分散状态

6. **云函数依赖补全**：所有云函数 package.json 声明 wx-server-sdk 依赖

### 7.3 功能扩展建议

1. **名片交换**：当前 visitors 页 "交换名片" 按钮为空壳，可实现双向名片交换流程

2. **订阅消息**：新访客访问时通知名片主人（需 MP 后台申请模板）

3. **名片搜索**：名片夹支持按姓名/公司搜索

4. **多语言/深色模式**：当前仅支持浅色主题

5. **数据导出**：支持名片数据导出为 vCard 格式

6. **二维码名片**：getQrCode 云函数已定义，可实现扫码直达名片

### 7.4 关键注意事项

- **setData 性能**：每次 setData 跨 JS-Native 桥，应合并多次调用、缩减 payload
- **Canvas 2D 兼容性**：type="2d" 要求基础库 ≥ 2.9.0，当前 libVersion 3.16.0 满足
- **隐私 API 变更**：微信对隐私接口政策持续收紧，需关注 errCode 新增情况
- **云开发配额**：免费版有日调用次数限制，增长后需评估升级
- **包体积**：当前无 tabBar（节省空间），但需持续监控主包 < 2MB
- **云函数冷启动**：首次调用延迟约 1-3 秒，关键路径应有加载态
- **cloud:// URL 代理**：resolveCloudUrls 的 base64 降级路径对大文件不友好，建议限制头像文件大小

---

## 附录 A：云数据库集合汇总

| 集合名 | 文档结构 | 权限建议 | 索引建议 |
|--------|---------|---------|---------|
| cards | {name, company, position, phone, email, address, avatar, personalIntro, businessIntro, experiences[], attachments[], wechatOfficial{}, companyWebsite{}, publicSettings{}, createTime, updateTime} | 仅创建者可读写 | _openid, createTime |
| visits | {cardId, cardOwnerId, visitorOpenId, visitorName, visitorAvatar, visitorPosition, visitorCompany, visitorPhone, visitorLevel, visitTime, visitCount, actions[], source} | 仅管理员可写，所有用户可读 | cardId, cardOwnerId, visitorOpenId, visitTime |
| user_save_cards | {cardId, cardOwnerOpenId, savedAt} | 仅创建者可读写 | cardId, _openid |
| visitor_profiles | {_openid/openid, nickname, avatarUrl, createdAt} | 仅创建者可读写 | openid(唯一) |

## 附录 B：云函数 API 参考

### getOpenId
- **入参**：无（从 cloud.getWXContext() 获取）
- **返回**：`{ success: true, data: { openid, appid, unionid } }`

### initVisits
| Action | 入参 | 返回 |
|--------|------|------|
| ensureCollection | — | `{ ok, message }` |
| recordVisit | `{ cardId, visitorOpenId, cardOwnerId, source }` | `{ ok, created/updated, visitorLevel }` |
| getMyVisitorStats | `{ cardOwnerId }` | `{ ok, visitors, viewed }` |
| getRecentVisitors | `{ cardOwnerId, limit }` | `{ ok, list[] }` |
| getMyVisitorDashboard | `{ cardOwnerId }` | `{ ok, visitors, viewed, recentVisitors[] }` |

### deleteCard
- **入参**：`{ cardId }`
- **逻辑**：校验所有权 → 收集云文件 ID → Promise.all 并行删除（cards + user_save_cards + visits + cloud files）
- **返回**：`{ ok, allSettled, results[], failedCount, message }`

### resolveCloudUrls
- **入参**：`{ fileIDs: string[] }`
- **逻辑**：缓存命中 → getTempFileURL 批量 → downloadFile→base64 降级 → 构建映射
- **缓存**：115 分钟内存缓存，5 分钟重试间隔（彻底失败时）
- **返回**：`{ urls: { [fileID]: tempFileURL } }`

## 附录 C：文件统计

| 类别 | 文件数 | 说明 |
|------|--------|------|
| 页面 JS | 7 | 每页一个 |
| 页面 WXML | 7 | 每页一个 |
| 页面 WXSS | 7 | 每页一个 |
| 页面 JSON | 7 | 每页一个 |
| 云函数 JS | 4 | getOpenId/initVisits/deleteCard/resolveCloudUrls |
| 工具模块 | 2 | shareCard.js/share.js |
| 配置模块 | 1 | cardStyle.js |
| 全局文件 | 3 | app.js/app.json/app.wxss |
| 项目配置 | 2 | project.config.json/project.private.config.json |
| 文档文件 | 5 | README/CHANGELOG/RELEASE_NOTES/DOCUMENTATION/DEPLOYMENT-GUIDE |
| **总计** | ~45 | — |
