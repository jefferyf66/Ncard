# 更新日志

本文件格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [1.5.5] - 2026-09-01

### Added
- **云存储对账与清理工具（仅 root）**：`adminManager` 新增 `storageAudit`（列 avatars/+sharecards/ 全量文件与 DB 引用集对账，输出孤儿/悬空引用清单，只报告不删）与 `storagePurge`（dryRun 默认 true 预览，`execute:true` 才删；**每次调用现算现复核**只删当下孤儿，断点重跑安全；分批 20/次）；对账计算抽成共享 `computeStorageRecon()`，全程写 `admin_audit_log`
- **cards 新增冗余字段 `shareImageFileID`**（cloud:// 原始 fileID）：index/edit 两个分享图上传点同步落库，为删除提供可靠依据

### Fixed
- **删卡分享图永久孤儿（P0 泄漏）**：`deleteCard` 级联删除分享图——优先取 `shareImageFileID`，HTTPS `shareImageUrl` 反解路径，外加确定式兜底 `sharecards/card_<id>.jpg`
- **「我的」页换头像永不删旧**：删除逻辑收拢到 `accountManager.updateMyProfile`（服务端，写库成功后删旧，删前查 cards/users/visitor_profiles 引用安全）；edit/account 两入口自动对齐
- **「先删后存」悬空引用竞态**：edit 页删旧头像从上传回调挪到 `saveCard` 写库成功后（`_savedAvatar` 基线），消除选完头像取消导致 DB 头像 404 的正确性 bug

### Removed
- **首轮存量清理（运维）**：经 `storageAudit` 对账 + 人工确认后 `storagePurge` 删除 70/70 孤儿文件（avatars 11→4、sharecards 66→3，约 4MB），零误删，审计日志可溯

> 本次 `accountManager` / `deleteCard` / `adminManager` 三个云函数须**重新上传部署**（adminManager 每次都要勾「云端安装依赖」，且函数超时已调 60s）；前端改动热重载即可。`qrcodes/` 目录同类问题未治理，后续可用对账框架覆盖。

## [1.5.4] - 2026-09-01

### Added
- **首页名片句柄拖拽排序**：首页「我的名片」每张卡片右侧新增 ≡ 拖拽句柄，按住即可手动调整名片排列顺序；松手自动持久化（每张卡写 `order` 整数，复用「仅创建者可读写」权限 owner 直连 `update`，**无新增云函数**）。新卡不写 `order`、未手动排序时按创建时间倒序（最新最上），手动排序后新建卡自然追加到末尾
- **编辑页字段可见性三态开关（UI 落地）**：废弃 `publicSettings` 开关，姓名/职位/公司/电话/邮箱每段改为 `fieldVisibility` 三档图标（公开蓝地球 / 授权后绿眼睛 / 仅自己灰锁，纯 SVG 矢量零渲染差异），点击循环切换并弹气泡提示当前态含义；`loadCard` 兼容旧数据（`publicSettings.showXxx=false` → `fieldVisibility.X='private'`）
- **删除二次确认**：编辑页删除附件 / 删除过往经历新增 `wx.showModal` 二次确认，防误触

### Changed
- **必填项收敛**：仅 姓名 / 电话 / 邮箱 为必填且做格式校验，公司 / 职位等组织字段改为选填（部分团队用户并非公司职员）
- **配置一致性收敛**：`saveCard` 不再写入废弃的 `publicSettings`，服务端只认 `fieldVisibility` 物理过滤 cards；对外页 `preview` 各区块展示条件移除 `publicSettings` 判断，改为依赖服务端 `getCardView` 已过滤的字段直接 `wx:if`
- **邮箱栏遮挡修复**：编辑页邮箱输入区样式修正（去 min-height 裁切 + 长文本贴图标问题）

> 本次为**纯前端改动**（edit / preview / index 页），开发者工具热重载即可生效，**无需部署云函数**。

## [1.5.3] - 2026-08-28

