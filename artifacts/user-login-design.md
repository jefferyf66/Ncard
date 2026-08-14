# Ncard 用户快速登录（基于 openid）机制设计方案

> 状态：v0.2（已对照微信官方文档核验，2026-08-14）
> 背景：代码审计确认当前**无用户管理机制**，身份仅靠各页面按需调用 `app.getOpenId()` 取 openid，且 `visitor_profiles` 被客串为用户档案。本文设计一套基于微信 openid 的「快速登录」机制，并已在 v0.2 对照官方文档做了可行性 + 最优性核验与修正。

---

## 1. 现状审计结论（已代码核实）

| 项 | 现状 |
|---|---|
| 用户集合 | **无 `users` 集合**；无注册/登录/登出/session |
| 身份来源 | 各页面按需 `app.getOpenId()`（→`getOpenId` 云函数→`cloud.getWXContext().OPENID`），缓存 `globalData._openId` |
| 调用时机 | **分散、非统一**；不在 `onLaunch` 触发 |
| 用户档案 | `visitor_profiles` 客串：存 `themeColor`/`isDefault`/昵称/头像，但语义是「访客目录（L2/L3）」 |
| 登录入口 | `profile` 页有「已绑定账号/请登录」文案，**无真正登录按钮**（仅样式，无 `bindtap`） |
| ⚠️ 既有缺陷 | `profile/index.js` 的 `onAuthUserInfo` 与 `preview/index.js` 仍用 `wx.getUserProfile` 取昵称头像——**该接口已于 2022-10-25 起被收回**，新版本只会返回灰色头像 +「微信用户」，当前功能已事实失效，须随本方案一并迁移（见 §5 / §8） |
| 隐私门控 | `__usePrivacyCheck__: true`；首次隐私接口调用微信自动弹官方隐私协议；`showPrivacyError` 处理 103/104 |

**结论**：当前只有「按需取 openid」，没有用户管理。用户判断是否成立——**确实没有账户体系**。

---

## 2. 设计目标

1. 提供「快速登录」：用户**无感建立账号**（基于 openid），无需按钮/授权即可标识身份。
2. 建立规范的 `users` 用户档案，替代散落的 openid 调用与 `visitor_profiles` 客串。
3. 完全合规：登录动作本身**不触发**隐私弹窗（仅取 openid，属免授权接口）；昵称/头像收集走独立「完善资料」分支，受用户主动操作 + 隐私同意门控。

---

## 3. 为什么用 openid（方案可行性的官方依据）

- 在微信云开发里，**云函数调用时微信会自动注入可信 `OPENID`/`APPID`/`UNIONID`**：
  > 微信云开发：当小程序端调用云函数时，云函数的传入参数中会被注入小程序端用户的 openid…开发者无需校验 openid 的正确性，因为微信已经完成了这部分鉴权，开发者可以直接使用该 openid。

  官方云开发文档明确指出：`cloud.getWXContext()` 即可取得**天然可信**的登录态，`OPENID` 由微信注入而非客户端提交，因此**无需 `wx.login()` 取 code、无需 `auth.code2Session`、无需自行签发业务 Token**——这是云开发相对「独立后端」方案在身份链路上最省、最稳的形态。
- 同一用户同一 AppID 下 `OPENID` 稳定不变；获取**无需用户授权**（与 `getUserProfile` 不同）。
- 因此「快速登录」可做到**静默**：启动即建立，零交互、零打扰。
- 昵称/头像属于「资料完善」，**非登录必需**，放可选分支。

---

## 4. 机制设计

### 4.1 `ensureUser()`（核心，应用级身份初始化）

- **位置**：`app.js` 新增方法；在 `onLaunch` 的 `initCloud()` 之后调用（失败不阻塞应用）。
- **流程（已按云开发最优形态精简）**：
  1. 直接 `wx.cloud.callFunction({ name: 'getOpenId' })` —— **不需要先调 `wx.login()`**，云函数在被调用时由微信自动注入 `OPENID`。
  2. 云端 `cloud.getWXContext().OPENID` 取身份（只读可信上下文，绝不读 `event.openid`）。
  3. 云端按 openid `upsert` `users`（`_openid` 作为主键）：首次写 `registeredAt`，每次更新 `lastLoginAt`。
  4. 返回用户档案；客户端缓存到 `globalData.user` + `wx.setStorage`。
