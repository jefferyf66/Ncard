# 科博名片小程序 - 详细设计文档

---

## 1. 项目概述

**项目名称**：科博名片（Kebo Business Card）

**项目简介**：一款专业的电子名片管理微信小程序，支持名片创建、编辑、预览、分享、访客追踪等功能，采用微信云开发技术栈实现。

**技术栈**：

| 分类 | 技术 | 版本 |
|------|------|------|
| 框架 | 微信小程序 | 原生（style: v2） |
| 后端 | 微信云开发 | 2.0+ |
| 数据库 | Cloud Firestore | NoSQL |
| 云函数 | Node.js | 16.x |
| 语法标准 | ES5（开发者工具 babel 兼容性） | - |

**设计风格**：素雅简洁、扁平化设计、单色线条图标

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    微信小程序客户端                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │   页面层     │ │   组件层     │ │   工具层     │          │
│  │ (Pages)     │ │ (Components)│ │ (app.js)    │          │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘          │
└─────────│────────────────│────────────────│─────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                    微信云开发平台                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │  云数据库    │ │  云函数      │ │  云存储      │          │
│  │ (Database)  │ │ (Functions) │ │ (Storage)   │          │
│  │ cards,      │ │ getOpenId   │ │ avatars/    │          │
│  │ visits      │ │ getQrCode   │ │ attachments/│          │
│  │ user_save_  │ │ initVisits  │ │ qrcodes/    │          │
│  │ cards       │ │ deleteCard  │ │  (0700)     │          │
│  │ visitor_    │ │ resolve     │ │             │          │
│  │ profiles    │ │ CloudUrls   │ │             │          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 页面路由表

| 页面路径 | 页面名称 | 功能描述 | 是否首页 |
|---------|---------|---------|---------|
| `pages/index/index` | 首页 | 名片列表、访客统计、快速入口 | ✅ |
| `pages/edit/index` | 编辑页 | 创建/编辑名片信息 | - |
| `pages/preview/index` | 预览页 | 名片详情展示、分享、操作 | - |
| `pages/list/index` | 名片列表 | 完整名片列表、下拉刷新 | - |
| `pages/profile/index` | 个人中心 | 用户信息、主题选择、设置 | - |
| `pages/visitors/index` | 访客页 | 访客统计与记录管理 | - |
| `pages/agreement/index` | 协议页 | 隐私政策、用户服务协议 | - |
| `pages/crop/index` | 裁切页 | 头像图片正方形裁切 | - |

> **注意**：没有 tabBar 配置，所有页面通过 `wx.navigateTo` 导航，首页 `pages/index/index` 为入口页。

### 2.3 目录结构

```
Ncard/
├── cloudfunctions/           # 云函数目录
│   ├── getOpenId/            # 获取用户 OpenID
│   ├── getQrCode/            # 生成小程序码
│   └── initVisits/           # 访客记录管理（多 action）
├── miniprogram/              # 小程序源码
│   ├── components/           # 公共组件
│   │   └── cloudTipModal/    # 云开发提示弹窗
│   ├── images/               # 静态资源
│   │   ├── avatar.png        # 默认头像
│   │   ├── icons/            # 图标资源
│   │   └── tab/              # TabBar 图标
│   ├── pages/                # 页面目录
│   │   ├── index/            # 首页
│   │   ├── edit/             # 编辑页
│   │   ├── preview/          # 预览页
│   │   ├── list/             # 名片列表
│   │   ├── profile/          # 个人中心
│   │   ├── visitors/         # 访客页
│   │   ├── agreement/        # 协议页
│   │   └── crop/             # 图片裁切页
│   ├── app.js                # 应用入口 + 全局工具方法
│   ├── app.json              # 全局配置（窗口样式、权限声明）
│   └── app.wxss              # 全局样式（工具类、动画）
├── .gitignore                # Git 忽略配置
├── project.config.json       # 项目配置
└── DOCUMENTATION.md          # 本文档
```

---

## 3. 数据模型设计

### 3.1 名片数据结构（cards 集合）