### Added
- **后台「未命名」用户批量归档（仅 root）**：`adminManager` 新增 `batchArchiveUnnamed` action；查询 `nickname='' AND status='active'` 的活跃普通用户（自动排除 admin/root 角色与操作者本人），默认 `dryRun=true` 仅返回候选清单不动库，显式传 `dryRun=false` 才真归档（`status='deleted'` + 单条 `admin_audit_log`），并回报 `archived/total/failed` 计数；管理员可据此一键清理历史测试/小号噪声账号
- **启动昵称补全软引导**：`app.js` 在 `ensureUser` 成功后检测——仅当 `nickname` 为空且 `status='active'` 且角色非 admin/root 且当前不处于账号设置页时，延迟跳 `account` 页并提示「请先完善昵称」；已有昵称用户（含 root 本人）绝不打扰，根治"未来新用户空昵称不提示"的增量问题

### Changed
- 编辑页 `wechatOfficial` 精简为 `{name, qrcode}`（移除 `url`/`desc` 冗余配置项）；`companyWebsite` 移除 `desc` 字段；对外页公众号无二维码时由"复制链接"降级为提示"请上传公众号二维码"（A+B 配置精简，并入本版打 tag）

> 本次 `adminManager` 云函数改动须**重新上传部署**方生效；`app.js` 前端改动开发者工具热重载即可。批量归档为不可逆操作，执行前务必先以 `dryRun=true` 审阅候选清单。

## [1.5.2] - 2026-08-27

### Added
- **名片公众号二维码展示与关注**：`wechatOfficial` 字段新增 `qrcode`（cloud:// 图片，存于云存储 `qrcodes/`）；编辑页新增二维码上传控件（`onChooseOfficialQR` 选图→上传→持久化）；对外页 `preview` 点击公众号卡片弹出二维码弹窗（`<image show-menu-by-longpress>` 支持收卡人**长按识别关注**，合规跨主体、聊转分享均可用）；无二维码时降级为复制链接
- **编辑页获取指引**：公众号二维码上传框下方新增面向名片主人的获取文案（"微信中打开你的公众号 → 右上角··· → 更多信息 → 公众号二维码 → 长按保存图片，回到此处上传即可"），消除"不知去哪拿二维码"卡点

### Changed
- 对外页公众号卡片展示条件放宽（有 `url` 或 `qrcode` 即显示）；`openWechatOfficial` 由"复制链接"升级为"有二维码优先弹窗、否则降级复制"

## [1.5.1] - 2026-08-26

### Added
- **访客身份读时解析（方案 A）**：`initVisits` 新增 `resolveVisitorIdentities(openids)` 助手，按 distinct `visitorOpenId` 批量查 `cards`（L3 名片用户）+ `visitor_profiles`（L2 授权用户），取最新公开展示身份（name/avatar/position/company/level）覆盖回传；`getRecentVisitors` 与 `getMyVisitorDashboard` 读取时实时覆盖访客快照——根治「访客后来建卡/被授权，名片主人访客列表仍显示旧用户名/头像」的 staleness（L3 优先不降级、覆盖兜底旧值、level 只升不降）

### Fixed
- **访客电话泄露（SEC-03）**：原 `getRecentVisitors` / `getMyVisitorDashboard` 把 `visits.visitorPhone`（访客私密电话）原样回传给名片主人；现读取侧对每个 visit **无条件** `delete v.visitorPhone`，且 L2/L3 覆盖只取公开展示字段，绝不下发 phone/email
- **「我的」页 / 账号设置页头像不显示**：两页此前把 `cloud://` 经 `resolveCloudUrl` 转 `https` 渲染，而本项目 https CDN 不可靠（同历史「分享预览图收不到」根），故选完微信头像也不显示；改为与编辑页一致直接渲染 `cloud://` 原生，并选头像时**立即回显**临时头像确保「选完即见」，上传 `cloud://` fileID 入库，加 `_pendingUpload` 异步竞态防护（选完立即保存不丢上传）

