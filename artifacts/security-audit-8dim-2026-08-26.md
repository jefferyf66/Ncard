# Ncard 小程序八维安全审计报告

- 审计对象：`D:\极空间双向\#个人\我的代码\Ncard`（AppID `wxd15d78bd1a5b75ef`）
- 审计范围：`cloudfunctions/`（7 个云函数全部 JS）+ `miniprogram/`（23 个 JS 全部 + 关键 WXML edit/preview + config/utils）
- 审计方法：实际 Read/Grep 定位真实行号，逐文件审查，重点复核上轮 5 项 P1 修复与新增「访客授权披露」功能
- 审计日期：2026-08-26

---

## 一、核心结论（先讲最重要）

### 🔴 P0 级风险（需立即在主控台核实，不在仓库内）
- **SEC-00｜数据库集合安全规则未纳入仓库审计**：本项目大量写操作走「前端直写数据库」（edit 保存名片、preview 保存/移除名片、index 静默注册 visitor_profiles、visitors 兜底直查），其鉴权**完全依赖微信云开发控制台配置的集合权限规则**。仓库内看不到这些规则。若 `cards / visits / visitor_profiles / user_save_cards / team_members / teams / team_invites` 任一被误设为「所有用户可读写」，即构成可直接越权删改/拖库的 P0。
  - **触发场景**：攻击者拿到任意客户端即可改写他人 card / 删他人 visit。
  - **修复方向**：在云开发控制台逐一核验以上集合权限 =「仅创建者可读写」（团队相关需管理员上下文），并写进部署清单；前端直写处尽量改为云函数中转以集中鉴权。

> 云函数层（teamManager / adminManager / accountManager / initVisits / deleteCard / getOpenId）均已使用 `cloud.getWXContext().OPENID` 作为唯一可信身份，**未发现任何 `event.openid` 被当作调用者身份的越权点**（已 grep 确认：adminManager 中的 `event.openid` 仅作 admin 操作的「目标」查询键，调用者身份仍取自 OPENID）。无 NoSQL 注入（`where` 全参数化，`db.RegExp` 均已 `escapeRegExp` 转义）。

### ✅ 上轮 5 项 P1 修复复核（无回归）
| 编号 | 项 | 复核结果 | 证据 |
|---|---|---|---|
| LOG-01 | adminManager memberCount | ✅ 已修复 | memberCount 由 teamManager 在 join/leave/remove/disband 全路径用 `_.inc` 维护（teamManager:289/355/373/299-300/125-127），adminManager 仅读取（adminManager:112） |
| LOG-02 | 批量 remove 超 1000 | ✅ 已修复 | `removeAll` 分页循环存在于 teamManager:379、deleteCard:9、accountManager:129/135/141 |
| ERR-02 | 注销残留 | ✅ 已修复（残留 P2 见下） | confirmDeleteAccount 清理 team_members/memberCount/visits/user_save_cards（accountManager:99-149） |
| SEC-01 | getCardTeams 泄露图谱 | ✅ 已修复 | teamManager:681 `if (!isMember && !isPublic) return null`；getCardsTeams:735 `continue` |
| CON-01 | 邀请码并发 | ✅ 已修复（残留 P2 见下） | singleUse 条件更新 + 回滚（teamManager:291-305） |

### ✅ 新增「访客授权披露」功能（getCardView/authorizeVisit/lockedFields/三态开关）逻辑正确性
- 服务端 `filterCardByVisibility`（initVisits:11-26）按 `fieldVisibility` 过滤，**authorized 字段仅在 `isOwner||isAuthorized` 时下发**，private/未授权不下发 —— 实现正确。
- preview WXML 锁区位（preview/index.wxml:60-67）仅展示占位，`card` 中不含 locked 字段值，无值泄露。
- authorizeVisit 仅标记 `visits.authorized=true` 并写 visitor_profiles，无越权读他人卡。
- **但发现 2 个 P1 隐私缺陷**（见 SEC-02、SEC-03）与若干 P2。

