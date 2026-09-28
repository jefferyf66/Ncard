# 科博名片 (Ncard)

数字名片管理微信小程序，基于微信云开发构建，支持名片创建、分享、访客追踪等核心功能。

## 功能特性

### 核心功能
- **名片创建与编辑**：支持姓名、职位、公司、电话、邮箱、地址等基础信息
- **扩展信息**：个人介绍、业务介绍、过往经历、名片附件、公众号链接、公司主页
- **名片预览**：实时预览名片效果，智能按钮（自有→编辑/删除，他人→保存/已保存）
- **分享卡片生成**：Canvas 自动生成精美分享图片（5:4 JPG <128KB，HTTPS CDN 跨设备可靠）
- **名片收藏**：保存他人名片到个人名片夹
- **访客追踪**：记录名片访问记录，支持三级匿名身份识别

### 访客身份识别（三级体系）
| 级别 | 身份类型 | 展示信息 |
|------|----------|----------|
| L3 | 卡片用户 | 真名 + 头像 + 职位 + 公司 |
| L2 | 已授权用户 | 微信昵称 + 头像 |
| L1 | 匿名访客 | "访客 #XXXX" + 默认图标 |

### 隐私保护
- 微信官方隐私弹窗（`__usePrivacyCheck__: true`）
- 云存储所有用户可读，头像和分享图直接通过永久 HTTPS URL 访问
- 访客授权引导条（非阻断式，当天冷却期）
- 隐私协议拒绝时统一错误提示（errCode 103/104）

## 技术栈

- **框架**：微信小程序原生框架
- **云服务**：微信云开发（云数据库 + 云函数 + 云存储）
- **Canvas**：分享卡片生成（v8 方案 D：Banner 触顶 + 透明间隙 + 5:4 导出）
- **设计系统**：Hybrid 风格（B 钴蓝基座 × D 编辑字体钮形 × C 暖调渐变）

## 项目结构

```
├── miniprogram/          # 小程序前端代码
│   ├── pages/
│   │   ├── index/        # 首页（名片列表 + 访客概览 + 分享卡片预生成）
│   │   ├── edit/         # 名片编辑页（创建/修改 + 头像上传）
│   │   ├── preview/      # 名片预览页（详情 + 分享 + 保存 + L2 授权）
│   │   ├── visitors/     # 访客记录页（三级身份展示）
│   │   ├── list/         # 名片夹（收藏的他人名片）
│   │   ├── profile/      # 个人中心
│   │   └── agreement/    # 隐私政策 / 服务协议
│   ├── config/
│   │   └── cardStyle.js  # 名片样式统一配置（单一数据源）
│   ├── utils/
│   │   └── shareCard.js  # Canvas 分享卡片生成器（v8）
│   ├── images/           # 静态资源
│   ├── app.js            # 应用入口（OpenID 缓存、隐私错误处理）
│   ├── app.json          # 配置文件（官方隐私弹窗已启用）
│   └── app.wxss          # 全局样式
├── cloudfunctions/       # 云函数
│   ├── getOpenId/        # 获取用户 OpenID
│   ├── initVisits/       # 访客记录管理（含三级身份 enrichment）
│   └── deleteCard/       # 级联删除名片
├── project.config.json   # 项目配置
└── README.md             # 项目说明
```

## 云数据库集合

| 集合名 | 用途 |
|--------|------|
| cards | 名片数据（姓名、职位、公司、联系方式等） |
| visits | 访客记录（访问时间、身份级别、访问次数） |
| user_save_cards | 用户收藏的名片记录 |
| visitor_profiles | 访客授权资料（微信昵称、头像） |

## 云函数说明

### getOpenId
获取当前用户的 OpenID，用于身份验证和数据隔离。客户端有内存缓存避免重复调用。

### initVisits
访客记录管理，包含以下操作：
- `ensureCollection`: 确保 visits 集合存在
- `recordVisit`: 记录访问（含三级身份 enrichment）
- `getMyVisitorStats`: 获取访客统计
- `getRecentVisitors`: 获取最近访客列表
- `getMyVisitorDashboard`: 合并三路查询（统计 + 最近 + 新卡片数）

