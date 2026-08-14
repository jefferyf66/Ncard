# Ncard v2 详细实施方案：快速登录机制 + 团队租户功能

> **文档状态**：v1.0（待审阅）
> **目标**：把「用户快速登录」与「团队租户」两份设计稿（已逐条确认）整合成一份可执行的统一方案，供评审确认一致性后进入实现。
> **前置条件**：本方案不改动现有名片/分享/访客/隐私体系；所有新增均为增量。

---

## 0. 依赖关系与实施顺序（关键）

```
Phase A 快速登录（基础，必须先做）
   └─ 建立 users 集合 + 稳定 openid 身份源
        └─ Phase 1 团队租户 MVP（依赖 openid 身份）
             └─ Phase B 资料完善 + 命名/ID 搜索审核流
                  └─ Phase 2 团队搜索/审核/多管理员/分享图 Banner
                       └─ Phase 3 通知/统计/注销
```

- **团队功能强依赖登录机制**：`teams.ownerOpenId`、`team_members.memberOpenId` 必须与 `ensureUser` 建立的 openid **同源**（统一取自 `cloud.getWXContext().OPENID`）。
- **L2 同名搜索展示「创建者昵称」**：昵称来源为 `users`（登录机制建立）或 `visitor_profiles`（L2/L3），两者在 Phase B 打通。

---

# Part A：用户快速登录机制（基于 openid）

> 来源：`artifacts/user-login-design.md` v0.2（已对照微信官方文档核验）

## A1 现状审计（已代码核实）
- 无 `users` 集合，无注册/登录/登出/session。
- 身份靠各页面零散 `app.getOpenId()` → `getOpenId` 云函数 → `cloud.getWXContext().OPENID`，缓存 `globalData._openId`，**不在 `onLaunch` 统一触发**。
- `visitor_profiles` 被「客串」成用户档案（存 themeColor/isDefault/昵称/头像），语义混淆。
- `profile` 页有「已绑定账号/请登录」文案但**无真实登录入口**（仅样式）。
- ⚠️ 既有缺陷：`profile/index.js` 的 `onAuthUserInfo` 与 `preview/index.js` 仍用 `wx.getUserProfile`，该接口 **2022-10-25 起已收回**，当前只返回灰头像+「微信用户」，**需随 Phase B 一并迁移**。
- 隐私门控已具备：`__usePrivacyCheck__: true` + `showPrivacyError(103/104)`。

## A2 设计目标
1. **快速登录**：用户无感建立账号（基于 openid），无需按钮/授权。
2. 建立规范 `users` 档案，替代散落的 openid 调用与 `visitor_profiles` 客串。
3. 完全合规：取 openid 属免授权接口，**不触发**隐私弹窗；昵称/头像走独立「完善资料」分支。

## A3 官方文档核验结论与两处修正（已执行）
- **核验通过**：云开发 `cloud.getWXContext().OPENID` 是官方推荐轻量身份机制——云函数被调用时微信**自动注入可信 OPENID**，免 `wx.login`、免 `code2Session`、免自定义 Token。
- **修正 1（链路精简）**：删除原方案中的 `wx.login()` 步骤——云函数调用即注入 OPENID，客户端无需取 code。
- **修正 2（致命修正）**：`wx.getUserProfile` 已失效，原「资料缺失则调它」不可行 → 改为官方现唯一路径「头像昵称填写能力」（`chooseAvatar` 按钮 + `nickname` 输入框 + 头像上传云存储 + 后台声明「收集你的昵称、头像」）。

## A4 机制设计

### A4.1 `ensureUser()`（核心，应用级身份初始化）
- 位置：`app.js` 新增；在 `onLaunch` 的 `initCloud()` 之后调用（失败不阻塞应用）。
- 流程（云开发最优形态）：
  1. 直接 `wx.cloud.callFunction({ name: 'getOpenId' })` —— **不先调 `wx.login()`**，OPENID 由微信注入。
  2. 云端 `cloud.getWXContext().OPENID` 取身份（只读可信上下文，绝不读 `event.openid`）。
  3. 云端按 openid `upsert` `users`（`_openid` 为主键）：首写 `registeredAt`，每更 `lastLoginAt`。
  4. 返回档案；客户端缓存 `globalData.user` + `wx.setStorage`。
- 隐私：本步**不触发**隐私弹窗（取 openid 属免授权接口）。