> 本次 `initVisits` 云函数改动须**重新上传部署**方生效；`account` / `profile` 前端改动开发者工具热重载即可。

## [1.5.0] - 2026-08-26

### Added
- **访客授权披露（D5 安全模型）**：`cards` 新增 `fieldVisibility`（public/authorized/private 三级）；新增 `initVisits.getCardView`（服务端按 fieldVisibility 过滤下发，越权读卡彻底封堵）+ `authorizeVisit`（访客授权后标记 `visits.authorized` 并回传授权字段）；`edit` 页新增电话/邮箱/地址三态可见性选择器（公开/授权后/仅自己）；`preview` 页读取改走 `getCardView`，未授权访客展示授权引导弹窗与锁定占位区；前端共享 `config/cardVisibility.js` 与云函数 `visibility.js` 双端常量保持一致
- **名片夹改走云函数读卡（SEC-00 配套）**：`initVisits` 新增 `getCardsBatch`，`list` 页经其 admin 读取他人名片（按 fieldVisibility 只下发公开字段），使 `cards` 集合可安全收紧为「仅创建者可读写」而名片夹不再空白——彻底消除历史「分享后看不到」坑

### Fixed
- **访客全字段泄露**：原 preview 对访客直连 `cards` 可读完整名片（含私密电话/邮箱），D5 改服务端 `getCardView` 强制过滤后该漏洞关闭
- **名片夹权限耦合**：移除 `list` 页前端直读 `cards` 集合的残留代码

> 本次 `initVisits` 云函数改动较大（新增 `getCardView` / `authorizeVisit` / `getCardsBatch` + `visibility.js`），改完须**重新上传部署**方生效；`edit` / `preview` / `list` 前端改动开发者工具热重载即可。另：`cards` 等集合权限建议在云开发控制台核验为「仅创建者可读写」（详见审计 `artifacts/security-audit-8dim-2026-08-26.md` 的 SEC-00）。

## [1.4.3] - 2026-08-26

### Added
- **访客来源按名片区分**：`initVisits.recordVisit` 在取整卡处顺手存 `cardName`；访客页 `description` 升级为「查看了您的「XX名片」」并渲染为可点击链接，跳该卡详情页（`/pages/preview/index?id=`）；全局访客视图下不同访客归属哪张名片一目了然，单卡视图（`?cardId=`）下不渲染链接避免自跳转；旧记录无 `cardName` 显示兜底文案

### Fixed
- **访客头像渲染失败**：`visitors` / `preview` 访客列表的 `visitorAvatar` 为裸 `cloud://` 串，未过 `storage.resolveCloudUrl()` 转 HTTPS，渲染层报 "Failed to load image"。两页补 `resolveCloudUrl` 转换

> 本次 `initVisits` 云函数有改动，改完须重新上传部署方生效；`visitors` / `preview` 前端改动开发者工具热重载即可。

## [1.4.2] - 2026-08-26

### Fixed
- **批量删除超 1000 条上限残留（LOG-02）**：`teamManager.disbandTeam` 与 `deleteCard` 的级联删除改用分页循环（`limit(1000)` 删至 `removed===0`），防止超大团队（>1000 人）或超热名片（被保存 >1000 次）残留记录导致计数/展示错误
- **注销账号数据残留（ERR-02）**：`accountManager.confirmDeleteAccount` 级联清理 `team_members`（并回退 `teams.memberCount`）+ `visits`（含 `visitorOpenId` 与 `cardOwnerId` 双向彻底抹除本人标识），满足"注销即清理"的隐私合规预期
- **名片→团队归属图谱泄露（SEC-01）**：`teamManager.getCardTeams` 复用 `getCardsTeams` 的 `isMember/isPublic` 可见性判定，私有团队且调用者非成员时剔除，防止通过 cardId 枚举探测某人团队关系
- **单用邀请码并发竞态（CON-01）**：`teamManager.joinByInvite` 的 `usedCount` 自增改为原子条件更新（`where({_id, usedCount:0, singleUse:true})`），未命中即回滚并拒绝，防止限量邀请被并发绕过
- **运营后台团队人数恒为 0（LOG-01）**：`adminManager.listTeams` 修正为读取 `t.memberCount` 数字字段（原误读不存在的 `t.members` 数组）

