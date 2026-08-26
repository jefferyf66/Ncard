# 方案 A 落地概述：访客身份读时解析（resolve-on-read）

**目标**：根治「访客后来登录/创建自己的名片（升级为 L3）或被主人授权（L2）后，名片主人的访客列表里用户名/头像仍停留在旧快照」的 staleness bug。

## 改动文件
- `cloudfunctions/initVisits/index.js`（唯一改动，前端不动）

## 核心改动
1. **新增 `resolveVisitorIdentities(openids)`**（顶层 async，位于 `filterCardByVisibility` 之后）：
   - 入参去重 + 过滤空值；为空直接返回 `{}`（不抛错）。
   - **L3**：`db.collection('cards').where({ _openid: db.command.in(ids) })` → 取 `name/avatar/position/company`，`visitorLevel=3`。
   - **L2**：`db.collection('visitor_profiles').where({ openid: db.command.in(ids) })` → 仅当该 openid **非 L3** 时写入 `nickname/avatarUrl`，`visitorLevel=2`（不降级）。
   - 两段查询各自 `try/catch`，失败仅 `console.warn`，不中断主流程。
   - 返回 `map`：以 openid 为 key 的最新身份覆盖层（仅公开展示字段，绝不含 phone/email）。

2. **`getRecentVisitors` 与 `getMyVisitorDashboard` 读取侧**：
   - 取回 visits 后，按 distinct `visitorOpenId` 调一次 `resolveVisitorIdentities`，对每个 visit 覆盖 `visitorName/visitorAvatar/visitorPosition/visitorCompany/visitorLevel`。
   - 覆盖用 `r.xxx || v.xxx || ''` 兜底旧快照非空值；`visitorLevel` 取较大值（只升不降）。
   - 列表因此永远显示访客**当前**身份，与「是否再次访问该名片」无关。

3. **顺带堵死 SEC-03（访客电话泄露）**：
   - 原两接口把 `visits.visitorPhone`（recordVisit 落库的访客电话）原样回传给名片主人。
   - 改为对每个 visit **无条件** `delete v.visitorPhone`（抽出 `if(openids.length)` 分支外，纵深防御，避免极端「全部 visitorOpenId 为空」时漏删）。

## 验证（QA 第二层，独立视角）
- `node --check`：**PASS**。
- 纯逻辑 mock 脚本（不 require 云端模块）：**5 断言 17 子项全过** —— L3 覆盖 L2 不降级 / 仅 L2 取昵称 / 空快照兜底不报错 / 空入参返 `{}` / `visitorPhone` 删除生效。
- Grep 静态：全文 `visitorPhone` 仅写入侧 `recordVisit` 保留 + 两处 `delete`；读取侧无新增 phone/email 等私密字段下发。

## 上线必做（用户侧）
- ⚠️ `initVisits` 云函数须**重新上传部署**才生效（覆盖 getCardView / authorizeVisit / getCardsBatch / 新增 resolveVisitorIdentities + visibility.js）。
- 当前**未提交 git、未部署**（按红线：部署/提交待用户拍板）。
- 建议回归验证：让一个访客先匿名访问 → 再创建自己的名片 → 主人访客列表应即时显示其真实用户名/头像（无需再次访问）。
