# Ncard 全库审计报告（2026-08-19）

> 触发：用户要求「对当前代码库展开一次全面审计，系统检查所有模块、功能及边界情况，识别并尽可能修复缺陷、漏洞与潜在问题」。
> 结论：发现 **7 类可修缺陷（含 1 项严重越权漏洞）**，全部已修并本地提交 `cb3e9ba`；另记录 6 项 LOW 级观察待后续。

---

## 1. 审计范围

| 层 | 对象 | 规模 |
|---|---|---|
| 云函数 | `teamManager`（784 行，团队系统唯一后端）、`initVisits`、`deleteCard`、`getOpenId`、`resolveCloudUrls` | 5 个 |
| 页面 | index / edit / preview / list / visitors / profile / agreement / crop / team(detail·join·create) | 9 组 |
| 工具层 | `utils/team.js`、`utils/share.js`、`utils/shareCard.js`、`config/*` | 3+ |
| 数据集合 | cards / visits / user_save_cards / visitor_profiles / teams / team_members / team_invites | 7 |

方法：2 个并行 QA 子代理分头审 team 页面组与名片生命周期页面组，主理人亲审云函数与安全边界，三方结果交叉收敛。

---

## 2. 已修复缺陷清单

### 🔴 P0-1【严重·越权 IDOR】`initVisits` 全部 action 信任客户端身份

- **位置**：`cloudfunctions/initVisits/index.js`
- **问题**：`recordVisit` / `getMyVisitorStats` / `getRecentVisitors` / `getMyVisitorDashboard` 均直接使用 `data.cardOwnerId`、`data.visitorOpenId`。攻击者只需替换 `cardOwnerId` 即可读取**任意用户**的访客统计与最近访客明细；也可伪造 `visitorOpenId` 污染他人访客数据。
- **修复**：
  ```js
  const { OPENID } = cloud.getWXContext()   // 唯一可信身份
  if (!OPENID) return { success: false, code: 'UNAUTHORIZED' }
  // recordVisit：cardOwnerId 从 cards.doc(cardId).get()._openid 派生
  const visitorOpenId = OPENID
  // 查询类：强制 where.cardOwnerId = OPENID，彻底忽略入参
  ```
- **影响面**：修复后客户端传入的 `cardOwnerId` 一律被忽略，接口语义收窄为「只能查自己的」，与前端现有调用完全兼容（前端本来就只查自己）。

### 🟠 P1-1【信息泄露】`getCardTeams` 无视 `cardSchema.visible`

- **位置**：`cloudfunctions/teamManager/index.js` → `getCardTeams`
- **问题**：该接口为跨用户读（访客看别人名片时拉团队信息，走 admin 上下文），却把 `managedFields` **全量**返回。owner 在团队名片配置里关掉的手机号/邮箱/地址，依然会通过这个接口发到访客端。
- **修复**：新增工具函数并接入
  ```js
  function filterManagedByVisible(raw, schema) {
    const vis = {}
    ;(schema || defaultCardSchema()).forEach(f => { vis[f.key] = f.visible === true })
    const out = {}
    CARD_SCHEMA_KEYS.forEach(k => { if (vis[k] && raw && raw[k]) out[k] = raw[k] })
    return out
  }
  ```
- **安全模型对齐**：与 `getTeamPublicDirectory`（白名单六字段、联系方式绝不出网）形成一致的两道闸门。

### 🟠 P1-2【信息泄露】`searchTeam` 返回 `ownerOpenId`

- 搜索团队时把团队主的 openid 一并下发，属无必要的用户标识外泄。已从返回映射中移除。

### 🟠 P1-3【数据完整性】`deleteCard` 未级联清理 `team_members`

- **问题**：删除名片只清了 visits / user_save_cards / 云存储文件，**漏了 `team_members`**。后果：团队里留下 `cardId` 指向已删名片的悬空托管记录，成员列表出现空壳行，且 `teams.memberCount` 永久虚高。
- **修复**：删除主体前先遍历 `team_members.where({ cardId })`，逐条 `remove()` 并 `teams.doc(teamId).update({ data: { memberCount: _.inc(-1) } })`；每步 `.catch` 容错，任一失败不阻断名片主删除（避免因团队侧异常导致名片删不掉）。