### deleteCard
级联删除名片，清理以下数据：
- cards 集合中的文档
- user_save_cards 中的保存记录
- visits 中的访问记录
- 云存储中的头像和附件文件

## 页面路由

| 路径 | 页面 | 说明 |
|------|------|------|
| /pages/index/index | 首页 | 卡片列表 + 访客统计 + 分享预生成 |
| /pages/edit/index | 编辑页 | 创建/编辑名片（含头像上传） |
| /pages/preview/index | 预览页 | 名片详情 + 智能操作 + L2 授权 |
| /pages/visitors/index | 访客页 | 访客列表 + 统计数据 |
| /pages/list/index | 名片夹 | 收藏的他人名片 |
| /pages/profile/index | 个人中心 | 用户设置 |
| /pages/agreement/index | 协议页 | 隐私政策 / 服务条款 |

## 发布前检查清单

- [x] 删除所有测试页面和未使用权限声明
- [x] 品牌色统一为 `#3B82F6`
- [x] 官方隐私弹窗已启用（`__usePrivacyCheck__`）
- [x] 云函数已全部部署（3 个）
- [ ] MP 后台：配置用户隐私保护指引（仅勾选「收集你选中的照片或视频文件」）
- [ ] MP 后台：提交审核
- [ ] 云控制台：存储权限改为「仅创建者可读写」

## 开发指南

```bash
# 使用微信开发者工具打开项目根目录

# 云函数部署（首次部署）
# 1. 在微信开发者工具中右键云函数目录
# 2. 选择"上传并部署：云端安装依赖"
# 3. 全部 3 个云函数都需要部署

# 数据库初始化
# 1. 在云开发控制台创建以下集合：
#    - cards
#    - visits
#    - user_save_cards
#    - visitor_profiles
# 2. 配置集合权限（参考安全规则）
```

## 安全规则建议

### 云数据库权限
```javascript
// cards 集合：仅创建者可读写
{
  "read": "auth.openid == resource.data._openid",
  "write": "auth.openid == resource.data._openid"
}

// visits 集合：仅管理员可写，所有用户可读
{
  "read": true,
  "write": false
}

// user_save_cards 集合：仅创建者可读写
{
  "read": "auth.openid == resource.data._openid",
  "write": "auth.openid == resource.data._openid"
}
```

### 云存储权限
- 设置为「所有用户可读，仅创建者可读写」
- 头像和分享图通过永久 HTTPS URL 直接访问，无需云函数代理

## 版本历史

详见 [CHANGELOG.md](CHANGELOG.md)

### v1.5.13 (2026-09-28)
- 🐞 修复预览页加载超时误报：`onLoad` 与 `onShow` 首次进入连续触发导致 `loadCard` 并发两次、`_loadTimer` 句柄被覆盖、首个 10 秒定时器泄漏，数据已渲染后照常触发「加载超时」错误态；改为 `onShow` 首次去重 + `loadCard` 开头防御性清理旧定时器（纯前端改动，无需重传云函数）

### v1.5.12 (2026-09-24)
- 🐞 修复授权访客锁定区冲突：已授权后主区显示电话/邮箱/地址，但锁定区仍提示「登录后查看」的逻辑矛盾（`initVisits.getCardView` 的 `lockedFields` 计算排除已授权字段）
- 🐞 修复授权后底部引导条残留：`preview.confirmAuth` 成功同步关闭 banner，且已授权访客回访不再误弹引导条
- ☁️ 需重新上传 `initVisits` 云函数并勾「云端安装依赖」+ 重新上传小程序体验版

### v1.5.11 (2026-09-20)
- 💬 一次性分享留言：分享名片可附一句话介绍，仅随本次链接传递、写 visits（不进名片、每次可不同）；落地页横幅展示、访客记录可见
- 🪟 分享填写层防重叠：蒙层层级压过 tab-bar + 打开时隐藏底部导航，按钮不再被压住
- ⚡「最近用过」一键点取：本机留存最近 3 条留言，点 chip 直接回填 textarea
- ☁️ 配套 `initVisits` 云函数新增 note/shareId 写入，上线需手动上传并勾「云端安装依赖」

