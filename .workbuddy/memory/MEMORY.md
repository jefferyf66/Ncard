# Ncard 项目记忆

## 设计系统
- **品牌色**：#3B82F6（主色）、#2563EB（深色/hover）
- **危险色**：#EF4444
- **成功色**：#10B981
- **设计方向**：Hybrid（B 钴蓝基座 × D 编辑字体钮形 × C 暖调渐变）
- **关键特征**：Georgia 衬线标题、4rpx 锐角、175° 暖调背景渐变、左侧品牌蓝装饰条

## 技术栈
- 微信小程序原生 + 微信云开发（DYNAMIC_CURRENT_ENV）
- 云数据库集合：cards（名片）、visits（访客记录）、user_save_cards（用户保存的名片关联）、visitor_profiles（访客授权身份）
- 云函数：getOpenId、getQrCode、initVisits（含三级访客身份识别 enrichment）、deleteCard（级联删除）、resolveCloudUrls（cloud:// → HTTPS URL 安全代理）
- 云存储路径：avatars/（头像）、attachments/（附件）、qrcodes/（小程序码）
- 云存储权限：推荐「仅创建者可读写」— 跨用户头像访问通过 resolveCloudUrls 云函数代理
- 已移除：scan 页面、crop 页面、parseCard 云函数、test 页面（无扫描名片需求，测试页不上线）

## 版本发布约定
- 打 tag 时**必须同时更新** `RELEASE_NOTES.md` 和 `README.md`（版本历史 + 功能特性同步）
- app.json 不注册测试页面（pages/test/index、pages/crop/index）
- app.json 不声明未使用的 permission（scope.camera、scope.writePhotosAlbum）

## 分享卡片模块（v8 Banner 触顶 + 间隙居中 + 5:4 导出）
- **文件**：`miniprogram/utils/shareCard.js`、`miniprogram/config/cardStyle.js`
- **画布**：内容区填充整个 Canvas 宽度，经 `fitToBubbleSize()` 等比缩放至 600×480 气泡上限
- **导出**：精确 5:4 = width × 4/5（微信分享图显示规范），`canvasToTempFilePath` 导出 600×480 PNG
- **布局**：Banner 锚定 y=0（CTA 触顶）→ 透明间隙（header-content 呼吸间距）→ 名片卡片 → 底部透明留白
- **布局**：`computeLayout(w, h)` 计算所有坐标/字号 — Banner(80rpx) + 头像 + 姓名/职位 + 分割线 + 公司 + 联系方式
- **布局**：顶部浅蓝 Banner「点击保存我的名片」+ 左侧圆角头像 + 右侧姓名/职位 + 分割线 + 公司 + 联系方式
- **对外 API**：`generate(canvasId, card, options)` → `{tempFilePath}`、`getCurrentDimensions()`、`refreshLayout()`
- **缓存**：按 `cardKey_宽x高_联系方式数c_v{数据版本}` 版本化缓存
- **头像降级链**：`resolveCloudUrls(管理员)` → `getTempFileURL(同用户)` → `downloadFile→base64(云函数代理)` → 占位符
- **Canvas 序列化锁**：`_canvasLock` Promise 链，确保多卡片共用 `#shareCanvas` 时排队生成，防止状态竞争
- **云端配置**：云数据库 `config` 集合 → `{ _key: "shareCardDimensions", width, height }` → 首次读取后内存缓存
- **阴影处理**：不预留留白空间，自然溢出被 Canvas 边界裁切（32rpx/8%透明度阴影裁切不可见）

## 页面结构
- `pages/index/index` — 首页（仅显示自己创建的名片 + 访客统计 + 官方隐私弹窗）
- `pages/edit/index` — 名片编辑/创建
- `pages/preview/index` — 名片详情预览（智能操作：自有→编辑/删除，他人→保存/已保存）
- `pages/visitors/index` — 访客记录
- `pages/agreement/index` — 隐私政策 / 服务协议
- `pages/list/index` — 名片夹列表（仅显示他人分享且已保存的名片，点击跳转预览）
- `pages/profile/index` — 个人中心

## 关键配置
- `app.json`: `"navigationBarBackgroundColor": "#3B82F6"` + `"__usePrivacyCheck__": true`
- 头像上传：`wx.authorize('scope.camera')` → `wx.chooseImage` → `wx.chooseMedia`（三级降级）

## 已知修复记录
- 2026-06-11：名片分享保存逻辑优化
  - 新增 `user_save_cards` 集合（cardId + cardOwnerOpenId + savedAt）
  - `app.js` 新增 `getOpenId()` 缓存方法
  - 首页过滤只显示自己创建的名片（`where({ _openid: myOpenId })`）
  - 预览页智能按钮：自有名片→编辑+删除，他人名片→保存/已保存（查 user_save_cards）
  - 名片夹改为从 user_save_cards 查询已保存的他人名片（`_.in(cardIds)`）
  - 名片夹卡片点击统一改为跳转预览页（而非编辑页）
