# Ncard 团队租户（Team / Tenant）功能设计方案

> 状态：设计已确认，待细化实现（v0.4 含团队创建机制 + 创建查重机制）
> 目标：在现有「个人名片」体系之上，新增「团队租户」能力——团队可管理成员名片的**部分组织字段**，支持邀请/搜索加入、踢人/退出，个人建卡时可选择加入团队。

---

## 1. 需求拆解

| 编号 | 需求点 | 设计含义 |
|---|---|---|
| R1 | 支持团队租户 | 新增「团队」实体 + 团队成员关系 |
| R2 | 团队可管理成员名片的**部分信息** | 团队只覆盖「组织字段」，个人字段仍归本人 |
| R3 | 可邀人进团队、可把人踢出 | 邀请机制 + 成员移除 |
| R4 | 个人建卡时可选择加入某团队 | 编辑页增加「加入团队」入口 |
| R5 | 加入前提：知道团队名称/ID，或收到管理员邀请 | 两条加入路径：搜索加入 + 邀请加入 |

---

## 2. 关键设计决策（已全部确认）

| 决策点 | 结论 | 说明 |
|---|---|---|
| **D1 一张名片可加入几个团队** | ✅ **多团队**（card 可属于多个 team） | 一人常隶属多个组织；关联表实现，成本不高。 |
| **D2 团队可管理的「部分信息」范围** | ✅ 仅**组织字段**：公司、部门、职位、公司电话、公司地址、公司网站、工作邮箱 | 个人字段（姓名、私人手机/微信/邮箱/地址）**始终归本人**，团队不可改。统一头像/团队 logo **v1 暂不做**（见 D7）。 |
| **D3 按名称/ID 加入是否需要审核** | ✅ 默认**申请 → 管理员审核**；团队可设「开放加入」免审核 | 防滥用；开放加入作为团队开关。 |
| **D4 邀请形式** | ✅ **邀请码 + 微信分享卡片** 双形态 | 邀请码便于粘贴；分享卡片便于微信转发，打开即带 teamId+token。 |
| **D5 管理员模型** | ✅ v1 仅「创建者=管理员」 | v2 再支持多名管理员。 |
| **D6 团队字段如何作用到名片** | ✅ **覆盖层（override）模式** | 个人 card 仍是真相源；团队在关联表里存 `managedFields`，展示/分享时合并（团队字段覆盖同名字段）。踢人即删关联，名片自动还原。 |
| **D7 团队特征呈现方式** | ✅ **轻量徽章（方案 A，主呈现）+ 多团队并列** | 无独立品牌色/Logo，徽章用主色 `#3B82F6` 文字胶囊；分享图 v1 不接入。详见第 8.1 节。 |

---

## 3. 数据模型（云数据库集合）

### 3.1 `teams`（团队）
```
{
  _id:            string          // 内部团队ID（自动生成，不直接对外）
  shortId:        string          // 对外「团队ID」（6-8 位易读码，如 TB7K2QD，唯一索引）
  name:           string          // 团队名称（不强制唯一，靠 shortId 区分）
  ownerOpenId:    string          // 创建者 openid
  description:     string          // 简介
  logoUrl:        string          // 团队 logo（可选，v1 不做）
  openJoin:       boolean         // 是否开放加入（免审核）默认 false
  inviteEnabled:  boolean         // 是否允许生成邀请 默认 true
  memberCount:    number          // 冗余计数
  createdAt:      number
}
```
索引：`shortId`（唯一，对外搜索）、`name`（名称模糊搜索）、`_id`。

### 3.2 `team_members`（团队成员关系 + 团队字段覆盖）
```
{
  _id:            string
  teamId:         string
  memberOpenId:   string
  cardId:         string          // 该成员对应的个人名片ID
  role:           'owner' | 'member'
  status:         'pending' | 'active'   // pending=待审核
  invitedBy:      string          // 邀请人 openid（若是邀请加入）
  managedFields:  {               // 团队覆盖的组织字段（仅 D2 所列）
    company, department, position,
    companyPhone, companyAddress, companyWebsite, workEmail
  }
  isPrimary:      boolean         // 主展示团队（v2 分享图 Banner 用，v1 预留，默认首个加入为 true）
  joinedAt:       number
}
```
索引：`teamId + memberOpenId`（唯一，一人一队一条）、`memberOpenId`（查「我加入的团队」）。