---

## 二、问题清单（逐行，带真实行号）

格式：`ID | 文件:行号 | 维度 | 严重度 | 触发场景 | 修复方向`

### P0
- SEC-00 | (云开发控制台，非仓库文件) | 安全漏洞 | P0 | 前端直写 cards/visits/visitor_profiles/user_save_cards 依赖集合权限规则；若规则误配为「所有用户可读写」即可越权删/改/拖库 | 控制台核验 7 个集合均为「仅创建者可读写」；前端直写点尽量改云函数中转

### P1
- SEC-03 | cloudfunctions/initVisits/index.js:105 | 安全漏洞 | P1 | `recordVisit` L3 富集 `visitorPhone = card.phone` 直接拷入 visit 记录，忽略访客本人 card.fieldVisibility（phone 默认 `authorized`）；访客访问任意名片时，其私有手机被透露给该名片主人（`getRecentVisitors` 回传 visitorPhone，preview:280 / visitors:133） | 富集时尊重访客本人 card.fieldVisibility：仅当 phone 在其卡上为 `public` 才写入 visit；或干脆不在 visit 中落 phone
- SEC-02 | cloudfunctions/initVisits/index.js:11-26 + miniprogram/pages/preview/index.wxml:71,91,101,111,134,149 | 安全漏洞/逻辑 | P1 | `filterCardByVisibility` 只认 `fieldVisibility`，完全不读 `publicSettings`；而 owner 在编辑页用 `showPersonalIntro/showBusinessIntro/showExperiences/showAttachments/showWechatOfficial/showCompanyWebsite` 开关「隐藏」章节，这些开关**仅前端渲染层生效**（grep 确认 cloudfunctions 无任何 publicSettings 引用）。直连 `getCardView` 或改包客户端即可拿到 owner 已设「隐藏」的 intro/附件/公众号/网址字段 | 服务端 `filterCardByVisibility` 合并 `publicSettings.showX` 判定（showX===false 则该字段不下发）；或废弃 publicSettings 统一收敛到 fieldVisibility
- CON-02 | cloudfunctions/teamManager/index.js:78-82,142-146,181-185 | 并发与线程安全 | P1 | `genShortId`/`genInviteCode` 用 `Math.random()` + `where().count()` 重试，无唯一索引；两并发创建可都通过 count 校验并插入相同 shortId/code，破坏唯一性不变量，`resolveTeamRef`(teamManager:451-462) 按 `where({shortId}).limit(1)` 返回其一 → 后建团队被错误路由/加入 | 对 teams.shortId、team_invites.code 建唯一索引；或采用更长随机串 + 事务化 upsert；即便并发也靠唯一索引兜底报错
- ERR-04 | miniprogram/pages/list/index.js:47 | 边界与空值 | P1 | `db.collection('user_save_cards').orderBy('savedAt','desc').get()` 无 `.limit`/`skip`；微信云 db `.get()` 默认上限 20（客户端）/100（云函数），用户收藏 >上限张名片时被静默截断，名片夹丢数据 | 加分页/聚合，或 `.where({_openid})` 显式过滤后 `limit(100)` 循环拉全；注意本查询未显式 `_openid` 过滤，仅靠安全规则隔离（见 SEC-00）

