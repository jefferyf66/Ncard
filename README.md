# 科博名片 (Ncard)

数字名片管理微信小程序，基于微信云开发构建，支持名片创建、分享、访客追踪等核心功能。

## 功能特性

### 核心功能
- **名片创建与编辑**：支持姓名、职位、公司、电话、邮箱、地址等基础信息
- **扩展信息**：个人介绍、业务介绍、过往经历、名片附件、公众号链接、公司主页
- **头像裁切**：支持从相册选择图片并进行正方形裁切
- **名片预览**：实时预览名片效果，支持分享到微信聊天和朋友圈
- **分享卡片生成**：自动生成精美 Canvas 分享图片（2:1 比例）
- **名片收藏**：保存他人名片到个人名片夹
- **访客追踪**：记录名片访问记录，支持三级匿名身份识别

### 访客身份识别（三级体系）
| 级别 | 身份类型 | 展示信息 |
|------|----------|----------|
| L3 | 卡片用户 | 真名 + 头像 + 职位 + 公司 |
| L2 | 已授权用户 | 微信昵称 + 头像 |
| L1 | 匿名访客 | "访客 #XXXX" + 默认图标 |

### 隐私保护
- 完整的隐私授权流程
- 云存储文件安全访问控制
- 匿名访客保护机制（7天冷却期）

## 技术栈

- **框架**：微信小程序原生框架
- **云服务**：微信云开发（云数据库 + 云函数 + 云存储）
- **Canvas**：分享卡片生成、头像裁切
- **安全**：JWT OpenID 身份验证

## 项目结构

```
├── miniprogram/          # 小程序前端代码
│   ├── pages/
│   │   ├── index/        # 首页（名片列表 + 访客概览）
│   │   ├── edit/         # 名片编辑页
│   │   ├── preview/      # 名片预览页（含分享功能）
│   │   ├── visitors/     # 访客记录页
│   │   ├── list/         # 名片夹（收藏的名片）
│   │   ├── profile/      # 个人中心
│   │   ├── crop/         # 头像裁切页
│   │   └── agreement/    # 隐私协议页
│   ├── utils/
│   │   └── shareCard.js  # Canvas 分享卡片生成器
│   ├── images/           # 静态资源
│   ├── app.js            # 应用入口
│   ├── app.json          # 配置文件
│   └── app.wxss          # 全局样式
├── cloudfunctions/       # 云函数
│   ├── getOpenId/        # 获取用户 OpenID
│   ├── getQrCode/        # 生成小程序二维码
│   ├── initVisits/       # 访客记录管理（含身份识别）
│   ├── resolveCloudUrls/ # 云文件 URL 转换代理
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
获取当前用户的 OpenID，用于身份验证和数据隔离。

### getQrCode
生成小程序二维码，支持自定义页面路径。

### initVisits
访客记录管理，包含以下操作：
- `ensureCollection`: 确保 visits 集合存在
- `recordVisit`: 记录访问（含三级身份 enrichment）
- `getMyVisitorStats`: 获取访客统计
- `getRecentVisitors`: 获取最近访客列表

### resolveCloudUrls
以管理员身份将 `cloud://` fileID 转换为临时 HTTPS URL，绕开云存储权限限制。

### deleteCard
级联删除名片，清理以下数据：
- cards 集合中的文档
- user_save_cards 中的保存记录
- visits 中的访问记录
- 云存储中的头像和附件文件

## 页面路由

| 路径 | 页面 | 说明 |
|------|------|------|
| /pages/index/index | 首页 | 名片列表 + 访客统计 + 快捷入口 |
| /pages/edit/index | 编辑页 | 创建/编辑名片 |
| /pages/preview/index | 预览页 | 名片详情 + 分享 + 保存 |
| /pages/visitors/index | 访客页 | 访客列表 + 统计 |
| /pages/list/index | 名片夹 | 收藏的他人名片 |
| /pages/profile/index | 个人中心 | 用户设置 |
| /pages/crop/index | 裁切页 | 头像裁切 |
| /pages/agreement/index | 协议页 | 隐私政策 / 服务条款 |

## 发布前检查清单

- [x] 删除所有 mock 数据和硬编码测试数据
- [x] 品牌色统一为 `#3B82F6`
- [x] 隐私授权配置（`__usePrivacyCheck__`）
- [x] 权限声明配置（相机、相册）
- [x] 云函数已部署
- [ ] 微信公众平台：配置用户隐私保护指引
- [ ] 微信公众平台：提交审核

## 开发指南

```bash
# 使用微信开发者工具打开项目根目录

# 云函数部署（首次部署）
# 1. 在微信开发者工具中右键云函数目录
# 2. 选择"上传并部署：云端安装依赖"

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
- 设置为「仅创建者可读写」
- 通过 `resolveCloudUrls` 云函数代理访问

## 版本历史

### v1.0.8
- 首页发名片按钮优化，使用微信原生分享按钮
- 修复按钮点击跳转到预览页的问题
- 简化分享流程，与详情页保持一致

### v1.0.6
- 修复 edit/index.js 重复函数定义导致删除附件功能崩溃
- 删除未使用的 getQrCode 死代码云函数
- 修复 L2 访客身份识别失效问题（添加 openid 字段）
- 完善 initVisits 参数校验，防止权限绕过
- 添加 getQrCode path 参数格式校验
- 完成全面的死代码检测和分析
- 完成分享卡片和头像可见性测试

### v1.0.0
- 基础名片创建、编辑、预览功能
- 访客记录追踪（三级身份识别）
- Canvas 分享卡片生成
- 头像裁切功能
- 名片收藏功能
- 完整隐私授权流程

## Release Notes

详细的版本发布说明请查看 [RELEASE_NOTES.md](RELEASE_NOTES.md)

## License

MIT License