| 字段名 | 类型 | 含义 | 必填 | 默认值 |
|--------|------|------|------|--------|
| _id | string | 文档ID（自动生成） | 自动 | - |
| name | string | 姓名 | 是 | - |
| position | string | 职位 | 否 | '' |
| company | string | 公司名称 | 是 | - |
| phone | string | 手机号码 | 否 | '' |
| email | string | 邮箱地址 | 否 | '' |
| address | string | 地址 | 否 | '' |
| avatar | string | 头像云存储 fileID | 否 | '' |
| personalIntro | string | 个人介绍（最长500字） | 否 | '' |
| businessIntro | string | 业务介绍（最长1000字） | 否 | '' |
| experiences | array | 过往经历列表 | 否 | [] |
| attachments | array | 名片附件列表 | 否 | [] |
| wechatOfficial | object | 公众号信息 | 否 | {} |
| companyWebsite | object | 公司主页 | 否 | {} |
| publicSettings | object | 各模块公开/隐藏开关 | 否 | 见下文 |
| createTime | Date | 创建时间 | 自动 | new Date() |
| updateTime | Date | 更新时间 | 自动 | new Date() |

**publicSettings 对象结构**：

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| showPersonalIntro | boolean | true | 是否公开个人介绍 |
| showBusinessIntro | boolean | true | 是否公开业务介绍 |
| showExperiences | boolean | true | 是否公开过往经历 |
| showWechatOfficial | boolean | true | 是否公开公众号信息 |
| showCompanyWebsite | boolean | true | 是否公开公司主页 |
| showAttachments | boolean | true | 是否公开名片附件 |

**experiences 数组元素结构**：

| 字段 | 类型 | 含义 |
|------|------|------|
| company | string | 公司名称 |
| position | string | 职位 |
| period | string | 工作时间（如：2020-2023） |
| desc | string | 工作描述 |

**wechatOfficial 对象结构**：

| 字段 | 类型 | 含义 |
|------|------|------|
| name | string | 公众号名称 |
| desc | string | 简介 |
| url | string | 公众号链接 |

**companyWebsite 对象结构**：

| 字段 | 类型 | 含义 |
|------|------|------|
| name | string | 网站名称 |
| url | string | 网站地址 |
| desc | string | 网站描述 |

**attachments 数组元素结构**：

| 字段 | 类型 | 含义 |
|------|------|------|
| name | string | 文件名 |
| url | string | 云存储 fileID |
| size | string | 文件大小 |
| time | string | 上传时间（格式化字符串） |

### 3.2 访客数据结构（visits 集合）

| 字段名 | 类型 | 含义 |
|--------|------|------|
| _id | string | 文档ID（自动生成） |
| cardId | string | 被访问名片ID |
| cardOwnerId | string | 名片所有者 OpenID |
| visitorOpenId | string | 访客 OpenID |
| visitorName | string | 访客姓名（如有） |
| visitorPhone | string | 访客电话（如有） |
| visitorPosition | string | 访客职位（如有） |
| visitorCompany | string | 访客公司（如有） |
| visitorAvatar | string | 访客头像（如有） |
| visitCount | number | 累计来访次数 |
| visitTime | Date | 最近访问时间 |
| source | string | 访问来源（direct/share/scan 等） |
| actions | array | 访问行为记录 |

---

## 4. 页面详细设计

### 4.1 首页（pages/index/index）

**功能模块**：

1. **隐私授权弹窗** - 首次进入或需要授权时展示，含隐私政策和服务协议链接
2. **名片列表** - 按创建时间倒序展示用户名片，支持分页加载（每页10条）
3. **访客统计** - 我的访客 / 多次来访 / 名片数 三栏统计卡片
4. **最近访客** - 展示最近5位访客，支持"交换名片"/"请问是谁"操作
5. **快捷入口** - 创建名片、查看全部名片、查看全部访客
6. **添加到桌面** - 引导用户将小程序添加到桌面

**数据加载策略**：
- `onLoad` → `checkPrivacySetting()` → 已授权则 `loadCards(true)`
- `onShow` → 检查缓存是否过期（5分钟内不过期），过期则刷新
- 访客数据采用**三级降级策略**加载
- 名片数据 10 秒超时降级到缓存