> 本次修复均位于云函数侧，改完须重新上传部署 `teamManager` / `deleteCard` / `accountManager` / `adminManager` 方生效。

## [1.4.1] - 2026-08-24

### Fixed
- **「我的」页指标卡接真数据**：名片数改为 `cards` 按 `_openid` count、访客数接入 `initVisits.getMyVisitorStats`（与访客页同口径），修复原本恒为 0 的死数字；「我的名片」点击改跳首页（我的名片展示页），消除"数字=我创建的、跳转=收藏夹"语义错位
- **「我的」页半成品功能清理**：移除「主题颜色」「默认名片」两个只存不用的设置项（`themeColor`/`isDefault` 全局无消费方），连同弹层与样式一并删除
- **关于页版本号停更**：`APP_VERSION` 1.1.4 → 1.4.0，修复关于弹窗与页脚显示三个版本前旧号的缺陷
- **账号设置图标空白**：补充缺失的 `.icon-user` 样式（此前图标不渲染）
- **构建配置**：`app.json` 开启 `lazyCodeLoading: requiredComponents` 修复上传代码质量扫描"组件按需注入未通过"；`project.config.json` 关闭增强编译（`enhance:false`）修复 `@babel/runtime/helpers/arrayWithoutHoles` 缺失导致的编译报错

### Changed
- **「我的」页用户卡文案**：「已绑定账号..openid后6位」→「已登录」（小程序为静默登录，无绑定动作，openid 片段对用户无意义）

## [1.4.0] - 2026-08-24

### Added
- **用户管理模块（方案A）**：自助账号体系（`accountManager` 云函数）+ 运营后台（`adminManager` 云函数），含 root 角色晋升与权限管控
- **自定义 tabBar 导航重构（方案C）**：名片 / 名片夹 / 团队 / 我的 四域一级导航 + 中央品牌蓝凸起「＋」按钮（创建名片 / 创建团队 / 加入团队动作菜单）
- **名片夹团队名片区分**：后端 `getCardsTeams` 批量归属查询（公开团队 / 成员可见，私密非成员隔离）；前端视觉三要素（左侧品牌蓝条 + 头像蓝描边 + 团队胶囊徽章 / 来源行）+ 全部 / 个人 / 团队分段筛选 + 点击团队卡进团队视图
- **团队空名片邀请流**：owner 配置团队名片字段（`teams.cardSchema`）→ 邀请成员填空表单（预填回显 + 必填校验）→ 直接 active 加入

### Changed
- **产品统一更名**：科博名片 → 投贴儿（导航标题 / 协议页 / 关于页 / 转发备注；`team/create` 占位示例同步）
- **团队数据层**：`managedFields` 统一命名为 `company/department/position/phone/address/website`，与个名片 `card` 字段对齐
- **团队能力增强**：公开团队目录、整组分享、owner 解散团队（级联清理成员 / 名片关联 / 邀请码）接入

### Fixed
- 登录链路 2 项 P1 缺陷修复
- 安全 / 逻辑 / 数据完整性审计修复（越权 + 信息泄露等，需重新部署 `initVisits` / `teamManager` / `deleteCard` 方生效）
- 清理全库 6 项 LOW 级技术债务
- `team/detail` 分享文案「分享空名片」→「邀请成员填写名片」

## [1.3.0] - 2026-08-19

