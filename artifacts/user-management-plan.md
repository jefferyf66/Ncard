# Ncard 用户管理体系 · 细化方案（待拍板）

> 范围：在已确认的方案 A（小程序内 owner 管理 + 用户自助）基础上，细化 **用户名 / 昵称 / 与微信用户关系** 三大模糊点，形成可实施的字段模型、同步流程与决策清单。代码实施待拍板后启动。

---

## 一、与微信用户的关系（身份根基）

- **唯一身份 = 微信 OPENID**：Ncard 是微信小程序，登录即 `cloud.getWXContext().OPENID`，**无密码、无独立账号体系**。所以"一个用户"本质上就是"一个微信身份"。
- **OPENID vs UNIONID**：
  - `OPENID`：同一主体下、同一小程序内唯一。Ncard 单小程序，用 OPENID 足以唯一定位。
  - `UNIONID`：同微信开放平台下跨小程序 / 公众号 / App 统一标识。若未来做公众号或 App，需 UNIONID 打通。
  - **建议现在就存 UNIONID**（零成本、为跨端预留），但不作为当前登录主键。
- **关键事实（最易被忽略）**：`getWXContext()` 只返回 `OPENID / APPID / UNIONID`，**绝不返回昵称、头像**。因此现有 `users` 记录里的 `nickname / avatarUrl` 创建时是空串——我们目前**并没有真正拿到微信昵称**。要拿昵称/头像，必须由用户**主动授权**（头像用 `button open-type="chooseAvatar"`，昵称用 `<input type="nickname">`），这是微信 2022 年后的合规要求（不再静默获取）。
- **结论**：微信关系 = "以 OPENID 为锚 + 可选的用户主动授权资料"。任何"云端自动拉微信昵称"的假设都是错的。

---

## 二、用户名 / 昵称 / 真实姓名 三者厘清

这是当前最易混淆处，先明确定义：

| 概念 | 是什么 | 是否登录凭证 | 来源 | 唯一性 |
|---|---|---|---|---|
| **OPENID** | 微信身份锚 | ✅ 唯一可信身份 | 服务端 `getWXContext` | 全局唯一 |
| **用户名 username** | 可选展示用 handle（如 `@kepler`） | ❌ 否 | 用户自设 | 建议唯一（可选，V2） |
| **昵称 nickname** | 主显示名 | ❌ 否 | 微信授权 / 手填 | 否 |
| **真实姓名 realName** | 名片用真名 | ❌ 否 | 用户填（名片场景强需） | 否 |

**建议姿态**：
- **不引入"登录用 username"**：小程序无密码登录，username 不是凭证，引入只增复杂度与唯一索引负担。OPENID 即账号。
- **nickname 作主显示名**：首次在「账号设置」经微信授权按钮填充（`chooseAvatar` + nickname input），允许随时改。
- **username handle 取舍**：若名片/邀请场景需要"可记忆标识"，可加一个**非必填、可空的展示 handle**，不绑定登录。建议 **V1 不做**，避免唯一索引负担；V2 按需。
- **realName 关键**：Ncard 是名片应用，名片上的名字来自哪里？应明确：名片姓名默认取自 `users.realName`（名片场景更可能是真名），昵称作备选。建议 `users` 加 `realName` 字段供名片预填，与 nickname 区分。

---

## 三、users 集合字段模型（细化）

```
users: {
  // 身份层
  _openid:   string   // 唯一索引（控制台建）
  unionid:   string   // 跨端预留
  appid:     string

  // 资料层
  nickname:  string   // 显示名, 微信授权或手填
  avatarUrl: string   // chooseAvatar 获取
  realName:  string   // 名片真名(预填)

  // 设置层（已有）
  themeColor:    string
  defaultCardId: string

  // 账号层
  username:  string        // V2 可选 handle, 暂空
  role:     'root'|'admin'|'user'
  status:   'active'|'deleted'
  loginCount: number
  registeredAt:  number
  lastLoginAt:   number
  updatedAt:     number
  deletedAt:     number
}
```

- **僵尸判定**：`lastLoginAt` 距今天数 > 30，或 `lastLoginAt === registeredAt`（仅注册未回流）。
- **统计排除**：所有计数/列表过滤 `status:'deleted'`。

---

## 四、微信资料同步流程（关键交互）

- **首次 / 任意时刻**：账号设置页提供「使用微信头像昵称」按钮 → 调 `chooseAvatar` 拿头像、`<input type="nickname">` 拿昵称 → 写 `users`（新云函数 `accountManager.updateMyProfile`）。
- **不静默获取**：绝不在 `onLaunch` 拉昵称（违规且拿不到）。
- **名片联动**：用户改 `nickname / realName` 后，名片编辑页应可"从账号同步"一键预填。

---

## 五、自助 (L1) 与 后台 (L2) 字段对齐

- **自助页可见/可改**：nickname、avatarUrl、realName、导出、注销。
- **后台可见（root/admin）**：以上 + OPENID、unionid、registeredAt、lastLoginAt、loginCount、role、status、所属团队数。
- **后台可操作（权限分层）**：
  - root：改 role、转 root（事务）、软删、解散/转让团队。
  - admin：看用户/团队、解散/转让团队、看统计；**不可**改 role / 转 root。
- **鉴权红线不变**：所有 admin/account 云函数服务端以 `getWXContext().OPENID` 判定身份与权限，绝不信任客户端传入的身份/目标；关键操作写 `admin_audit_log`。

---

## 六、待你拍板的决策点（Checklist）

1. 是否接受「OPENID 即账号、不引入登录 username」？ → 建议：**是**
2. nickname 来源：微信授权（chooseAvatar / nickname input）优先 + 可手改，还是纯手填？ → 建议：**微信授权优先 + 可手改**
3. realName 是否进 `users` 并用于名片预填？ → 建议：**是（名片强需）**
4. V1 是否要 username handle？ → 建议：**不做，V2 再说**
5. 名片姓名默认取自 nickname 还是 realName？ → 建议：**realName，昵称作备选**
6. UNIONID 现在就存还是以后？ → 建议：**现在就存（零成本）**

---

## 七、拍板后实施路线（预览，非本次执行）

1. 新增 `accountManager` 云函数：`getMyProfile / updateMyProfile / exportMyData / requestDeleteAccount / confirmDeleteAccount`（全部以调用方 OPENID 限定自身）。
2. 新增 `adminManager` 云函数：`getUserStats / listUsers / getUserDetail / listTeams / setUserRole / transferRoot(事务) / disbandTeam`。
3. `users` 加字段（realName / role / status / loginCount / updatedAt / deletedAt / username 预留）+ 控制台建 `_openid` 唯一索引 + `config` 种子 root。
4. 前端：账号设置页（含微信授权同步）、管理后台页、转让 root 弹层。
5. **重新部署 `getOpenId`**（使 P1 修复生效）+ 部署两个新云函数。
6. 本地提交（保持「先不推」），待你确认再推 + 打 tag。