### P2
- CON-01r | cloudfunctions/teamManager/index.js:238,304 | 并发与线程安全 | P2 | CON-01 仅修复 singleUse；`maxUses` 非 singleUse 邀请走 `where().count()` 校验(238) + 无条件 `_.inc(1)`(304) 的 check-then-act 竞态，并发加入可令 usedCount 超过 maxUses 多计一次 | 同 singleUse 改为条件更新 `where({_id, usedCount: {< maxUses}})` 自增并校验 updated
- CON-03 | cloudfunctions/teamManager/index.js:68-69 | 并发与线程安全 | P2 | `createTeam` 配额校验 `count()` 后 `add()` 无事务，并发创建可都通过 `total>=5` 判断，突破 `MAX_TEAMS_PER_USER=5` | 用事务/原子计数或唯一约束兜底
- SEC-04 | cloudfunctions/teamManager/index.js:319 | 安全漏洞 | P2 | `listMembers` 向所有团队成员回传原始 team_members 文档（含 `_openid`/`memberOpenId`/`cardId`/`invitedBy`），暴露成员间身份—名片映射 | 仅回传展示所需字段（name/role/status/avatar/托管组织字段），剔除 openid/cardId
- SEC-05 | cloudfunctions/initVisits/index.js:240,272 | 安全漏洞 | P2 | `getRecentVisitors`/`getMyVisitorDashboard` 将原始 visit 文档（含 `visitorOpenId` PII）原样回传 owner | 回传前剥离 visitorOpenId，仅留展示字段
- SEC-06 | cloudfunctions/initVisits/visibility.js:17 | 安全漏洞 | P2 | `attachments` 默认 `public`，匿名访客经 getCardView 即可拿到附件 URL（可能为简历等敏感文件） | 默认改 `authorized` 或至少对附件类型做 owner 可控开关
- SEC-07 | miniprogram/pages/preview/index.js:73 + cloudfunctions/initVisits/index.js:55,64 | 安全漏洞/可维护性 | P2 | 前端 recordVisit 传入 `cardOwnerId`/`visitorOpenId`，服务端忽略并改用 OPENID 重查；死代码且易误导为旧越权点 | 移除前端冗余传参
- ERR-02r | cloudfunctions/accountManager/index.js:99-149 | 错误处理缺失 | P2 | confirmDeleteAccount 删 team_members 但未 pull 对应 `cards.teamIds`，注销用户曾加入的团队在其名片上残留失效 teamId（getCardTeams 因 team 缺失而 skip，无 crash 但数据不一致） | 清理 team_members 前先 collect cardIds 并 `_.pull` 各卡 teamIds
- LOG-01r | cloudfunctions/adminManager/index.js:160-170 vs teamManager/index.js:406-408 | 逻辑错误/可维护性 | P2 | 两处 disbandTeam 逻辑分叉：teamManager 版会 pull 各卡 teamIds(406-408)，adminManager 版漏掉 → 管理员解散团队后成员名片残留失效 teamIds | 收敛为同一实现（建议统一走 teamManager.disbandTeam）
- BND-01 | cloudfunctions/teamManager/index.js:542 | 边界与空值 | P2 | `getTeamPublicDirectory` `team_members.where({status:'active'}).get()` 无 limit，云函数默认上限 100；>100 名成员的公开团队目录被截断 | 分页循环拉全 active 成员
- BND-02 | cloudfunctions/teamManager/index.js:318 | 边界与空值 | P2 | `listMembers` `.get()` 无 limit，大团队成员列表截断于 100 | 分页
- BND-03 | cloudfunctions/adminManager/index.js:98-99 | 边界与空值 | P2 | `getUserDetail` memberOf/owned 用 `.limit(100)`，>100 时截断 | 分页或放宽
- BND-04 | cloudfunctions/teamManager/index.js:609 | 边界与空值 | P2 | `searchTeam` `limit` 直接取自 `event`（无上限校验）；虽 `.limit()` 实际封顶 100，但属未校验入参 | `Math.min(100, parseInt(limit)||10)`
- BND-05 | cloudfunctions/initVisits/index.js:223 | 边界与空值 | P2 | `getRecentVisitors`/`getMyVisitorDashboard` `limit` 取自 event 无上限；`.limit()` 封顶 100 | 加 `Math.min` 校验
- BND-07 | miniprogram/pages/preview/index.js:662 | 边界与空值/资源管理 | P2 | deleteCard 云函数调用失败时兜底 `cards.doc(id).remove()` 客户端直删，未级联清 user_save_cards/visits/team_members/云存储文件，留下孤儿数据与存储冗余 | 移除兜底直删，明确提示「云函数未部署」并要求部署；或兜底也走云函数
- ERR-03 | miniprogram/pages/visitors/index.js:194,200-202 | 错误处理缺失 | P2 | `_loadVisitorsDirect` 兜底路径当 `myOpenId` 为空时 `repeatWhere`/`listQuery` 不加 `cardOwnerId` 过滤，查全量 visits（依赖安全规则隔离，否则越权） | 空 openid 时直接拒绝而非查全量
- MNT-01 | miniprogram/config/storage.js:13 | 可维护性 | P2 | `STORAGE_BASE` 硬编码环境 ID，环境变更需手工改；env 变更后所有解析 URL 静默失效 | 从配置集合/环境变量读取，或加启动自检
- MNT-03 | miniprogram/pages/edit/index.js:418-419 | 可维护性/逻辑 | P2 | saveCard 同时落 `publicSettings` 与 `fieldVisibility` 两套可见性系统，服务端只认后者，造成「隐藏」开关看似有效实则部分失效（见 SEC-02） | 收敛为单一可见性模型
- MNT-05 | 多处 | 可维护性 | P2 | 集合名 `'cards'/'visits'/...` 魔法字符串散落各文件 | 抽取常量模块
- MNT-06 | miniprogram/app.js:164,171 | 可维护性 | P2 | `getUser()` 读 `wx.getStorageSync('user')` 原始对象，而 `setCache` 写 `{value,timestamp}` 包装，跨模块耦合脆弱 | 统一存储封装
- RES-03 | miniprogram/app.js:201-213 | 资源管理 | P2 | `resolveCloudFileIDs` 实为字符串变换，依赖硬编码 BASE；env 变更静默返回错误 URL 而非报错 | 见 MNT-01
- LOG-05 | miniprogram/pages/edit/index.js:580-596 + 406-417 | 逻辑错误 | P2 | `_loadTeamManagedFields` 把 company/position/companyWebsite 标记锁定，但 `saveCard` 仍把个人值写入；团队视图靠 mergeCardWithTeam 覆盖，个人存储值与实际展示不一致（非安全但易混淆） | 团队托管字段保存时跳过个人写入，或保存团队值