### A4.2 `users` 集合 Schema
```
{
  _openid:        string,   // 微信注入（= openid，主键）
  unionid:        string,   // 多端打通用（可选，满足条件才返回）
  nickname:       string,   // 可选，Phase B 完善资料后填
  avatarUrl:      string,   // 可选，cloud:// 或 HTTPS
  themeColor:     string,   // Phase B 从 visitor_profiles 迁移
  defaultCardId:  string,   // Phase B 从 visitor_profiles 迁移
  registeredAt:   number,
  lastLoginAt:    number
}
```
索引：`_openid`（主键唯一，系统自带）。

### A4.3 与 `visitor_profiles` 的关系
- 现状混淆：既存「访客目录」又存「我的设置」。
- Phase B 拆分：`users` = 我的账号；`visitor_profiles` = 仅「谁访问过我」（L2/L3），不再承担我的设置。
- 不阻塞 MVP：Phase A 仅新增 `users` + `getOpenId.ensureUser`。

### A4.4 云函数改造 `getOpenId`
- 沿用现有单一函数，新增 `action: 'ensureUser'`，云端用 openid upsert `users`（鉴权最稳，防客户端伪造 `_openid`）。
- **补 `cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })`**（此前缺失，已并入本次）。
- 额外返回 `unionid`（若绑定开放平台，供多端打通）。

### A4.5 隐私合规
- 登录（取 openid）免授权，不弹窗；沿用 `__usePrivacyCheck__: true`。
- 完善资料（昵称/头像）是隐私接口，需：① MP 后台声明「收集你的昵称、头像」；② 首次调用微信自动弹官方协议，拒绝则 `showPrivacyError` 降级为「仅 openid 账号」。
- `agreement` 页面补充「登录即建立账号并存储 openid；完善资料即授权收集昵称、头像」说明。

### A4.6 安全要点（铁律）
- 只在云函数内用 `cloud.getWXContext().OPENID`，**绝不信任客户端 `event.openid`**。
- 所有「当前用户」写操作一律以云函数注入 OPENID 为准。
- OPENID 仅在「同一用户 + 同一 AppID」内唯一；跨端用 UNIONID（需绑开放平台）。

### A4.7 基础库版本
| 能力 | 最低基础库 |
|---|---|
| `chooseAvatar` / `input[type=nickname]` | 2.21.2 |
| 隐私接口默认拦截 | 2.32.3+ |
| **建议最低发布版本** | **3.0.0+** |

## A5 UI / 交互
- **MVP（静默登录）**：无登录按钮；`profile` 页「已绑定账号」显示 openid 后几位 + 绑定状态（接 `globalData.user`）。
- **Phase B 完善资料**（原 `getUserProfile` 路径已失效，必须改）：
  - 头像：`<button open-type="chooseAvatar" bind:chooseavatar>` → `e.detail.avatarUrl`（临时路径）→ `wx.cloud.uploadFile` 上传云存储 → `resolveCloudUrl` 转 HTTPS 持久存储。
  - 昵称：`<input type="nickname" bindblur>` → `e.detail.value`。
  - 头像/昵称分开获取、用户主动触发、需 §A4.5 隐私声明与同意。
  - 回写 `users.nickname` / `users.avatarUrl`，并与 `visitor_profiles` 的 L2/L3 自身记录打通。

## A6 实施分期
- **Phase A（MVP）**：新增 `users` 集合 + `getOpenId.ensureUser` 云函数（含 `DYNAMIC_CURRENT_ENV`、`unionid` 返回）+ `app.js` 的 `ensureUser()` + `onLaunch` 调用 + 8 个页面零散 `getOpenId()` 收敛为 `app.ensureUser()` + `profile` 状态接 `globalData.user`。
- **Phase B**：`users`/`visitor_profiles` 拆分迁移；`profile` 账号区 UI（chooseAvatar + nickname input，头像上传云存储）；下线 `getUserProfile`（profile/preview）。
- **Phase C**：`unionid` 多端打通、账号注销/数据导出。
- **发布前后台待办**：① MP 后台隐私指引新增「收集你的昵称、头像」；② 确认基础库最低 ≥ 3.0.0。