- 2026-06-11：匿名访客追踪系统（A组P0修复 + B组身份识别）
  - **P0 Bug修复**：recordVisit openid 解析改用 `app.getOpenId()`、名片数 count 添加 `_openid` 过滤、降级路径添加 cardOwnerId、访客页 cardOwnerId 传参修正
  - **三级访客体系**：L3 卡片用户（真名+头像）→ L2 已授权（微信昵称+头像）→ L1 匿名（"访客 #XXXX"）
  - **云函数 enrichment**：`initVisits recordVisit` 自动查 cards(L3) → visitor_profiles(L2) → 写入 visitorName/visitorAvatar/visitorLevel 等 6 字段
  - **前端授权引导**：非阻断式底部通知条（`.auth-banner`）+ 当天冷却期（同日不重复）
  - **客户端聚合**：`_aggregateVisitors()` 按 visitorOpenId 归并 + `_formatVisitorItem()` 三级分层展示
  - **新建集合**：`visitor_profiles`（`_openid`/`nickname`/`avatarUrl`/时间戳）— 需用户在云控制台手动创建
  - **待部署**：`initVisits` 云函数需重新部署到云端
- 2026-06-11：云开发数据集合全面审计
  - **发现**：`scans` 集合 0 代码引用（parseCard 已删除），README + DEPLOYMENT-GUIDE 残存 5 处引用
  - **发现**：`users` 集合仅在 DEPLOYMENT-GUIDE 提及，代码 0 引用，功能已被 L2/L3 替代
  - **发现**：`settings` 集合全项目零引用，从未存在，无需操作
  - **确认**：5 个活跃集合（cards/visits/user_save_cards/visitor_profiles）职责清晰，无合并需求
  - **待办**：云控制台删 scans 集合 + 清理 3 文档中过时引用
- 2026-06-11：云存储安全代理实施
  - **新增**：`resolveCloudUrls` 云函数 — 以管理员身份将 cloud:// fileID 转为临时 HTTPS URL
  - **修改**：`app.js:resolveCloudFileIDs()` — 从客户端 `wx.cloud.getTempFileURL` 改为调用 `resolveCloudUrls` 云函数
  - **效果**：云存储可收紧为「仅创建者可读写」，被分享者通过云函数代理正常查看头像
  - **缓存**：云函数内置 `urlCache`，同一 fileID 115 分钟内复用
  - **上线**：需部署 `resolveCloudUrls` 云函数 + 控制台收紧存储权限
- 2026-06-10：全面修复 43 个审计问题（Critical 3/Major 4/Minor 4）
  - app.json 注册 list + profile 页面、删除 orphan detail
  - edit 页 6 个 togglePublic 开关传参修复（data-field）
  - edit 页头像隐私授权完整流程（_ensurePrivacyAuth → _openImagePicker）
  - profile 页 wx.getUserProfile → wx.getUserInfo
  - app.wxss 移除 transition 属性
  - 访客统计 viewed/newCards 真实查询 / 按钮冒泡修复（catchtap）
  - project.config.json 清理模板残留
- 2026-06-15：访客追踪系统两期优化
  - **第一期（隐私联动）**：隐私同意后静默注册 openid 到 visitor_profiles（`_registerVisitorProfile`）、auth-banner 去 3 秒延迟 + 冷却期从 7 天改为当天（date 字符串比较）、删除 profile 页 `getUserInfo` 死代码
  - **第二期（身份联动）**：创建名片后同步 visitor_profiles → L3 升级（`_syncVisitorProfile`）、initVisits 新增 `getMyVisitorDashboard` 合并三路查询（`Promise.all`），首页从两次独立调用改为单次 dashboard 调用

- 2026-06-16：官方隐私弹窗切换（方案v4实施）
  - **切换**：从自定义隐私弹窗（Option A）→ 官方隐私弹窗（Option B）
  - **app.js**：删除 `_privacyResolve` + `initPrivacy()` + `onNeedPrivacyAuthorization` 监听；新增 `showPrivacyError(err)` 识别 errCode 103/104
  - **index**：删除 `checkPrivacySetting/handlePrivacyAgree/handlePrivacyDecline/preventTouchMove` 四个方法；`openPrivacyPolicy` → `wx.openPrivacyContract({})`；`_registerVisitorProfile()` 改为在 `onShow` 触发
  - **index.wxml/wxss**：删除自定义隐私弹窗区块和10个样式块
  - **edit**：2处 `chooseImage` fail 增加隐私错误识别
  - **preview**：5处 `setClipboardData` 增加 fail 回调（handlePhone/Email/Address/openWechatOfficial/openCompanyWebsite）
  - **行为**：用户首次调用云开发API时微信自动弹出官方弹窗；拒绝后隐私API返回 errCode 103/104，`showPrivacyError` 统一提示

## 发布前待办
- [x] 在 `app.json` 中启用 `"__usePrivacyCheck__": true`
- [ ] MP 后台配置隐私保护指引（勾选「收集你选中的照片或视频文件」+「获取你的相机权限」）
- [ ] 提交微信审核 → 审核通过后发布（隐私指引随版本一同生效）
- [ ] 部署全部 5 个云函数到生产环境（getOpenId/getQrCode/initVisits/deleteCard/resolveCloudUrls）
- [ ] 云开发控制台 → 存储权限 → 改为「仅创建者可读写」
- [ ] 删除云存储中的孤儿目录（avatar/、avartar/、scans/、cards/）

## 已知数据问题
审计日期 2026-06-11，P0 全部已修复，详见 `artifacts/data-audit-report.md`。

**仍然保留的低优项**：
- P1#5：cards 无唯一性校验（业务决策：允许同名同公司名片）
- P1#7：saveCard update 全量替换（当前所有字段显式赋值，暂无风险）
- P2#10：无乐观锁（暂无多设备并发编辑场景）