**访客数据三级降级策略**：

```
_loadVisitorStats()
  ├── ① 云函数 initVisits(getMyVisitorStats) → 成功则显示
  ├── ② 降级：直接查询 visits 集合（count + where）
  └── ③ 再次降级：静默失败，显示 0
```

**关键方法**：

| 方法名 | 功能 | 说明 |
|--------|------|------|
| `loadCards(isRefresh)` | 加载名片列表 | isRefresh=true 重置分页 |
| `loadVisitorData()` | 加载访客数据 | 并行加载名片总数 + 访客统计 |
| `_loadVisitorStats()` | 云函数方式加载访客 | 一级策略 |
| `_loadVisitorStatsDirect()` | 直接查库加载访客 | 二级策略 |
| `_loadRecentVisitors()` | 加载最近访客列表 | 取最近5条 |
| `tryLoadCache()` | 降级使用缓存 | 10秒超时或网络失败时触发 |

---

### 4.2 编辑页（pages/edit/index）

**功能模块**：

1. **头像上传** - 直接打开相册 → 跳裁切页 → 正方形裁切 → 上传云存储
2. **基本信息** - 姓名、职位、公司、电话、邮箱、地址
3. **个人介绍** - 多行文本输入（最长500字），可切换公开/隐藏
4. **业务介绍** - 多行文本输入（最长1000字），可切换公开/隐藏
5. **过往经历** - 可添加多条工作经历，支持拖拽排序（touchmove）
6. **公众号信息** - 名称、简介、链接，可切换公开/隐藏
7. **公司主页** - 名称、地址、描述，可切换公开/隐藏
8. **名片附件** - 图片附件上传，可切换公开/隐藏

**头像上传流程**：

```
点击头像 → wx.chooseImage({ sourceType: ['album'] })
  → 不弹 ActionSheet，直接进入系统相册
  → 选图后存到 app.globalData.cropImageSrc
  → wx.navigateTo('/pages/crop/index')
  → 裁切页 onConfirm 后回调 edit 页的 onCropResult()
  → 云存储上传（avatars/ 目录）
  → 更新 data.avatar
```

> **优化**：已移除拍照选项和底部弹出菜单，用户点击头像直接进入相册。

**表单验证规则**：

| 字段 | 验证规则 | 错误提示 |
|------|---------|---------|
| name | 非空 | 请输入姓名 |
| company | 非空 | 请输入公司名称 |
| phone | 11位手机号 /^1[3-9]\d{9}$/ | 请输入正确的手机号码 |
| email | 邮箱格式 /^[^\s@]+@[^\s@]+\.[^\s@]+$/ | 请输入正确的邮箱地址 |

**保存逻辑**：
- 新建（无 `id`）→ `collection('cards').add()`
- 编辑（有 `id`）→ `collection('cards').doc(id).update()`
- 保存前自动过滤空白的经历条目
- 成功提示后 1.5 秒自动返回

---

### 4.3 预览页（pages/preview/index）

**功能模块**：

1. **名片卡片展示** - 头像、姓名、职位、公司、联系方式
2. **过往经历列表** - 含公司、职位、时间段、描述
3. **个人介绍 / 业务介绍** - 根据 publicSettings 控制显示
4. **名片附件** - 支持下载和打开预览
5. **公众号链接** - 复制链接到剪贴板
6. **公司主页** - 复制链接到剪贴板
7. **操作按钮** - 编辑、保存通讯录、删除、分享
8. **访客记录** - onLoad 时调用 initVisits 云函数记录访问

**访客记录机制**：

```javascript
onLoad → recordVisit()
  ├── ① getOpenId 云函数获取 visiterOpenId
  ├── ② initVisits 云函数 recordVisit 记录
  │     ├── 30分钟内重复访问：更新 visitTime + visitCount++
  │     ├── 访问自己的名片：跳过不记录
  │     └── 新访问：创建新记录
  └── 云函数未部署时静默忽略
```