### v1.5.10 (2026-09-07)
- 📇 访客「保存到通讯录」：preview 页一键调用 `wx.addPhoneContact`，姓名/电话/邮箱/公司/职位/网址/头像导入系统通讯录（iOS 确认卡 / Android 直接写入，两端通用，需用户确认）
- 🐞 修复既有 saveToContact：头像参数误传远程 URL 被忽略（改 downloadFile 转本地临时文件）、校验过严（放宽至姓名/电话/邮箱其一即可）
- 📱 纯前端改动，无需部署云函数

### v1.5.9 (2026-09-04)
- 🖼️ 分享卡片「所见即所得」修复：Canvas 分享图对齐首页卡片视觉——姓名/职位左对齐于头像右侧起点、联系方式左对齐、文字块相对头像垂直居中、头像圆角 16→4rpx
- 🔧 根因：`cardStyle.js` 单一数据源漂移（旧版右对齐常量未随 v1.5.7 UI 改版同步，Canvas 是其唯一消费者）；高度公式未动，卡片尺寸/气泡适配不变
- 📱 纯前端改动，无需部署云函数；验证需编辑页重新保存卡片（绕过 10min 缓存 + DB 旧图）

### v1.5.8 (2026-09-03)
- 🎨 全局背景纯白化：12 页 17 处暖调渐变 + 窗口 backgroundColor 统一 #FFFFFF（crop 沉浸式豁免），「暖调渐变」设计方向作废
- 📱 custom-tab-bar 真机修复：CSS border 自绘图标改 Pillow 绘制 PNG（8 张，4 图标×灰/蓝）+ `<image>` 组件加载；根因为容器高度与 safe-area 盒模型关系不确定导致 flex 压缩图标（box-sizing:content-box + flex-shrink:0 修复）
- ✨ tab-bar 悬浮效果：白底距顶 40rpx 垫起（含 safe-area calc），图标约一半悬浮，圆角上缘 + 上扬阴影；图标挂 binderror 自诊断
- 📱 纯前端改动，无需部署云函数

### v1.5.7 (2026-09-03)
- 🎨 UI 全面审计 + 全量修复：0 P0，8 P1 必修 + 14 P2 优化全部闭环，另补 QA 复验 10 处零样式类（报告见 `artifacts/ui-audit-2026-09-02.md`）
- 🔧 P1 渲染级修复：preview 授权弹窗 7 类样式补齐（确认按钮红色→蓝色语义修正）、锁定占位区零样式补齐（🔒 换 CSS 锁图标）、失效邀请蓝条→红色警告、index 顶部 padding 失效变量、保存按钮接防重态
- 📐 设计令牌收敛：圆角 3 档变量化（8/16/24rpx）、主按钮统一 135° 蓝渐变+88rpx、三套灰阶归一 slate、背景暖调归族、头像形状语义化（个人锐角方/团队正圆）
- 👆 触控目标 ≥88rpx 全覆盖（15+ 处小热区）；list 页 emoji 图标换 CSS 线性图标；导航栏全 App 统一品牌蓝（crop 沉浸式豁免）
- ♿ WCAG AA 对比度（22→24rpx、#94A3B8→#64748B）；弹窗 z-index 统一 1000 + 模式归位；双标题栏删除；~400 行死样式清理；1px→2rpx
- 📱 纯前端改动，开发者工具编译即生效，无需部署云函数

### v1.5.6 (2026-09-02)
- 🔍 全面代码审计（八维）：0 P0，5 P1 + 17 P2 全部修复闭环，QA 两轮回归通过（报告见 `artifacts/code-audit-2026-09-02.md`）
- 🔒 隐私/越权：`exportMyData` 剔除访客手机号（SEC-03 旁路）；`deleteCard` 所有权严格校验；`getTeam` 非成员剔除 cardSchema 预填内容
- 🔧 竞态/截断：编辑页二维码与附件「先删后存」改基线延迟清理；名片夹 >20 张分页拉全量；`app.getCache` 解包修复首页恒重载与缓存永不命中
- 📈 teamManager 新增 `fetchAllPages`/`fetchByInIds` 分批聚合，六处查询突破 `_.in` 20 条与 get 100 条上限；admin 解散团队改分页删除
- ⚙️ adminManager 新增 `config.json`（60s/256M 固化）；邀请码限额条件更新+回滚；visitors 页删假降级改错误态；输入截断、缓存 LRU、死参数/重复实现收敛
- ☁️ `accountManager` / `teamManager` / `initVisits` / `deleteCard` / `adminManager` 五个云函数须重新上传部署（均必勾「云端安装依赖」）；前端 9 文件编译即生效