### 3.3 `team_invites`（邀请凭证，可选独立集合）
```
{
  _id:            string
  teamId:         string
  code:           string          // 短邀请码（唯一）
  token:          string          // 分享卡片携带的校验串
  createdBy:      string
  expiresAt:      number          // 过期时间
  maxUses:        number          // 最大使用次数（0=不限）
  usedCount:      number
  singleUse:      boolean
}
```
索引：`code`（唯一）。

### 3.4 现有 `cards` 的改动
- 新增可选字段 `teamIds: string[]`（冗余，便于「我的团队名片」查询；真相仍以 `team_members` 为准）。
- **不做破坏性迁移**：旧名片 `teamIds` 默认为空。

---

## 4. 角色与权限

| 角色 | 权限 |
|---|---|
| **团队创建者 (owner)** | 全部：编辑成员团队字段、邀请、审核、踢人、改团队设置、解散/转让 |
| **成员 (member)** | 加入/退出；编辑**本人个人字段**；团队字段在其编辑页**只读** |
| **非成员** | 仅能通过名称/ID 搜索到团队、或通过邀请码加入 |

所有写操作在云函数内做 `openid` 鉴权：管理员操作校验 `_openid === team.ownerOpenId`；成员操作校验其确为 `team_members` 中 `active` 状态。

---

## 5. 核心业务流程

### 5.1 路径 A：按团队名称 / ID 加入（R5 + D3）
```
用户「加入团队」→ 输入名称/ID → searchTeam → 列结果
  → 点击「申请加入」→ requestJoin（写 team_members.status=pending）
  → 管理员收到待审 → approveJoin（status=active）/ rejectJoin
  （若 team.openJoin=true，则 requestJoin 直接 active，免审）
```

### 5.2 路径 B：管理员邀请加入（R3 + D4）
```
管理员「邀请成员」→ createInvite（生成 code+token，带过期/次数）
  → 复制邀请码 或 微信分享卡片（卡片携带 teamId+token）
  → 用户打开 → joinByInvite（校验 token/过期/次数）→ 直接 active 加入
```

### 5.3 路径 C：建卡时加入（R4）
```
pages/edit 编辑页新增「加入团队」区块
  → 搜索名称/ID 申请 或 粘贴邀请码
  → 加入成功后，card.teamIds 追加该 teamId
```

### 5.4 管理员管理成员（R2 + R3）
```
团队详情页：
  - 成员列表（头像/姓名/角色/状态）
  - 「编辑名片信息」→ member-edit 页 → updateMemberFields（仅写 managedFields）
  - 「移除成员」→ removeMember（删 team_members 记录；个人 card 不变、teamIds 去除）
  - 「邀请」→ 见 5.2
```

### 5.5 成员退出
```
成员「退出团队」→ leaveTeam（删自身 team_members 记录）
```

---

## 6. 云函数设计

新建 **`teamManager`** 云函数（单一函数 + `action` 路由，与现有 `initVisits` 风格一致，减少部署数）：
- `createTeam` / `getTeam` / `getMyTeams`
- `searchTeam`（按名称模糊 / 按 ID 精确）
- `requestJoin` / `approveJoin` / `rejectJoin`
- `createInvite` / `joinByInvite` / `revokeInvite`
- `listMembers` / `updateMemberFields` / `removeMember`
- `leaveTeam` / `transferOwnership`（v2）

每个 `action` 开头做权限校验；失败返回 `{ success:false, errCode, msg }`。

> 注：现有 `getOpenId` 仍保留（建议补 `DYNAMIC_CURRENT_ENV`，见上轮讨论）。

---

## 7. 页面 / UI 规划