## A7 登录机制决策表（确认）
| 决策点 | 结论 |
|---|---|
| DU1 登录方式 | ✅ 静默登录（无按钮），基于 openid，零交互 |
| DU2 users 与 visitor_profiles 拆分 | ✅ 拆（Phase B） |
| DU3 ensureUser 放云函数还是客户端直写 | ✅ 云函数（鉴权更稳） |
| DU4 MVP 是否含「完善资料」UI | ✅ 不含（Phase B） |
| DU5 昵称/头像获取方式 | ✅ 头像昵称填写能力（chooseAvatar + nickname input），getUserProfile 已失效 |
| DU6 隐私声明 | ✅ 后台声明「收集你的昵称、头像」 |

---

# Part B：团队租户功能

> 来源：`artifacts/team-tenant-design.md` v0.4（D1–D12 全部确认）

## B1 需求拆解
| 编号 | 需求点 | 设计含义 |
|---|---|---|
| R1 | 支持团队租户 | 新增「团队」实体 + 成员关系 |
| R2 | 团队可管理成员名片的**部分信息** | 仅覆盖「组织字段」，个人字段仍归本人 |
| R3 | 可邀人进团队、可把人踢出 | 邀请机制 + 成员移除 |
| R4 | 个人建卡时可选择加入某团队 | 编辑页加「加入团队」入口 |
| R5 | 加入前提：知道名称/ID 或收到邀请 | 搜索加入 + 邀请加入 |

## B2 决策总览（全部确认）
| 决策 | 结论 |
|---|---|
| D1 一张名片可加入几个团队 | ✅ 多团队（card 可属多个 team） |
| D2 团队可管理的「部分信息」范围 | ✅ 仅组织字段：公司/部门/职位/公司电话/公司地址/公司网站/工作邮箱；统一头像/Logo v1 不做 |
| D3 按名称/ID 加入是否需审核 | ✅ 默认申请→管理员审核；团队可设「开放加入」免审 |
| D4 邀请形式 | ✅ 邀请码 + 微信分享卡片双形态 |
| D5 管理员模型 | ✅ v1 仅创建者=管理员 |
| D6 团队字段作用方式 | ✅ 覆盖层（override）模式：个人 card 为真相源，team_members.managedFields 叠加 |
| D7 团队特征呈现 | ✅ 轻量徽章（多团队并列）+ 无品牌色/Logo（主色 #3B82F6 文字胶囊）+ 分享图 v1 不接入 |
| D8 创建是否需先有名片 | ✅ 不强制（加入/托管时才需 card） |
| D9 单用户创建上限 | ✅ 默认 5（可配置 MAX_TEAMS_PER_USER） |
| D10 对外团队ID | ✅ 生成 shortId（6-8 位易读码） |
| D11 团队名唯一性/认证 | ✅ 均不做（v2 再加） |
| D12 创建查重 | ✅ 四层（L0 shortId 唯一 / L1 本人同名硬拦截 / L2 全网同名软提示 / L3 限流）+ 全量归一 |

## B3 数据模型（云数据库集合）

### B3.1 `teams`
```
{
  _id:          string,   // 内部ID（不直接对外）
  shortId:      string,   // 对外「团队ID」（6-8位易读码，唯一索引）
  name:         string,   // 不强制唯一，靠 shortId 区分
  ownerOpenId:  string,   // 创建者 openid（来自登录机制）
  description:  string,
  logoUrl:      string,   // v1 不做
  openJoin:     boolean,  // 默认 false（需审核）
  inviteEnabled:boolean,  // 默认 true
  memberCount:  number,   // 冗余计数
  createdAt:    number
}
```
索引：`shortId`（唯一）、`name`（模糊搜索）、`_id`。

### B3.2 `team_members`
```
{
  _id:          string,
  teamId:       string,
  memberOpenId: string,   // 来自登录机制
  cardId:       string,   // 对应个人名片ID
  role:         'owner' | 'member',
  status:       'pending' | 'active',
  invitedBy:    string,
  managedFields: {        // 仅 D2 所列组织字段
    company, department, position,
    companyPhone, companyAddress, companyWebsite, workEmail
  },
  isPrimary:    boolean,  // v2 分享图 Banner 用，v1 预留，默认首个加入 true
  joinedAt:     number
}
```
索引：`teamId + memberOpenId`（唯一）、`memberOpenId`（查「我加入的团队」）。

### B3.3 `team_invites`
```
{
  _id:        string,
  teamId:     string,
  code:       string,   // 短邀请码（唯一）
  token:      string,   // 分享卡片校验串
  createdBy:  string,
  expiresAt:  number,
  maxUses:    number,   // 0=不限
  usedCount:  number,
  singleUse:  boolean
}
```
索引：`code`（唯一）。