---

## 三、问题汇总表（按严重度排序）

### P0（1）
| ID | 文件:行号 | 维度 | 严重度 | 触发场景 | 修复方向 |
|---|---|---|---|---|---|
| SEC-00 | 控制台(非仓库) | 安全 | P0 | 前端直写依赖集合权限；误配即可越权删/拖库 | 核验 7 集合=仅创建者可读写，直写改云函数中转 |

### P1（4）
| ID | 文件:行号 | 维度 | 严重度 | 触发场景 | 修复方向 |
|---|---|---|---|---|---|
| SEC-03 | initVisits/index.js:105 | 安全 | P1 | 访客私有 phone 被透露给名片主人 | 富集时尊重访客本人 fieldVisibility |
| SEC-02 | initVisits/index.js:11-26 + preview/index.wxml:71 等 | 安全/逻辑 | P1 | owner「隐藏」开关仅前端生效，直连 API 可绕过 | 服务端合并 publicSettings 判定 |
| CON-02 | teamManager/index.js:78-82,142-146,181-185 | 并发 | P1 | shortId/邀请码并发重复，团队被错路由 | 唯一索引 + 事务兜底 |
| ERR-04 | list/index.js:47 | 边界 | P1 | 收藏>上限被截断丢数据 | 分页拉全 |

### P2（21，按维度归类）
- 并发：CON-01r(teamManager:238,304)、CON-03(teamManager:68-69)
- 安全：SEC-04(teamManager:319)、SEC-05(initVisits:240,272)、SEC-06(visibility.js:17)、SEC-07(preview:73)
- 逻辑/可维护：ERR-02r(accountManager:99-149)、LOG-01r(adminManager:160 vs teamManager:406)、MNT-03(edit:418)、LOG-05(edit:580/406)
- 边界：BND-01(teamManager:542)、BND-02(teamManager:318)、BND-03(adminManager:98)、BND-04(teamManager:609)、BND-05(initVisits:223)、BND-07(preview:662)、ERR-03(visitors:194)
- 可维护/资源：MNT-01(storage:13)、MNT-05(多处)、MNT-06(app:164)、RES-03(app:201)