### 🟡 P2-1【功能缺陷】空名片「预填内容」从未生效

- **问题**：owner 在团队名片配置里填的 `defaultValue`，`team/detail.onShareCard` 生成邀请时**没有打包进 prefill**，`createCardInvite` 收到空对象 → 成员端表单永远空白。配置项形同虚设。
- **修复（双保险）**：
  - 前端 `detail.js`：从 `cardConfigSchema` 提取非空 `defaultValue` 组装 `prefill` 传入 `createCardInvite`。
  - 后端 `joinByInvite`：合并时再加一层兜底，优先级 `用户填写值 > 邀请 prefill > cardSchema.defaultValue`。

### 🟡 P2-2【体验/边界】`team/join` 忽略邀请过期与用尽

- **问题**：`getInviteMeta` 已返回 `expired` / `usedUp`，但 join 页未判断，仍渲染填空表单，用户填完提交才报错。
- **修复**：新增 `inviteInvalid` 状态，元信息返回失效即提前拦截 + 提示「该邀请已失效或已使用」；wxml 增加提示块并把原 `wx:if` 串成 `wx:elif`，避免两块同时渲染。同时表单初值改为回显 `prefill || defaultValue`。

### ⚪ P3【规范】死代码清理

- `getTeamPublicDirectory` 内无用的 `const ALLOWED_KEYS = [...]`（白名单已内联在映射里）。
- `join.wxml` 残留的 `prefillTeam` 卡片块（该字段已无来源）。

---

## 3. 变更文件

| 文件 | 性质 |
|---|---|
| `cloudfunctions/initVisits/index.js` | 安全重写（身份派生） |
| `cloudfunctions/teamManager/index.js` | 可见性过滤 + 去泄露 + 默认值兜底 + 去死码 |
| `cloudfunctions/deleteCard/index.js` | 级联清理 team_members |
| `miniprogram/pages/team/detail.js` | prefill 打包 |
| `miniprogram/pages/team/join.js` | 失效拦截 + 预填回显 |
| `miniprogram/pages/team/join.wxml` | 失效提示块 + 去死码 |

合计 **6 文件，+95 / −41**。自检：全部 `node --check` 通过；grep 确认无残留死符号引用。

提交：`cb3e9ba audit: 安全/逻辑/数据完整性修复`

---

## 4. 未修复观察（LOW，建议后续单独处理）

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| L1 | `preview/index.wxml:35` | 团队徽章 `data-index="0"` 硬编码，成员属多团队时点任意徽章都打开第一个 | 改 `data-index="{{index}}"` 或直接 `data-team-id` |
| L2 | `team/create.js` | 计时器未在 `onUnload` 清理，页面销毁后仍触发 setData | `this._timer` + `onUnload` 清理 |
| L3 | `list/index.js` | `onShow` 每次全量拉云数据，返回即重查 | 加时间戳/脏标记短路 |
| L4 | `profile/index.js` | 无任何缓存，每次进页重查 | 复用 app 级缓存 |
| L5 | 多处 | 残留调试 `console.log` | 发版前统一清理或包一层 debug 开关 |
| L6 | `app.js` | 版本号 `'1.1.4'` 硬编码（此前已把 profile 的常量化，app.js 漏了） | 收进 `config/` 单一常量 |

---

## 5. 上线动作（阻塞项）

1. **必须重新上传部署 3 个云函数**：`initVisits`、`teamManager`、`deleteCard`。
   ⚠️ 其中 `initVisits` 是越权漏洞修复——**不部署等于漏洞仍在线**，本地代码改了不生效。
2. 推送远程 + 打 tag：当前本地 `main` 领先 `origin/main` **8 个提交**（rebrand ×2 + 团队名片方案A ×4 + 文案 ×1 + 审计 ×1）。按用户「先不推」的要求保持本地，待拍板后 `git push origin main` 并建议打 `v1.4.0`（团队名片 + 安全审计）。
3. 打 tag 时同步更新 `CHANGELOG.md` + README 版本历史（项目约定，无 RELEASE_NOTES.md）。