**分享功能**：
- 支持分享给朋友（`onShareAppMessage`）
- 支持分享到朋友圈（`onShareTimeline`）

**交互功能**：

| 操作 | 功能说明 |
|------|---------|
| 点击电话 | ActionSheet：拨打电话 / 复制号码 |
| 点击邮箱 | 复制邮箱地址 |
| 点击地址 | 复制地址到剪贴板 |
| 点击公众号 | 复制公众号链接 |
| 点击公司主页 | 复制网站链接 |
| 点击附件 | 下载 → ActionSheet → 打开文件预览 |
| 保存通讯录 | `wx.addPhoneContact` 保存到手机通讯录 |

---

### 4.4 裁切页（pages/crop/index）

**功能描述**：图片正方形裁切工具，用于头像上传裁剪。

**两阶段加载方案**（解决 movable-view 内 image bindload 不可靠问题）：

```
阶段1（isLoading = true）
  ├── 独立可见 <image> 渲染图片
  ├── bindload 可靠触发 → 获取图片原始宽高
  └── 计算初始缩放/位置，切换到阶段2

阶段2（isLoading = false）
  ├── movable-area + movable-view 交互
  ├── 正方形 box-shadow 镂空遮罩 + 九宫格辅助线
  ├── 双指缩放 + 单指移动
  └── 确定 → Canvas 裁剪 → 回调上一页
```

**关键技术点**：

1. **非受控 movable-view**：`bindscale` / `bindchange` 中只更新内部变量 `_realX / _realY / _realScale`，不调用 `setData` 更新 x/y/scale-value，避免反馈环路导致回弹
2. **bindscale vs bindchange**：`bindscale` 的 `detail` 含 `{x, y, scale}`，`bindchange` 的 `detail` 只有 `{x, y, source}` 无 scale
3. **路径传递**：通过 `app.globalData.cropImageSrc` 传递图片路径，绕过 URL 编码问题
4. **Canvas 输出**：使用 Canvas 2D API，输出正方形裁切图片，回调 `prevPage.onCropResult()`

**裁切参数**：
- 裁切区边长：屏幕宽度 × 75%
- 输出尺寸：与裁切区相同
- 最小缩放：长边缩至裁切区 × 0.4，下限 0.3
- 最大缩放：3×

---

### 4.5 访客页（pages/visitors/index）

**功能模块**：
1. **统计数据** - 名片数 / 访客数 / 多次来访数
2. **访客列表** - 最近访客（最多50条），含操作按钮

**数据加载策略**：同样采用三级降级
- 优先 `initVisits` 云函数
- 降级为直接查 `visits` 集合
- visits 集合不存在时显示空状态

---

### 4.6 名片列表（pages/list/index）

**功能**：简单的名片列表页面，`onShow` 时全量刷新名片数据。

**关键方法**：

| 方法 | 功能 |
|------|------|
| `loadCards()` | 全量加载名片（orderBy createTime desc） |
| `goToEdit(e)` | 跳转编辑页，传 id 则为编辑模式 |
| `goToPreview(e)` | 跳转预览页 |
| `onPullDownRefresh()` | 下拉刷新 |

---

### 4.7 个人中心（pages/profile/index）

**功能模块**：

1. **用户信息** - 微信头像、昵称、OpenID
2. **快捷导航** - 名片列表、访客统计入口
3. **主题选择** - 6种配色方案可选，持久化到 Storage
4. **默认名片设置** - 从名片列表中选择默认名片
5. **设置项** - 清空缓存、关于我们

**主题配色方案**：

| 主题名称 | 颜色值 |
|---------|--------|
| 品牌蓝 | #3B82F6 |
| 活力橙 | #FF6A00 |
| 清新绿 | #00B42A |
| 玫瑰红 | #F53F3F |
| 香槟金 | #D9A94C |
| 神秘紫 | #722ED1 |

---

### 4.8 协议页（pages/agreement/index）

**功能**：隐私政策 + 用户服务协议展示，支持 Tab 切换。

- 内容以 HTML 富文本形式内嵌在 JS 中
- 通过 `tab` URL 参数控制初始展示哪个协议
- 首页隐私弹窗中链接到此页面