- **隐私**：**本步不触发**隐私弹窗（取 openid 属免授权接口，云函数调用本身不在隐私接口清单内）。用户无感知。

### 4.2 `users` 集合 Schema

```
{
  _openid:        string,   // 微信自动注入（= openid，作主键）
  unionid:        string,   // 多端打通用（可选，满足条件下才返回）
  nickname:       string,   // 可选，资料完善后填（头像昵称填写能力）
  avatarUrl:      string,   // 可选，cloud:// 或 HTTPS（上传后）
  themeColor:     string,   // 从 visitor_profiles 迁移（Phase B）
  defaultCardId:  string,   // 从 visitor_profiles 迁移（Phase B）
  registeredAt:   number,
  lastLoginAt:    number
}
```
索引：`_openid`（主键，唯一，系统自带）。

### 4.3 与 `visitor_profiles` 的关系（关键决策）

- **现状混淆**：`visitor_profiles` 既存「访客目录」又存「我的设置」。
- **建议拆分（Phase B）**：
  - `users`：我的账号（openid、设置、我的资料）
  - `visitor_profiles`：仅「谁来访问过我」（L2/L3 目录），不再承担我的设置
- **不阻塞 MVP**：Phase A 仅新增 `users` + `getOpenId.ensureUser`；`themeColor`/`isDefault` 迁移后续做。

### 4.4 云函数

- **改造 `getOpenId` 云函数**（沿用现有单一函数风格，新增 `action: 'ensureUser'`），在**云端用 openid upsert `users`**——鉴权最稳，避免客户端伪造 `_openid`。
- 同时补 `cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })`（此前缺失，P2 遗留项），保证多环境一致性。
- 额外返回 `unionid`（若当前绑定开放平台则返回，供 Phase C 多端打通）。

### 4.5 隐私合规（昵称/头像分支才需要）

- **登录（取 openid）本身免授权**，不弹隐私窗；沿用 `__usePrivacyCheck__: true` 即可。
- **完善资料（昵称/头像）是隐私接口**，需满足两项：
  1. **小程序后台《用户隐私保护指引》必须声明「收集你的昵称、头像」**（否则真机会报 `chooseAvatar:fail api scope is not declared in the privacy agreement`）。→ 须列入发布前待办（见 §6）。
  2. 首次调用时微信自动弹官方隐私协议，用户同意后方可使用 `chooseAvatar`；拒绝则 `showPrivacyError` 处理 103/104，降级为「仅 openid 账号」。
- 在 `agreement` 页面补充「登录即建立账号并存储 openid；完善资料即授权收集你的昵称、头像」说明。

### 4.6 安全要点（云开发身份链路铁律）

- **只在云函数内使用 `cloud.getWXContext().OPENID`**，绝不信任客户端 `event.openid`（客户端可伪造 `event.openid` 字段，但无法伪造注入的 `OPENID`）。
- 所有需要「当前用户」的写操作（建团队、成员托管、名片写入）一律以云函数注入的 `OPENID` 为准。
- `OPENID` 仅在「同一用户 + 同一 AppID」内唯一；跨 App/公众号打通用 `UNIONID`（需绑定微信开放平台）。

### 4.7 基础库版本要求

| 能力 | 最低基础库 | 说明 |
|---|---|---|
| 头像昵称填写能力（`chooseAvatar` / `input[type=nickname]`） | 2.21.2 | 低于此仅能走已失效的 `getUserProfile`（已不可用） |
| 隐私接口默认拦截（强制隐私授权） | 2.32.3+ | 高于此默认开启隐私门控 |
| **建议最低发布版本** | **3.0.0+** | 全面覆盖上述能力，避免碎片化 |

---

## 5. UI / 交互（昵称/头像——已按官方「头像昵称填写能力」重写）

- **MVP（静默登录）**：无登录按钮。`profile` 页「已绑定账号」改为显示 openid 后几位 + 绑定状态（接 `globalData.user`）。
- **Phase B — 完善资料（关键，原 `getUserProfile` 路径已失效，必须改）**：
  - **头像**：用 `<button open-type="chooseAvatar" bind:chooseavatar="onChooseAvatar">`，回调 `e.detail.avatarUrl` 为**临时本地路径**，须 `wx.cloud.uploadFile` 上传至云存储，再经 `resolveCloudUrl` 转为 HTTPS 持久地址存储；基础库 2.24.4+ 若图片未过安全监测则不触发 `bindchooseavatar`。
  - **昵称**：用 `<input type="nickname" bindblur="onNickNameBlur">`，键盘上方弹出微信昵称候选，`e.detail.value` 取值；2.24.4+ 在 `blur` 异步安全检测，未过则清空，建议用 `form` + `form-type="submit"` 的按钮收集。
  - 头像/昵称**分开获取、用户主动触发**，不可通过 API 静默拿取，且需 §4.5 的隐私声明与同意。
  - 回写 `users.nickname` / `users.avatarUrl`，并与 `visitor_profiles` 的 L2/L3 自身记录打通（自身查看优先读 `users`）。