### B3.4 现有 `cards` 改动
- 新增可选字段 `teamIds: string[]`（冗余，便于查询；真相以 `team_members` 为准）。
- 无破坏迁移：旧名片 `teamIds` 默认空。

## B4 角色与权限
| 角色 | 权限 |
|---|---|
| 团队创建者 owner | 编辑成员团队字段、邀请、审核、踢人、改设置、解散/转让 |
| 成员 member | 加入/退出；编辑本人个人字段；团队字段在其编辑页只读 |
| 非成员 | 仅能搜索到团队 / 凭邀请码加入 |

所有写操作在云函数内做 openid 鉴权：管理员操作校验 `_openid === team.ownerOpenId`；成员操作校验其为 `team_members` 中 `active` 状态。

## B5 核心业务流程
- **路径 A（名称/ID 加入）**：加入团队 → 输入名称/ID → searchTeam → 申请加入 → requestJoin(写 pending) → 管理员 approve/reject（openJoin=true 则直接 active）。
- **路径 B（邀请加入）**：管理员 createInvite（code+token+过期/次数）→ 复制码或微信分享卡片（带 teamId+token）→ 用户打开 → joinByInvite（校验 token/过期/次数）→ 直接 active。
- **路径 C（建卡时加入）**：edit 页「加入团队」区块 → 搜索申请或粘贴邀请码 → 成功后 card.teamIds 追加。
- **管理成员**：成员列表 → member-edit（updateMemberFields 仅写 managedFields）→ removeMember（删关联，个人 card 不变）→ 邀请。
- **退出**：leaveTeam（删自身关联）。

## B6 云函数设计
新建 **`teamManager`** 云函数（单一函数 + `action` 路由，沿用 `initVisits` 风格）：
`createTeam / getTeam / getMyTeams / searchTeam / requestJoin / approveJoin / rejectJoin / createInvite / joinByInvite / revokeInvite / listMembers / updateMemberFields / removeMember / leaveTeam / transferOwnership(v2)`
每个 action 开头做权限校验；失败返回 `{ success:false, errCode, msg }`。

## B7 页面 / UI 规划
| 页面 | 作用 | 类型 |
|---|---|---|
| `pages/team/list` | 我的团队 + 创建/加入入口 | 新建 |
| `pages/team/create` | 创建团队 | 新建 |
| `pages/team/detail` | 团队管理（成员/邀请/设置） | 新建 |
| `pages/team/join` | 搜索名称/ID + 邀请码输入 | 新建 |
| `pages/team/member-edit` | 管理员编辑成员组织字段 | 新建 |
| `pages/edit` | 增加「加入团队」区块 | 改 |
| `pages/preview` | 展示团队标识 / 入口 | 改 |
| `pages/profile` | 增加「我的团队」入口 | 改 |
| `pages/agreement` | 补充团队数据使用说明 | 改 |

设计语言沿用现有体系：主色 `#3B82F6`、Georgia 衬线标题、4rpx 锐角、左侧品牌蓝装饰条。

## B8 团队特征呈现规范（D7）
| 场景 | 呈现 |
|---|---|
| 应用内预览（preview） | 姓名下方一排轻量徽章（pill），多团队并列；圆角小胶囊，#3B82F6 浅蓝底+深蓝字，仅团队名；点徽章进该团队「团队名片视图」 |
| 编辑页（edit） | 被托管字段前加小锁图标、输入禁用，下方提示「由 XX 团队管理」 |
| 分享图（Canvas v8） | v1 不接入，保持现状；团队 Banner 列入 v2 |
| 团队目录/详情 | 天然团队语境，完整展示 |

主展示团队：`team_members.isPrimary` 预留（默认首个加入 true），v2 接入，v1 不暴露设置 UI。

## B9 团队创建机制（§12 已确认）
- 任何已登录用户可建（依赖登录机制 openid）。
- 不强制先有名片；但托管组织字段需先有 card（加入/邀请环节校验 card 存在，否则提示「请先创建个人名片」）。
- 防刷配额：单用户 ≤ `MAX_TEAMS_PER_USER`（默认 5）。
- 命名不强制唯一，靠 shortId 区分；搜索结果展示 shortId+创建者昵称防误加；v1 不做认证标识。