---

## 5. 云函数设计

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
    unionid?: string
  }
}
```

### 5.2 getQrCode

**功能**：生成小程序码（wxacode）

**入口参数**：

| 参数 | 类型 | 含义 |
|------|------|------|
| path | string | 小程序页面路径 |

**处理流程**：
```
调用 cloud.openapi.wxacode.get() → 获取 buffer
→ cloud.uploadFile() 上传到 qrcodes/ 目录
→ 返回 fileID
```

**返回值**：
```javascript
{
  success: true,
  fileID: string      // 云存储 fileID
}
```

### 5.3 initVisits

**功能**：访客记录管理（多 action 云函数），支持以下操作：

| Action | 功能 | 关键参数 |
|--------|------|---------|
| `ensureCollection` | 确保 visits 集合存在 | 无 |
| `recordVisit` | 记录一次名片访问 | cardId, visitorOpenId, source |
| `getMyVisitorStats` | 获取访客统计 | cardOwnerId |
| `getRecentVisitors` | 获取最近访客列表 | cardOwnerId, limit |

**recordVisit 去重逻辑**：
- 30 分钟内同一用户访问同一名片：更新 `visitTime` + `visitCount++`
- 超过 30 分钟：创建新记录
- 访问自己的名片：跳过不记录（return skipped）

**getMyVisitorStats 返回值**：
```javascript
{
  ok: true,
  visitors: number,   // 访客总数
  viewed: number      // 多次来访数（visitCount > 1）
}
```

---

## 6. 全局应用（app.js）

### 6.1 globalData

| 字段 | 类型 | 含义 |
|------|------|------|
| userInfo | object | 微信用户信息 |
| systemInfo | object | 系统/设备/窗口信息 |
| cardsCache | array | 名片列表缓存 |
| lastUpdateTime | number | 最后更新时间戳 |
| cropImageSrc | string | 裁切页图片路径（临时） |
| openid | string | 用户 OpenID（如有） |

### 6.2 工具方法

| 方法名 | 功能 | 参数 |
|--------|------|------|
| `initPrivacy()` | 初始化隐私授权监听 | 无 |
| `initCloud()` | 初始化云开发环境 | 无 |
| `getSystemInfo()` | 获取系统信息 | 无 |
| `showLoading(title)` | 显示加载提示 | title: string |
| `hideLoading()` | 隐藏加载提示 | 无 |
| `showError(title, duration)` | 显示错误提示 | title, duration(默认2000ms) |
| `showSuccess(title, duration)` | 显示成功提示 | title, duration(默认1500ms) |
| `showConfirm(title, content)` | 显示确认弹窗 → Promise | title, content |
| `getCache(key)` | 获取存储的缓存数据 | key |
| `setCache(key, value, expire)` | 设置缓存（默认5分钟过期） | key, value, expire(ms) |
| `isCacheValid(key)` | 检查缓存是否有效 | key |
| `isValidPhone(phone)` | 验证手机号 | /^1[3-9]\d{9}$/ |
| `isValidEmail(email)` | 验证邮箱 | /^[^\s@]+@[^\s@]+\.[^\s@]+$/ |
| `formatTime(date)` | 格式化时间为 YYYY-MM-DD | date |
| `debounce(fn, delay)` | 防抖函数 | fn, delay(默认500ms) |

---

## 7. UI 设计规范

### 7.1 设计原则

1. **素雅简洁**：中性灰色系配色，降低视觉复杂度
2. **扁平化设计**：无渐变填充，仅保留线条和基础形状
3. **线条图标**：统一使用 CSS 绘制的单色线条图标
4. **间距规范**：基础间距 24rpx，卡片圆角 20rpx
5. **响应式布局**：使用 rpx 单位确保跨设备兼容

### 7.2 颜色规范

| 颜色用途 | 颜色值 |
|---------|--------|
| 主文字 | #1F2937 |
| 次要文字 | #4B5563 |
| 辅助文字 | #6B7280 |
| 提示文字 | #9CA3AF |
| 背景色 | #F9FAFB |
| 卡片背景 | #FFFFFF |
| 分隔线 | #F3F4F6 |
| 边框 | #E5E7EB |
| 导航栏 | #3B82F6 |
| 危险/删除 | #EF4444 |
| 成功 | #10B981 |
| 裁切页背景 | #000000 / #111111 |

### 7.3 全局工具类（app.wxss）

提供 flex 布局、文本颜色、背景色、圆角、阴影、动画等通用原子类：
- `.flex` / `.flex-center` / `.flex-between` / `.flex-column`
- `.text-primary` / `.text-secondary` / `.text-danger` / `.text-success`
- `.bg-white` / `.bg-primary` / `.bg-gray-50`
- `.rounded-sm` (8rpx) / `.rounded` (12rpx) / `.rounded-lg` (20rpx) / `.rounded-xl` (28rpx) / `.rounded-full`
- `.shadow-sm` / `.shadow-md` / `.shadow-lg`
- `.card` - 标准卡片样式
- `.btn-primary` / `.btn-secondary` - 按钮样式
- `.safe-area-bottom` - 安全区适配

---

## 8. 全局配置（app.json）

**导航栏**：品牌蓝 (#3B82F6) 背景，白色文字

**已注册页面（8个）**：
```
pages/index/index（首页入口）
pages/edit/index
pages/preview/index
pages/visitors/index
pages/agreement/index
pages/list/index
pages/profile/index
pages/crop/index
```

**权限声明**：

| 权限 | 用途说明 |
|------|---------|
| scope.camera | 拍照、录制视频 |
| scope.writePhotosAlbum | 保存图片到相册 |

---

## 9. 安全与隐私

### 9.1 隐私授权

- **隐私政策弹窗**：首页 onLoad 时通过 `wx.getPrivacySetting` 检查是否需要授权
- **协议页面**：`/pages/agreement/index` 含隐私政策和服务协议
- **隐私监听**：`wx.onNeedPrivacyAuthorization` 处理运行时隐私授权需求
- **相册权限拒绝处理**：编辑页头像选择时，权限拒绝会引导用户去系统设置开启

### 9.2 数据安全

1. **HTTPS 传输**：所有网络请求通过微信云开发 API 加密传输
2. **访问控制**：名片数据按用户隔离，通过云函数确保权限
3. **自己访问过滤**：visits 记录中不记录自己访问自己的名片
4. **敏感信息**：手机号码、邮箱为可选项，用户自主决定是否填写

---

## 10. 已知技术约束与解决方案

| 问题 | 解决方案 |
|------|---------|
| babel 转译器 ES6+ 语法报错 | crop 页面全部使用 ES5 语法 |
| movable-view 手势回弹 | 非受控模式：bindscale/bindchange 只更新内部变量 |
| wx.getImageInfo 对临时文件不稳定 | 两阶段加载：独立 image bindload 获取尺寸 |
| 小程序 WXSS keyframes 全局污染 | 裁切页动画类名加 `crop-` 前缀 |
| URL 参数对 wxfile:// 编码不可靠 | 使用 app.globalData.cropImageSrc 传路径 |
| visits 集合可能不存在 | 三级降级：云函数 → 直接查库 → 静默失败 |
| 云函数未部署时前端报错 | .catch() 静默处理，不影响核心功能 |
| 访客统计 30 分钟内重复 | 云函数 recordVisit 更新时间 + visitCount++ |

---

## 11. 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|---------|
| v1.0.0 | 2024-06 | 初始版本：基础名片功能 |
| v1.1.0 | 2024-06 | 添加过往经历、附件、个人介绍、业务介绍模块 |
| v1.1.1 | 2024-06 | 添加公众号链接、公司主页模块，公开/隐藏开关 |
| v1.2.0 | 2024-06 | 添加裁切页、名片列表页、访客页；重构头像上传流程（移除拍照选项）；访客统计三级降级策略；recordVisit 记录机制 |

---

**文档版本**: v2.0  
**最后更新**: 2026年6月10日  
**更新说明**: 基于实际代码重新扫描，修正页面路由、云函数列表、数据模型、头像上传流程等
