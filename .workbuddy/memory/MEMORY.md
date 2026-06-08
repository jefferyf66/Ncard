# Ncard 项目记忆

## 设计系统
- **品牌色**：#3B82F6（主色）、#2563EB（深色/hover）
- **危险色**：#EF4444
- **成功色**：#10B981
- **设计方向**：Hybrid（B 钴蓝基座 × D 编辑字体钮形 × C 暖调渐变）
- **关键特征**：Georgia 衬线标题、4rpx 锐角、175° 暖调背景渐变、左侧品牌蓝装饰条

## 技术栈
- 微信小程序原生 + 微信云开发（DYNAMIC_CURRENT_ENV）
- 云数据库集合：cards（名片）、visits（访客记录）、scans（扫描记录）
- 云函数：getOpenId、getQrCode、parseCard

## 关键配置
- `app.json`: `"navigationBarBackgroundColor": "#3B82F6"`, `"__usePrivacyCheck__": true`
- 头像上传需先过 `_ensurePrivacyAuth()` 隐私授权

## 发布前待办
- [ ] MP 后台配置隐私保护指引（相册 + 摄像头权限）
- [ ] 云函数部署到生产环境
- [ ] 提交微信审核
