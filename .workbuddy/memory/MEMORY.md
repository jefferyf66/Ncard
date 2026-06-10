# Ncard 项目记忆

## 设计系统
- **品牌色**：#3B82F6（主色）、#2563EB（深色/hover）
- **危险色**：#EF4444
- **成功色**：#10B981
- **设计方向**：Hybrid（B 钴蓝基座 × D 编辑字体钮形 × C 暖调渐变）
- **关键特征**：Georgia 衬线标题、4rpx 锐角、175° 暖调背景渐变、左侧品牌蓝装饰条

## 技术栈
- 微信小程序原生 + 微信云开发（DYNAMIC_CURRENT_ENV）
- 云数据库集合：cards（名片）、visits（访客记录）
- 云函数：getOpenId、getQrCode
- 已移除：scan 页面、crop 页面、parseCard 云函数（无扫描名片需求）

## 页面结构
- `pages/index/index` — 首页（名片列表 + 访客统计 + 隐私弹窗）
- `pages/edit/index` — 名片编辑/创建
- `pages/preview/index` — 名片详情预览
- `pages/visitors/index` — 访客记录
- `pages/agreement/index` — 隐私政策 / 服务协议
- `pages/list/index` — 名片夹列表
- `pages/profile/index` — 个人中心

## 关键配置
- `app.json`: `"navigationBarBackgroundColor": "#3B82F6"`
- **开发环境**：`__usePrivacyCheck__` 已移除，使用老式权限系统（wx.authorize + 原生弹窗）
- **发布前**：恢复 `"__usePrivacyCheck__": true` + MP 后台配置隐私指引 + 提交审核
- 头像上传：`wx.authorize('scope.camera')` → `wx.chooseImage` → `wx.chooseMedia`（三级降级）

## 已知修复记录
- 2026-06-10：删除扫描名片功能（scan/crop/parseCard，11 文件）
- 2026-06-10：全面修复 43 个审计问题（Critical 3/Major 4/Minor 4）
  - app.json 注册 list + profile 页面、删除 orphan detail
  - edit 页 6 个 togglePublic 开关传参修复（data-field）
  - edit 页头像隐私授权完整流程（_ensurePrivacyAuth → _openImagePicker）
  - profile 页 wx.getUserProfile → wx.getUserInfo
  - app.wxss 移除 transition 属性
  - 访客统计 viewed/newCards 真实查询 / 按钮冒泡修复（catchtap）
  - project.config.json 清理模板残留

## 发布前待办
- [ ] 在 `app.json` 中恢复 `"__usePrivacyCheck__": true`
- [ ] MP 后台配置隐私保护指引（勾选「收集你选中的照片或视频文件」+「获取你的相机权限」）
- [ ] 提交微信审核 → 审核通过后发布（隐私指引随版本一同生效）
- [ ] 云函数部署到生产环境