---

## 6. 实施分期

- **Phase A（MVP，建议先做）**：新增 `users` 集合 + `getOpenId.ensureUser` 云函数（含 `DYNAMIC_CURRENT_ENV`、`unionid` 返回）+ `app.js` 的 `ensureUser()` + `onLaunch` 调用 + 8 个页面零散 `getOpenId()` 调用收敛为 `app.ensureUser()` + `profile` 状态接 `globalData.user`。
- **Phase B**：`users` / `visitor_profiles` 拆分迁移；`profile` 账号区 UI（chooseAvatar + nickname input，头像上传云存储）；下线既有 `getUserProfile` 调用（profile/preview）。
- **Phase C**：`unionid` 多端打通、账号注销 / 数据导出（合规）。
- **发布前后台待办**：① MP 后台隐私指引新增「收集你的昵称、头像」；② 确认基础库最低版本 ≥ 3.0.0。

---

## 7. 待确认决策

| 决策点 | 推荐 | 说明 |
|---|---|---|
| **DU1 登录方式** | ✅ 静默登录（无按钮） | 基于 openid，零交互 |
| **DU2 users 与 visitor_profiles 是否拆分** | ✅ 拆（Phase B） | 澄清职责混淆 |
| **DU3 ensureUser 放云函数还是客户端直写** | ✅ 云函数 | 鉴权更稳，风格统一 |
| **DU4 MVP 是否含「完善资料」UI** | ✅ 不含（Phase B） | MVP 只建身份 |
| **DU5 昵称/头像获取方式** | ✅ 头像昵称填写能力（`chooseAvatar` + `nickname` input） | **官方现唯一可用路径**；`getUserProfile` 已失效 |
| **DU6 隐私声明** | ✅ 后台声明「收集你的昵称、头像」 | `chooseAvatar` 前置条件 |

---

## 8. 官方文档核验结论与方案修正（用户要求「确保可行并最优」）

**核验渠道**（2026-08-14）：微信开放社区公告、微信云开发 capabilities / `guide/functions/userinfo` 文档、微信小程序隐私授权实践。

### 8.1 结论：方案可行且已调整到最优

- **核心可行**：云开发 `cloud.getWXContext().OPENID` 是官方推荐的轻量身份机制，天然可信、免授权、免 token，完美匹配「快速登录」诉求。
- **两处修正（均已纳入上文）**：
  1. **删除冗余 `wx.login()` 步骤**：云函数被调用时微信已注入 `OPENID`，客户端无需 `wx.login()` 取 code、无需 `code2Session`、无需自定义 Token。原 v0.1 流程中的「② wx.login()」属画蛇添足，已移除 → 链路更短、更稳。
  2. **`wx.getUserProfile` 已失效，必须改用「头像昵称填写能力」**：该接口自 2022-10-25（延至 11-08）起被收回，新版本只会返回灰色头像 +「微信用户」。原方案中「资料缺失则调 `getUserProfile`」**不可行**，已重写为 `chooseAvatar` 按钮 + `nickname` 输入框，并明确头像需上传云存储、昵称需隐私声明。

### 8.2 最优性要点

- **静默登录零打扰**：取 openid 属免授权接口，**不触发**隐私弹窗；隐私同意只在用户主动「完善资料」时出现，符合微信「减少强迫授权」的合规导向。
- **身份可信不伪造**：openid 由微信注入云函数上下文，所有写操作以注入值而非客户端传值为准。
- **兼容存量**：上线后用户冷启动自动 `upsert users`，无迁移成本；既有 `getUserProfile` 死路径随 Phase B 一并清理。

> 确认后产出：接口字段定义（`getOpenId.ensureUser` 入参/出参）、`users` 字段级定义、云函数伪代码、Phase A 实现清单。