| 页面 | 作用 | 复用/新建 |
|---|---|---|
| `pages/team/list` | 我的团队 + 创建/加入入口 | 新建 |
| `pages/team/create` | 创建团队 | 新建 |
| `pages/team/detail` | 团队管理（成员/邀请/设置） | 新建 |
| `pages/team/join` | 搜索名称/ID + 邀请码输入 | 新建 |
| `pages/team/member-edit` | 管理员编辑成员组织字段 | 新建 |
| `pages/edit` | 增加「加入团队」区块 | **改** |
| `pages/preview` | 展示团队标识 / 团队入口 | **改** |
| `pages/profile` | 增加「我的团队」入口 | **改** |
| `pages/agreement` | 补充团队数据使用说明 | **改** |

设计语言沿用现有体系：主色 `#3B82F6`、Georgia 衬线标题、4rpx 锐角、左侧品牌蓝装饰条。

---

## 8. 与现有架构的集成点

- **名片真相源**：`cards` 不变，团队仅通过 `team_members.managedFields` 叠加。
- **隐私合规**：`__usePrivacyCheck__` 已开启，`showPrivacyError` 已覆盖；新增团队字段编辑需在 `agreement` 页面补充告知（加入团队即授权团队管理你的组织字段）。
- **访客系统**：不受影响，L1/L2/L3 逻辑不变。

### 8.1 团队特征呈现规范（D7，已确认）

设计原则：**个人名片身份不被团队稀释**，团队存在感以「最小侵入」方式表达。因 v1 团队无独立品牌色/Logo，统一以主色 `#3B82F6` 作视觉锚点。

| 场景 | 呈现方案 | 说明 |
|---|---|---|
| **应用内预览（preview 页）** | 姓名/名片头部下方放一排**轻量徽章（pill）**，多团队并列 | 每个徽章：圆角小胶囊，`#3B82F6` 浅蓝底 + 深蓝文字，仅显示团队名（无 logo）。点击徽章 → 进入该团队的「团队名片视图」（按对应 managedFields 覆盖层展示）。 |
| **编辑页（edit）** | 被团队托管的字段前加**小锁图标**，输入禁用，下方提示「由 XX 团队管理」 | 明示团队托管，避免用户困惑为何不可改。 |
| **分享图（Canvas v8）** | **v1 不接入**，保持现有个人名片样式 | 团队 Banner 列入 Phase 2（v2）增强。 |
| **团队目录/详情（team/detail）** | 天然团队语境，完整品牌化展示成员 | 不在个人名片范畴。 |

**主展示团队（primary team）**：多团队下，分享图 Banner（v2）需一个主团队决定显示谁。v1 在 `team_members` 预留 `isPrimary` 字段（默认首个加入的团队为 `true`），v2 接入，v1 不暴露设置 UI。

**视觉约束**：徽章风格与现有体系一致（圆角 ≤ 4rpx、主色 `#3B82F6`、无阴影），不引入新的品牌色变量。

---

## 9. 边界与异常处理

- **多团队**：同一 card 多条 `team_members`，各团队独立 `managedFields`；展示时按当前团队上下文取对应覆盖层。
- **被踢/退出**：删关联即还原，个人 card 无感。
- **成员删卡**：级联删其 `team_members`（参考现有 `deleteCard` 的级联清理）。
- **Owner 退出/解散**：v1 限制「Owner 不得直接退出，须先转让或解散团队」。
- **邀请失效**：过期/达次数/被撤销 → `joinByInvite` 拒绝并提示。
- **名称冲突**：团队名不强制唯一，靠 ID 区分；搜索结果展示 ID 防误加。

---

## 10. 实施分期建议

- **Phase 1（MVP，建议首版）**：创建团队、邀请码加入、成员列表、管理员编辑组织字段、踢人、退出、建卡时加入。
- **Phase 2**：名称/ID 搜索 + 审核流、多管理员、分享卡片团队 Banner。
- **Phase 3**：成员变动通知、团队公共目录、团队数据统计。

---

## 11. 确认状态与下一步