### Added
- 访客数据 per-card 化：`initVisits` 的 `getMyVisitorStats` / `getRecentVisitors` / `getMyVisitorDashboard` 三聚合 action 新增可选 `cardId` 维度（缺省保持全局聚合，向后兼容）
- 名片详情页新增「访客分析」区（仅名片主人可见）：本名片访客数 / 重复访问 / 最近访客 Top5，「查看全部」跳访客页单卡筛选
- 访客页支持 `?cardId=` 单卡筛选；单卡模式头部自适应「本名片访客」+ 卡片名，第三指标切换为「最近访客」，并提供「全部名片 ›」回全局
- 团队能力增强：公开团队目录、整组分享、团队详情点成员查看其在本团队下的托管名片、owner 专属解散团队（级联清理成员 / 名片关联 / 邀请码）
- 首页「添加到桌面」实现优化

### Changed
- 首页 UI 对齐设计系统（对齐 / 错误态 / 统计语义修复）
- 首页头部重排：我的团队左移并带实时团队数，添加到桌面归位右上
- 首页团队入口移出头部，改置底部固定双按钮栏（方案C）

### Removed
- 首页「名片数据」三宫格（我的访客 / 多次来访 / 名片夹）与「最近访客」列表整块移除（访问数据改为随具体名片走，归位于详情页 per-card 维度）
- 首页 4 个纯 CSS 图标死代码样式（icon-users / icon-eye / icon-add / icon-user）

## [1.2.0] - 2026-08-17

### Fixed
- 修复 `edit` 页 `page-content` 闭合标签缺失导致的 WXML 编译错误

## [1.1.4] - 2026-08-14

### Added
- 团队租户功能设计方案 v0.4（`artifacts/team-tenant-design.md`，D1–D12 已确认：多团队、组织字段覆盖层、邀请码+分享卡片、创建查重四层机制）
- 微信 openid 快速登录机制设计方案 v0.2（`artifacts/user-login-design.md`，已对照官方文档核验：免 `wx.login`、`getUserProfile` 失效改 `chooseAvatar`+`nickname`）
- 统一详细实施方案 `artifacts/implementation-plan-v2.md`

### Changed
- 新增 `miniprogram/config/storage.js` 作为云存储 HTTPS 基址唯一真源，移除 `app.js` / `shareCard.js` / `edit/index.js` / `index/index.js` 共 5 处硬编码 `636c-cloudbase-...`
- `miniprogram/pages/profile/index.js` 关于弹窗版本号改为读取 `app.globalData.version`（单一真源）
- 替换 `crop` / `shareCard` / `index` 三处弃用 `wx.getSystemInfoSync()` 为官方推荐 `getWindowInfo` / `getDeviceInfo` / `getAppBaseInfo`

### Chore
- `.gitignore` 新增 `.workbuddy/` 规则，取消跟踪内部产物（memory / cache / screenshots / artifacts），不再进版本库

## [1.1.3] - 2026-06-18

### Fixed
- **分享气泡卡片接收方不可见**：根因为 MP 后台「分享安全校验」开关导致服务端验签失败。关闭开关即解决。
  
### Changed
- `pages/edit/index.js`: `saveCard` 改为 Promise 链等待分享图生成；新增 `_generateAndStoreShareImage`（15s 超时 + `.jpg` 上传 + HTTPS CDN URL 存储）
- `pages/index/index.js`: `onShareAppMessage(options)` 利用 `options.target.dataset` 获取卡片 ID；三层降级（预存图→实时生成→头像）；`cloud://`自动转 HTTPS；同步返回
- `utils/shareCard.js`: `fileType: 'jpg'` + `quality: 0.7`（控制 <128KB）
- `app.js`: `resolveCloudFileIDs` 简化为直接拼接 HTTPS URL
- `wx.showShareMenu`: 移除 `withShareTicket` 参数

### Removed
- `cloudfunctions/resolveCloudUrls/` — 云函数不再需要
- `miniprogram/config/cardStyle.test.js` — 测试文件

## [1.1.2] - 2026-06-18