### 创建流程（创建即成为管理员 + 首个成员）
```
createTeam({ name, description, openJoin, inviteEnabled })
  → 校验 name 非空 + 未超配额
  → 生成 shortId（查重直到唯一）
  → 写 teams（ownerOpenId, shortId, openJoin=false, inviteEnabled=true, memberCount=1）
  → 写 team_members（teamId, memberOpenId=creator, role='owner', status='active', isPrimary=true）
  → 返回 { teamId, shortId }
```

### 创建查重机制（D12，四层）
- **L0 shortId 唯一**：`do { gen } while (exists(shortId))`。
- **L1 本人同名硬拦截**：`ownerOpenId + normalize(name)` 已存在即拦，提示「已创建过同名团队，是否前往管理？」，不违反 D11。
- **L2 全网同名软提示（主防线）**：`team/create` 名称框 onInput 防抖 300ms → searchTeam(exact=true)，列出同名/近似（名称、shortId、创建者昵称、成员数），「查看/加入」或「仍要创建」二次确认。
- **L3 限流**：D9 配额 5 + 单 openid 5 分钟内 ≤2。
- **normalize**：去首尾空格、折叠内部空格、全角→半角、中文标点归一、统一小写比对（仅比对用，存储保留原样）。
- 实现：L0/L1/L3 在 `createTeam` 内；L1 需新增复合索引 `ownerOpenId+name`；L2 创建者昵称关联 `users`/`visitor_profiles`。

## B10 实施分期
- **Phase 1（MVP）**：创建团队、邀请码加入、成员列表、管理员编辑组织字段、踢人、退出、建卡时加入。
- **Phase 2**：名称/ID 搜索 + 审核流、多管理员、分享卡片团队 Banner。
- **Phase 3**：成员变动通知、团队公共目录、团队数据统计。

---

# Part C：统一实施计划（合并依赖）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **Phase A** | 快速登录 MVP：`users` 集合 + `getOpenId.ensureUser` + `app.ensureUser()` + 8 页收敛 + `profile` 接 `globalData.user` | 无 |
| **Phase 1** | 团队 MVP：3 集合 + `teamManager` 云函数 + 5 新页 + 4 改页 + 创建/查重机制 | 依赖 Phase A 的 openid 身份源 |
| **Phase B** | 登录资料完善（chooseAvatar/nickname，下线 getUserProfile）+ users/visitor_profiles 拆分 + L2 昵称打通 | 依赖 Phase A |
| **Phase 2** | 团队 名称/ID 搜索审核 + 多管理员 + 分享图 Banner | 依赖 Phase 1 + Phase B |
| **Phase 3** | 团队 通知/目录/统计；登录 unionid/注销 | 依赖以上 |

### 已完成的代码预处理（未提交 git，待本方案定稿后一并提交）
- P1：`STORAGE_BASE` 收敛为 `config/storage.js` 单一真源；`profile` 关于弹窗版本号动态化（`globalData.version`）。
- P2-a：替换 3 处弃用 `wx.getSystemInfoSync()`。
- `getOpenId` 缺 `DYNAMIC_CURRENT_ENV` 已并入 Phase A 的云函数改造一并处理。

---

# Part D：开放问题 / 待你最终拍板

1. **实施起点**：是否按「Phase A（登录）→ Phase 1（团队 MVP）」顺序推进？
2. **首版交付范围**：v1 是否就做到「团队 MVP（Phase 1）+ 登录 MVP（Phase A）」，把 `getUserProfile` 迁移（Phase B 资料完善 UI）留到下一轮？（我推荐：Phase A + Phase 1 先做，资料完善 UI 可暂缓，但 `getUserProfile` 死路径必须随 Phase B 尽早清，否则拿不到真昵称/头像。）
3. **资料完善 UI 是否纳入首版**：若希望用户在 v1 就能设昵称/头像，则需把 Phase B 的 chooseAvatar/nickname 一并做（额外约 1 个页面改造 + 云存储上传）。
4. 方案内容如与你记忆中的讨论有任何出入，请指出，我据此修正后再进入实现。

> 确认无误后，我将产出：接口字段定义、`users`/`teams`/`team_members`/`team_invites` 字段级定义、页面线框、`teamManager` 与 `getOpenId.ensureUser` 云函数伪代码、Phase A + Phase 1 实现清单与提交计划。