### v1.5.5 (2026-09-01)
- 🧹 云存储冗余治理闭环：堵增量 + 清存量
- 🔧 `deleteCard` 级联删分享图（fileID/HTTPS 反解/确定式兜底三层依据），根治「删卡分享图永久孤儿」P0 泄漏；`cards` 新增 `shareImageFileID` 冗余字段
- 🔧 换头像删旧收拢服务端 `accountManager.updateMyProfile`（删前查引用安全），「我的」页与编辑页两入口自动对齐；edit 页删旧挪到 saveCard 成功后，消除「先删后存」悬空引用竞态
- 📊 `adminManager` 新增 `storageAudit`（对账报告，只读）与 `storagePurge`（dryRun 预览 + execute 真删，现算现复核、断点重跑安全），仅 root、写审计日志
- 🗑️ 首轮清理：经对账+人工确认删 70/70 孤儿（avatars 11→4、sharecards 66→3，约 4MB），零误删
- ☁️ `accountManager` / `deleteCard` / `adminManager` 须重新上传部署（adminManager 必勾「云端安装依赖」）；前端热重载即可

### v1.5.4 (2026-09-01)
- 🔀 首页名片句柄拖拽排序：每张卡右侧 ≡ 句柄按住拖动调整顺序，松手自动持久化（每卡写 `order`，复用「仅创建者可读写」直连 update，无新增云函数）
- 🎛️ 编辑页字段可见性三态开关落地：废弃 `publicSettings`，姓名/职位/公司/电话/邮箱改 `fieldVisibility` 三档图标（公开/授权后/仅自己），点击循环切换并气泡提示；兼容旧数据
- ✅ 必填项收敛为 姓名/电话/邮箱（含格式校验），公司/职位改选填（团队用户未必是公司职员）
- 🗑️ 编辑页删除附件 / 过往经历新增二次确认，防误触
- 🐛 邮箱栏遮挡修复；`saveCard` 不再写 `publicSettings`，preview 区块改依赖服务端已过滤字段
- 🖥️ 纯前端改动，开发者工具热重载即可；无需部署云函数

### v1.5.3 (2026-08-28)
- 🧹 后台「未命名」用户批量归档（仅 root）：`adminManager.batchArchiveUnnamed` 查 `nickname='' AND active` 普通用户（排除 admin/root/本人），默认 dryRun 仅返回候选清单，显式 `dryRun=false` 才归档并写审计
- 🎯 启动昵称补全软引导：`app.js` 对用户昵称为空且非 admin/root 时跳账号设置页"请先完善昵称"，已有昵称不骚扰
- ✂️ 编辑页 A+B 配置精简：`wechatOfficial` 改为 `{name,qrcode}`（去 url/desc）、`companyWebsite` 去 desc
- ☁️ `adminManager` 须重新上传部署；app.js 热重载即可

### v1.5.2 (2026-08-27)
- 🟢 名片公众号二维码展示与关注：`wechatOfficial` 新增 `qrcode` 字段，编辑页可上传二维码；对外页点公众号卡片弹出二维码弹窗，收卡人长按识别关注（合规跨主体，聊转/扫码全可用），无码降级复制链接
- 💡 编辑页新增公众号二维码获取指引文案，消除主人"不知去哪拿二维码"卡点
- 🖥️ 纯前端改动，开发者工具热重载即可；无需部署云函数

