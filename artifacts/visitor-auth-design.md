# 访客授权披露方案设计（Visitor Authorization Disclosure）

> 版本：设计稿 v0.1 ｜ 日期：2026-08-26 ｜ 状态：待拍板
> 关联：initVisits.recordVisit（三级访客体系 L1/L2/L3）、v1.4.0 用户账号体系、teamManager.cardSchema（团队字段配置参考）

---

## 一、需求本质：双向互换披露（Quid-pro-quo）

| 角色 | 动作 | 对价 |
|------|------|------|
| 主人 | 分享名片 | 公开内容（任何访客可见） |
| 主人 | 把部分字段标为「客户授权内容」 | 访客登录/授权后才可见 |
| 访客 | 登录/授权 | 解锁主人授权内容 **+** 自己的身份信息回写进主人访客列表 |

一次授权动作同时解锁两侧：访客看主人授权字段、主人看访客真实信息。

---

## 二、现状与缺口（已读码确认）

1. **访客无字段遮蔽**：`preview/index.wxml` 直接渲染 `card.phone/email/wechatOfficial`（L46-51 等），无 `isOwner` 之外的访客级 gate。→ 当前访客能看到主人全部联系方式，分级形同虚设。
2. **无个人名片字段级可见性**：个人 `cards` 仅有 `publicSettings`（板块级显隐，如 showExperiences），无「逐字段 public/authorized/private」配置。团队有 `cardSchema`，但设计文档明确「不引入逐字段公开开关」。
3. **访客信息被动采集**：`initVisits.recordVisit` 每次按 L2/L3 把访客 name/phone/company 自动写入 `visits`，无授权环节 —— 隐私反模式，本次翻转为「授权才采集」。

---

## 三、数据模型设计

### 3.1 `cards` 增加字段级可见性 `fieldVisibility`
在每张名片文档加对象，逐敏感字段标记等级：
```
fieldVisibility: {
  phone:   'public' | 'authorized' | 'private',
  email:   'authorized',
  wechat:  'public',
  address: 'authorized',
  // 其余字段未配置时按默认（见决策4）
}
```
- `public`：任何访客可见
- `authorized`：客户授权内容，访客登录/授权后可见
- `private`：仅自己可见，不渲染给任何人

**兼容性**：未配置的字段默认 `public`（保持现有行为，避免存量名片突变）。

### 3.2 `visits` 增加授权标记 `authorized`
```
authorized: false   // 访客是否已授权/登录
```
- 未授权：仅存 `visitorOpenId + visitTime + cardId + source + visitCount`；**不存** visitorName/phone/company（未授权不采集，GDPR 式最小收集）
- 授权后：补 enrich 个人字段（复用现有 L2/L3 逻辑）

### 3.3 访客授权态（复用 `visitor_profiles`）
访客首次授权时写/更新 `visitor_profiles`（openid + nickname + avatarUrl + authorizedAt），作为 L2 身份源。

---

## 四、流程设计

### 4.1 访客打开分享（preview 页）
1. `onLoad → loadCard(id)`
2. 前端按 `card.fieldVisibility` 把字段分 `public` / `authorized` 两组
3. 公开组直接渲染；授权组渲染为「🔒 登录后查看」占位 + CTA
4. 调 `recordVisit`（此时 `authorized=false`，仅记 openid 级）

### 4.2 访客点「登录查看」（授权事件）
1. 触发登录/授权（语义见决策1）
2. 调新 action `authorizeVisit`（或 `recordVisit` 加 `authorized:true` 参数）
3. 云函数：标记该 visit `authorized=true`，按 L2/L3 enrich，回传授权组内容
4. 前端解锁渲染授权组

### 4.3 主人访客列表
- 未授权访客：显示「访客 #XXXX」（openid 后 4 位），无真实信息
- 已授权访客：显示 name/phone/company（现有逻辑）
- 可选筛选「已授权 / 未授权」

---

## 五、实施分阶段（已锁定决策）

- **P1 字段分级配置**
  - `cards` 加 `fieldVisibility`（默认见 D4：phone/email/address 等敏感字段 `authorized`，其余 `public`）
  - `edit` 页加可见性配置 UI（每字段 public / authorized / private 三态，新卡按 D4 预填）
  - 旧卡：不回溯写 fieldVisibility（未配置按 default `public`，D4 仅约束**新卡**）；主人可手动调
- **P2 访客视图分级 + 授权云函数 + 漏洞修复（D2）**
  - `preview` 按 `fieldVisibility` 分级渲染；**访客遮蔽 authorized/private 字段**（D2，修复全字段泄露）
  - 授权组渲染「🔒 登录后查看」占位 + CTA → 触发**微信原生授权弹窗**（D1）
  - 新 `initVisits.authorizeVisit`：标记 `visit.authorized=true` + 按 L2/L3 enrich + 回传授权内容
- **P3 采集收敛**
  - `recordVisit` 未授权 **不采集** 个人字段（仅存 openid 级数据）
  - 旧 visits **祖父 authorized=true**（D3，可一次性 update 脚本，或查询时兜底）
  - `getRecentVisitors` / `getMyVisitorDashboard` 尊重 `authorized`（未授权返回占位，不返回个人字段）
- **P4 访客列表分级展示**：`visitors` 页按授权态展示（未授权「访客 #XXXX」）+ 可选「已授权/未授权」筛选

---

## 六、关键决策点（✅ 已拍板，2026-08-26）

- **D1 登录语义 → 微信小程序原生用户弹窗授权**：访客点「授权」触发微信原生用户授权弹窗（昵称/头像 consent，对应 `button open-type` + `wx.getUserProfile` 体系），授权后写 `visitor_profiles`（nickname + avatarUrl + authorizedAt）。本质是轻量授权 B 的原生实现，无需独立账号；已注册投贴儿用户（有 card）自动升级 L3 全卡信息。
- **D2 访客全字段漏洞 → 一并修**：preview 访客视图按 `fieldVisibility` 遮蔽 `authorized`/`private` 字段，否则分级形同虚设。
- **D3 旧 visits 历史数据 → 祖父为已授权**：旧记录标记 `authorized=true`（已共享过），新访问才按新模型收敛，不丢历史。
- **D4 默认可见性 → 敏感字段默认 authorized**：新卡 phone/email/address 等默认 `authorized`（需登录才看），主人可手动改 `public`；其余字段未配置默认 `public`（向后兼容存量）。
- **D5 安全模型（diff 规划中浮现，待确认）→ 推荐服务端卡片视图**：现状 `preview.loadCard` 客户端直连 `db.collection('cards').doc(id).get()`，说明 `cards` 对访客可读。若仅在 WXML 按 `fieldVisibility` 隐藏，访客仍能用 db 查询拿全量授权字段 → 分级失效。故访客读卡须改走服务端云函数 `getCardView(cardId, visitorOpenId)`，按 `fieldVisibility` **只返回可见字段**（公开恒返；授权字段仅已授权访客返；private 永不返）。替代"软遮蔽"模式（仅前端隐藏）不安全，不推荐。

---

## 七、影响面与风险

- **云函数**：`initVisits`（recordVisit/authorizeVisit + 列表查询须尊重 authorized 标记）→ 改完须重部署
- **前端**：`preview`（分级渲染 + CTA）、`edit`（可见性配置）、`visitors`（分级展示 + 筛选）
- **数据**：旧 `visits` 迁移决策（D3）、旧 `cards` 默认可见性（D4）
- **隐私**：D2 修复同时是安全加固（防主人联系方式对访客全暴露）