### 已确认决策总览
- **D1** 多团队 ✅
- **D2** 仅组织字段（统一头像/Logo v1 不做）✅
- **D3** 默认审核 + 可开放免审 ✅
- **D4** 邀请码 + 微信分享卡片 ✅
- **D5** v1 仅创建者管理员 ✅
- **D6** 覆盖层模式 ✅
- **D7** 轻量徽章（多团队并列）+ 分享图 v1 不接入 ✅
- **D8** 创建不强制先有个人名片（加入/托管时才需 card）✅
- **D9** 单用户创建上限默认 5（可配置 `MAX_TEAMS_PER_USER`）✅
- **D10** 生成 shortId 作对外「团队ID」✅
- **D11** 团队名不强制唯一、v1 不做认证标识 ✅
- **D12** 创建查重四层机制（L0 shortId 唯一 / L1 本人同名硬拦截 / L2 全网同名软提示 / L3 限流）+ 全量归一规范化 ✅

### 下一步：进入详细设计 + Phase 1 实现
确认后我将产出（按实现顺序）：
1. 完整接口字段定义（`teamManager` 各 action 入参/出参）
2. 数据模型字段级定义（`teams` / `team_members` / `team_invites`，含 `isPrimary` 预留）
3. 页面线框：`team/list`、`team/create`、`team/detail`、`team/join`、`team/member-edit` + `edit`/`preview`/`profile`/`agreement` 改造
4. 云函数伪代码与权限校验（沿用 `initVisits` 风格）
5. Phase 1（MVP）实现清单与提交计划

> 是否现在开始按 Phase 1 细化并着手实现？或你想先就「邀请分享卡片的具体交互」「多团队时主展示团队的选择 UI（v2）」再讨论一轮？

---

## 12. 团队创建机制设计（新增专章，待确认）

### 12.1 创建权限与门槛
- 任何已登录用户均可创建（小程序天然需登录拿到 openid）。
- **是否强制先有个人名片？** 推荐 **不强制**。创建团队只依赖 openid；但成员要被托管组织字段，需先有 card——在「加入/被邀请」环节校验 card 存在，否则提示「请先创建个人名片」。
- **防刷配额**：单用户创建团队数设软上限 `MAX_TEAMS_PER_USER`（默认 5，可配置），`createTeam` 内校验，超限返回 errCode 提示。

### 12.2 命名与防冒名（呼应 D7「无品牌色/Logo」）
- 团队名 **不强制唯一**，靠 `shortId` 区分；但对外提供：
  - `shortId`：生成 6–8 位易读字符（如 `TB7K2QD`），作为用户口中的「团队ID」用于搜索/分享，替代冗长的内部 `_id`。
  - 重名展示：搜索结果同时显示 `shortId` + 创建者昵称，防误加同名团队。
- v1 **不做企业认证 / 蓝 V 标识**；冒名风险靠 v2 的「举报 / 封禁」机制兜底。

### 12.3 创建流程（创建即成为管理员 + 首个成员）
```
createTeam({ name, description, openJoin, inviteEnabled })
  → 校验：name 非空 + 未超配额
  → 生成 shortId（查重直到唯一）
  → 写 teams（ownerOpenId, shortId, openJoin=false, inviteEnabled=true, memberCount=1）
  → 写 team_members（teamId, memberOpenId=creator, role='owner', status='active', isPrimary=true）
  → 返回 { teamId, shortId }
```
- 创建者自动成为 owner 且是首个 active 成员；其自身若未建 card，则无任何托管字段数据（仅身份占位）。

### 12.4 初始默认配置
| 字段 | 默认值 | 说明 |
|---|---|---|
| `openJoin` | `false` | 默认需审核，防陌生人乱入 |
| `inviteEnabled` | `true` | 默认可生成邀请 |
| `description` | `''` | 可选 |
| `logoUrl` | `''` | v1 不做 |

### 12.5 页面与交互
- `pages/team/create`：表单（团队名称*、简介、开放加入开关）。提交成功后跳转 `team/detail` 并弹出「邀请成员」引导。
- 创建入口：`profile` 页「我的团队」→「创建团队」；`team/list` 顶部「+ 创建」。