### v1.5.1 (2026-08-26)
- 🔄 访客身份读时解析（方案 A）：新增 `resolveVisitorIdentities` 批量查 cards(L3)+visitor_profiles(L2) 覆盖回传，根治访客升级身份后列表不刷新
- 🔒 封堵 SEC-03 访客电话泄露：`getRecentVisitors`/`getMyVisitorDashboard` 读取侧无条件 `delete v.visitorPhone`
- 🐛 修复「我的」页 / 账号设置页头像不显示：改为 `cloud://` 原生渲染（对齐编辑页），绕过不可靠 https CDN，选完即回显
- ☁️ `initVisits` 须重新上传部署；前端热重载即可

### v1.5.0 (2026-08-26)
- 🔐 访客授权披露（D5 安全模型）：`fieldVisibility` 三级可见性 + 服务端 `getCardView` 强制过滤 + `authorizeVisit` 授权流；`edit` 三态可见性开关、`preview` 授权引导与锁定占位，越权读卡漏洞关闭
- 📂 名片夹改走云函数读卡（`getCardsBatch`），`cards` 集合可安全收紧为「仅创建者可读写」而名片夹不再空白
- ☁️ `initVisits` 须重新上传部署（覆盖 getCardView/authorizeVisit/getCardsBatch + visibility.js）

### v1.4.3 (2026-08-26)
- ✨ 访客来源按名片区分：显示具体名片名并可点击跳转该卡详情，全局访客视图按名片归属一目了然
- 🐛 修复访客头像裸 `cloud://` 渲染失败（visitorAvatar 未过 `storage.resolveCloudUrl`）
- ☁️ `initVisits` 须重新上传部署；前端热重载即可

### v1.4.2 (2026-08-26)
- 🔒 安全/数据一致性审计修复（P1 Top5）：批量删除分页突破 1000 上限、注销级联清理团队与访客数据（彻底抹除本人标识）、getCardTeams 防社交图谱泄露、单用邀请码原子条件更新防并发复用、运营后台 memberCount 字段修正
- ☁️ 改完须重新上传部署 `teamManager` / `deleteCard` / `accountManager` / `adminManager`

### v1.4.1 (2026-08-24)
- 🐛 「我的」页指标卡接真数据（名片数 = cards.count、访客数 = initVisits 同口径），修复恒为 0；点击跳首页消除语义错位
- 🧹 移除「主题颜色」「默认名片」两个只存不用的半成品设置项（含弹层与样式）
- 🔢 关于页版本号 `APP_VERSION` 1.1.4 → 1.4.0（停更 3 个大版本缺陷）
- 🎨 补账号设置图标缺失样式；「已绑定账号」文案 →「已登录」
- ⚙️ 构建配置：开启 `lazyCodeLoading` 修复上传扫描、关闭增强编译修复 `@babel/runtime` 编译报错

### v1.4.0 (2026-08-24)
- ✨ 用户管理模块（方案A）：自助账号体系 + 运营后台，root 角色晋升与权限管控
- 🧭 自定义 tabBar 导航重构（方案C）：名片 / 名片夹 / 团队 / 我的 四域一级导航 + 中央品牌蓝「＋」创建入口（创建名片 / 团队 / 加入团队）
- 🏢 名片夹团队名片区分：后端 `getCardsTeams` 批量归属查询（私密非成员隔离）+ 前端视觉三要素（蓝条 / 蓝描边 / 团队徽章）+ 分段筛选 + 点击进团队视图
- 📝 团队空名片邀请流：owner 配置字段（cardSchema）→ 成员填空表单（预填回显 + 必填校验）→ 直接加入
- 🔄 产品统一更名：科博名片 → 投贴儿
- 🔧 团队数据层 `managedFields` 统一命名 + 安全 / 逻辑 / 数据完整性审计修复

### v1.3.0 (2026-08-19)
- ✨ 访客数据 per-card 化：详情页新增「访客分析」区，访客页支持 `?cardId=` 单卡筛选（initVisits 三聚合加可选 cardId）
- 🏢 团队能力增强：公开团队目录、整组分享、成员托管名片、解散团队级联清理
- 🎨 首页重构：UI 对齐设计系统、头部重排、团队入口底部化
- 🧹 首页移除名片数据统计区与最近访客（访问数据随具体名片走，归位详情页）