---

## 四、Top N 最高优先级修复项

1. **【P0 核实】SEC-00** — 控制台核验 `cards/visits/visitor_profiles/user_save_cards/team_members/teams/team_invites` 权限 = 仅创建者可读写；这是整个前端直写鉴权模型的地基，必须先确认。
2. **SEC-03** — 修 `recordVisit` L3 富集，不再无条件拷 phone 到 visit（尊重访客自身 fieldVisibility）。
3. **SEC-02** — 服务端 `filterCardByVisibility` 合并 `publicSettings.showX`，让 owner「隐藏」开关真正生效（否则隐私承诺落空）。
4. **CON-02** — 为 `teams.shortId` 与 `team_invites.code` 建唯一索引，消除并发重复导致的错路由/错加入。
5. **ERR-04** — 名片夹 `user_save_cards` 加分页，避免收藏多时静默丢数据。
6. **BND-01** — `getTeamPublicDirectory` 分页拉全 active 成员，避免大团队公开目录截断。
7. **CON-01r** — `maxUses` 非 singleUse 邀请改条件更新，补齐 CON-01 残留竞态。
8. **SEC-04 / SEC-05** — 回传访客/成员数据时剥离 `openid`/`cardId`/`visitorOpenId` 等 PII。

---

## 五、审计覆盖说明

### 已深读（带行号审计）
- **云函数（7/7 JS）**：getOpenId/index.js、adminManager/index.js、teamManager/index.js、accountManager/index.js、deleteCard/index.js、initVisits/index.js、initVisits/visibility.js
- **前端 JS（23/23）**：app.js、config/storage.js、config/cardVisibility.js、config/cardStyle.js（仅抽查，纯样式常量）、utils/share.js、utils/shareCard.js、utils/team.js、pages/edit/index.js、pages/preview/index.js、pages/visitors/index.js、pages/index/index.js、pages/list/index.js、pages/profile/index.js、pages/team/{list,detail,create,join,member-edit}.js、pages/account/index.js、pages/admin/index.js、pages/crop/index.js、pages/agreement/index.js、custom-tab-bar/index.js
- **关键 WXML（2/16）**：pages/edit/index.wxml（三态可见性开关）、pages/preview/index.wxml（锁定位 + 团队名片视图 + 授权弹窗）
- **协议/隐私**：pages/agreement/index.js（隐私政策与「团队托管字段」声明一致）

### 未深读 / 仅抽查（及原因）
- 其余 14 个 WXML（index/list/visitors/team/*/agreement/crop 等）：均为展示层，其数据均来自已审 JS 的 setData；安全判定以前端 JS + 云函数服务端过滤为准，WXML 仅渲染。若需逐行可补充。
- `cardStyle.js`：纯布局/样式常量与 Canvas 尺寸计算，无鉴权/注入面，仅抽查。
- `DOCUMENTATION.md`、`.workbuddy/**`、`artifacts/*.md`、`.github/workflows`、`project.private.config.json`、`screenshots/**`：文档/缓存/CI/截图，非源码审计对象。
- **数据库集合权限规则文件**：微信云开发权限在控制台配置，**不在仓库内**，无法静态审计（即 SEC-00 风险来源）。

### 特别说明
- 目录结构与预期基本一致（cloudfunctions 7 函数、miniprogram 标准小程序结构），未发现路径错配。
- 新增访客授权披露功能整体服务端实现正确（getCardView/authorizeVisit 服务端强制可见性），主要问题集中在「visitor→owner 反向隐私」（SEC-03）与「publicSettings 服务端未强制」（SEC-02），以及历史前端直写对安全规则的强依赖（SEC-00）。