### Fixed
- 分享气泡卡片接收方不可见（6 轮代码迭代：时序竞态 + cloud:// 跨设备 + 扩展名格式 + downloadFile 域名 + 缓存 busting）

## [1.1.1] - 2026-06-17

### Fixed
- `index.wxml` UTF-8 编码损坏导致 WXML 编译 `unexpected end` 错误
- 首页约 20 个缺失 CSS 类补全，纯 CSS 图标实现

### Changed
- 无名片时隐藏右下角新增名片悬浮按钮，空状态提示文案优化
- 恢复 `pages/crop/` 头像裁切页完整功能（movable-area 缩放 + Canvas 400×400 裁切 + 九宫格辅助线）

### Removed
- `wx.addFavorite` 非法 API 调用、`handleVisitorAction` 死代码、`_loadRecentVisitors` 废弃方法

## [1.1.0] - 2026-06-17

### Fixed
- **P0**: 删除无消费场景的 `getQrCode` 云函数
- **P0**: `index.wxml` 重复渲染节点删除
- **P0**: `initVisits`/`deleteCard` 补充 `wx-server-sdk` 依赖
- **P1**: `selectDefaultCard` 改为 `cards.isDefault` 云端持久化 + 本地缓存双写
- **P1**: `profile.loadCardList` 添加 `_openid` 过滤
- **P1**: `DOCUMENTATION.md`/`DEPLOYMENT-GUIDE.md` 过时引用修正

### Changed
- `visitors/index.js` ES5→ES6 全面改写
- `sitemap.json` 隐私页面禁止收录
- `profile/index.js` 主题色切换增加到 `visitor_profiles.themeColor` 云同步

### Removed
- 首页/访客页空壳操作按钮

## [1.0.9] - 2026-06-16

### Added
- 分享卡片 Canvas 生成器 v8：精确 5:4 比例（600×480），Banner 触顶 + 间隙居中布局
- Canvas 序列化锁（`_canvasLock`）防止多卡片并发生成竞态
- 编辑页保存后 `cardsNeedRefresh` 联动首页刷新
- `cardStyle.js` 统一样式数据源

### Fixed
- 分享卡片右侧截断（非 5:4 被微信裁剪）
- 多卡片并发生成时第二张名片头像降级
- 编辑后首页/预览页数据不刷新

## [1.0.8] - 2026-06-16

### Added
- 三级匿名访客身份识别（L1 注册→L2 授权→L3 卡片用户）
- `getMyVisitorDashboard` 云函数合并三路查询
- 非阻断式授权引导条（当天冷却期）

### Changed
- 自定义隐私弹窗 → 微信官方隐私弹窗（`__usePrivacyCheck__: true`）
- 云函数增加 `downloadFile`→base64 降级路径修复跨用户头像访问
- 首页发名片按钮使用微信原生 `open-type="share"`，异步预生成分享卡片

### Fixed
- 云存储「仅创建者可读写」时跨用户头像 `STORAGE_EXCEED_AUTHORITY`
- 首页发名片按钮点击后跳转到预览页
- 事件冒泡阻止失效

## [1.0.7] - 2026-06-13

### Added
- 首页名片列表使用 Canvas 渲染预览

### Fixed
- 优化 Canvas 渲染，修复 5 个问题
- 更新 release 工作流配置（GitHub Actions 权限配置）

## [1.0.6] - 2026-06-13

### Added
- 首个正式标签版本：完善项目配置，接入 visitors 页面至 app.json

### Fixed
- 修复代码质量扫描问题
- 修复 edit/index 页面 wxml 编码与中文乱码、变量名问题
- 修复首页加载逻辑（去除 openid 过滤），恢复原始中文 UI 文件

## [1.0.0] - 2026-06-01

### Added
- 初始发布：名片 CRUD、OCR 扫描、名片预览、访客记录、数据概览、个人中心
- 品牌蓝设计系统（#3B82F6 主色 + 编辑器字体钮形 + 暖调渐变背景）
- 底部 TabBar 三页导航