### v1.2.0 (2026-08-17)
- 🐛 修复 edit 页 page-content 闭合标签缺失导致的 WXML 编译错误

### v1.1.4 (2026-08-14)
- ♻️ 新增 `config/storage.js` 作为云存储 HTTPS 基址单一真源，移除 4 文件 5 处硬编码
- ♻️ 替换 `crop` / `shareCard` / `index` 三处弃用 `wx.getSystemInfoSync()` 为官方推荐 API
- 📄 新增团队租户功能设计方案 v0.4 与微信 openid 快速登录机制设计方案 v0.2（已对照官方文档核验）
- 🧹 `.gitignore` 纳入 `.workbuddy/`，内部产物不再进版本库

### v1.1.3 (2026-06-18)
- 🐛 分享气泡卡片接收方不可见修复（根因：MP后台分享安全校验开关；代码防御性优化：Promise链+JPEG<128KB+三层降级）

### v1.1.2 (2026-06-18)
- 🐛 分享气泡卡片接收方不可见修复（6轮迭代：时序竞态 + cloud:// 跨设备 + 扩展名格式匹配 + downloadFile 域名 + 缓存 busting）

### v1.1.1 (2026-06-17)
- 🐛 紧急修复 index.wxml UTF-8 编码损坏导致 WXML 编译错误
- ✨ 无名片时隐藏右下角新增名片悬浮按钮，空状态提示文案优化
- ✨ 恢复 crop 头像裁切页完整功能（缩放 + Canvas 裁切 + 九宫格线）
- 🎨 首页约 20 个缺失 CSS 类补全，纯 CSS 图标实现
- 🧹 删除 wx.addFavorite 非法 API、handleVisitorAction 等死代码

### v1.1.0 (2026-06-17)
- 深度审核修复 12 项：删除无用 getQrCode 云函数、修复 WXML 重复渲染、补充云函数依赖声明
- selectDefaultCard 云端持久化（cards 集合 isDefault 字段）
- 主题选择云同步（visitor_profiles themeColor 字段）
- profile 页 loadCardList 显式 _openid 过滤
- 隐藏空壳操作按钮、visitors 页 ES5→ES6 改写
- sitemap.json 隐私页面禁止收录
- edit 页 chooseAvatar 直接上传（移除 crop 跳转死代码）
- DOCUMENTATION.md 全面重写、DEPLOYMENT-GUIDE.md 修订

### v1.0.9 (2026-06-16)
- 分享卡片 v8 重构：Banner 触顶 + 透明间隙 + 精确 5:4 导出（符合微信分享规范）
- Canvas 序列化锁：防止多卡片并发生成竞态导致头像降级
- 引入 cardStyle.js 统一数据源，动态计算 Canvas 尺寸
- 编辑页保存后通知首页/预览页强制刷新（cardsNeedRefresh 机制）
- 预览页 onShow 始终重新加载，移除 isError 前置条件
- app.json 清理：移除未使用的 permission 声明和测试页面
- 全部 5 处 setClipboardData 和 addPhoneContact 补充隐私错误处理
- 隐私协议拒绝时统一提示（errCode 103/104）

### v1.0.8 (2026-06-16)
- 首页发名片按钮优化，使用微信原生分享按钮
- 修复按钮点击跳转到预览页的问题
- 简化分享流程，与详情页保持一致

### v1.0.7 (2026-06-13)
- 🎨 首页名片列表使用 Canvas 渲染预览
- 🐛 优化 Canvas 渲染，修复 5 个问题
- ⚙️ 更新 release 工作流配置（GitHub Actions 权限）

### v1.0.6 (2026-06-13)
- 🛠 完善项目配置，接入 visitors 页面至 app.json
- 🐛 修复代码质量扫描问题
- 🐛 修复 edit/index 页面 wxml 编码与中文乱码、变量名问题
- 🐛 修复首页加载逻辑（去除 openid 过滤），恢复原始中文 UI 文件

### v1.0.0
- 基础名片创建、编辑、预览功能
- 访客记录追踪（三级身份识别）
- Canvas 分享卡片生成
- 名片收藏功能
- 完整隐私授权流程

## License

MIT License