### 12.6 已确认决策（D8–D11）
| 决策点 | 推荐方案 | 说明 |
|---|---|---|
| **D8 创建是否需先有个人名片** | ✅ 不强制，但加入/托管时需 card | 降低创建门槛，避免空跑 |
| **D9 单用户创建上限** | ✅ 默认 5（可配置 `MAX_TEAMS_PER_USER`） | 防云资源滥用 |
| **D10 是否生成 shortId 作为对外「团队ID」** | ✅ 是（替代冗长 _id） | 搜索/分享体验更好 |
| **D11 v1 是否要做团队名唯一性或认证标识** | ✅ 均不做，v2 再加 | 控制首版复杂度 |

### 12.7 创建查重机制（已确认，D12）

设计原则：因 D11 已定「团队名不强制唯一」，查重的目的**不是阻止创建**（非唯一约束），而是：① 防本人手滑重复建；② 防误建/冒名（把"看清 ID"前移到创建环节）；③ 保证系统唯一键 shortId 不撞。分四层，从硬到软：

**L0 · shortId 唯一性（系统级硬约束，已有）**
- 整个系统唯一的硬唯一键。生成时 `do { gen } while (exists(shortId))`，撞了重来。D10 产物天然即查重，确保「团队ID」永不冲突。

**L1 · 创建者自重复硬拦截（hard block）**
- 条件：`ownerOpenId` + `normalize(name)` 在 `teams` 已存在一条记录。
- 行为：直接拦截，提示「你已创建过同名团队「XX」，是否前往管理？」并提供跳转。
- 说明：仅「本人 + 名」组合拦截，**不违反 D11**（他人仍可同名），只防自己重复。纯数据约束，零歧义。

**L2 · 全网同名软提示（soft warning，前端实时，主防线）**
- 时机：`team/create` 名称输入框 `onInput` 防抖 300ms → `searchTeam(name, exact=true)`。
- 命中：列出同名/近似团队（名称、shortId、创建者昵称、成员数），展示提示条「已有 N 个同名团队，是否误建？」+ 两个动作：
  - 「查看/加入」→ 跳对应团队（开放加入则可申请/直接加入）
  - 「仍要创建」→ 二次确认后放行
- 说明：把 §9「名称冲突靠 ID 区分」与 §12.2「搜索展示 shortId + 创建者昵称防误加」前移到创建环节。不阻止创建，仅辅助判断。

**L3 · 防刷限流（hard block，可选）**
- D9 配额：单用户 `MAX_TEAMS_PER_USER = 5`（已在 §12.1 规划）。
- 额外限流：单 openid 5 分钟内最多创建 2 个（防连点/脚本）。无状态云函数需落地时间戳（可复用计数或建 `team_create_logs`）。

**规范化 `normalize(name)`（L1/L2 比对前必做）**
- 去首尾空格、折叠内部连续空格
- 全角 → 半角（数字/字母/标点）
- 中文标点归一（，,。. 等统一）
- 统一小写比对（仅比对用，存储保留用户输入原样）
- 效果：「腾讯 / 腾讯 / 腾 讯 / 腾讯」命中同一比对结果，提示才有意义。

**实现位置**
- L0/L1/L3：`teamManager.createTeam` 内顺序执行。
- L1 查询：`db.collection('teams').where({ ownerOpenId, name: normalized })`。
- L2：前端 `onInput` 实时提示 + 提交时 `createTeam` 可再返回 `existingSimilar: [...]` 兜底二次确认。
- 索引：L1 需新增复合索引 `ownerOpenId + name`；`name` 单字段索引 §3.1 已规划。
- L2 展示的创建者昵称：关联 `visitor_profiles` / `cards` 取。

**D12 已确认决策**

| 决策点 | 结论 |
|---|---|
| **D12a L1 本人同名硬拦截** | ✅ 是 |
| **D12b L2 全网同名软提示** | ✅ 是（主防线） |
| **D12c 规范化强度** | ✅ 全量归一（trim + 全半角 + 标点 + 小写） |
| **D12d 匹配粒度** | ✅ v1 仅「归一后完全相等」，近似/拼音 v2 |
