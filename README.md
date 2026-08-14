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

### v1.0.0
- 基础名片创建、编辑、预览功能
- 访客记录追踪（三级身份识别）
- Canvas 分享卡片生成
- 名片收藏功能
- 完整隐私授权流程

## License

MIT License
