# Release Notes

## v1.0.8 (2026-06-13)

### 🎯 核心改进

**首页发名片按钮优化**
- 将自定义按钮替换为微信原生 `open-type="share"` 按钮
- 简化分享流程：点击直接唤起微信分享菜单
- 与名片详情页分享按钮实现保持一致

### 🐛 Bug 修复

- 修复首页发名片按钮点击后跳转到预览页的问题
- 修复事件冒泡阻止失效问题

### 🔧 技术改进

- 使用 `catchtap` 替代 `bindtap` + `catchtap` 组合，简化事件绑定
- 异步预生成分享卡片，不阻塞用户操作
- 移除冗余的分享选项弹窗逻辑

### 📱 用户体验

- 分享流程从多步骤简化为一步完成
- 点击发名片按钮直接唤起微信分享菜单
- 保持与详情页一致的交互体验

### 📋 变更文件

| 文件 | 变更类型 |
|------|----------|
| `miniprogram/pages/index/index.wxml` | 修改 |
| `miniprogram/pages/index/index.js` | 修改 |
| `miniprogram/pages/index/index.wxss` | 修改 |
| `CHANGELOG.md` | 更新 |

---

## v1.0.6 (2026-06-11)

### 🐛 Bug 修复

- 修复 `edit/index.js` 重复函数定义导致删除附件功能崩溃
- 修复 L2 访客身份识别失效问题（添加 `openid` 字段）

### 🔧 技术改进

- 删除未使用的 `getQrCode` 死代码云函数
- 完善 `initVisits` 参数校验，防止权限绕过
- 添加 `getQrCode` path 参数格式校验

### 📋 变更文件

| 文件 | 变更类型 |
|------|----------|
| `miniprogram/pages/edit/index.js` | 修改 |
| `cloudfunctions/getQrCode/` | 删除 |
| `cloudfunctions/initVisits/index.js` | 修改 |

---

## v1.0.0 (2026-06-01)

### ✨ 初始发布

**核心功能**
- 名片创建与编辑
- 头像裁切功能
- 名片预览与分享
- Canvas 分享卡片生成
- 名片收藏功能
- 访客记录追踪（三级身份识别）
- 完整隐私授权流程

**技术特性**
- 微信云开发架构
- JWT OpenID 身份验证
- 云存储安全访问控制
- 匿名访客保护机制