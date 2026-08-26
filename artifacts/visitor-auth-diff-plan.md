# 访客授权披露 · 详细 Diff 方案（实施前审阅稿）

> 关联设计：`artifacts/visitor-auth-design.md`（含 D1–D5 决策）
> 状态：方案审阅中，未写代码 ｜ 日期：2026-08-26
> 说明：以下代码均为**示意骨架**，用于审阅逻辑与落点；落地时按实际行号调整。

---

## 0. 安全模型（D5，采用服务端卡片视图）

访客读卡不再客户端直连 `cards`，改走云函数 `getCardView`，**只回传可见字段**：
- `public` 字段：恒返回
- `authorized` 字段：仅 `isOwner` 或 `isAuthorized`（该访客存在 authorized 访问记录）时返回
- `private` 字段：永不返回给访客

→ 访客即使直连 db 也只能读到 `public` 字段（因授权字段根本不下发），分级真正生效。

`DEFAULT_FIELD_VISIBILITY`（新增常量，云函数与前端共享同一份定义）：
```
{ name:'public', position:'public', company:'public', phone:'authorized',
  email:'authorized', address:'authorized', wechatOfficial:'public',
  companyWebsite:'public', personalIntro:'public', businessIntro:'public',
  experiences:'public', attachments:'public' }
```
（`wechatOfficial` 是公众号关注链接，非私密联系方式，保持 public。）

---

## 1. 云函数 `cloudfunctions/initVisits/index.js`

### 1.1 顶部新增常量 + 辅助
```js
const DEFAULT_FIELD_VISIBILITY = { /* 见上 */ }
// 最小字段过滤：返回只含可见字段的 card 副本
function filterCardByVisibility(card, fv, isOwner, isAuthorized) {
  const out = { _id: card._id }
  if (isOwner) out._openid = card._openid
  for (const k of Object.keys(card)) {
    if (k === '_id' || k === '_openid') continue
    if (k === 'fieldVisibility') continue
    const vis = (fv && fv[k]) || DEFAULT_FIELD_VISIBILITY[k] || 'public'
    if (vis === 'public') out[k] = card[k]
    else if (vis === 'authorized' && (isOwner || isAuthorized)) out[k] = card[k]
    // private 或 未授权 authorized → 跳过
  }
  return out
}
```

### 1.2 `recordVisit` 改造（未授权不采集个人字段）
- L62–109 的 L2/L3 enrichment **整体移入**新逻辑：仅当 `authorized` 为真才 enrich 个人字段。
- 新增访问记录时 `authorized: false`，且 `visitorName/visitorAvatar/visitorPhone/visitorCompany/visitorPosition` 全置空、`visitorLevel: 1`。
- 返回中带 `authorized` 标记，供前端判断是否展示授权引导（替代现有 `visitorLevel<2` 判断，L70）。
- 30 分钟内复用逻辑保留，但 **不**用旧记录的个人字段回填（避免未授权访问"继承"已授权信息）。

### 1.3 新增 `getCardView` action
```js
case 'getCardView': {
  const { cardId } = data || {}
  if (!cardId || !OPENID) return { ok:false, message:'参数不完整' }
  const cardRes = await db.collection('cards').doc(cardId).get()
  const card = cardRes.data
  const isOwner = card._openid === OPENID
  const fv = card.fieldVisibility || null
  let isAuthorized = false
  let lockedFields = []
  if (!isOwner) {
    const v = await db.collection('visits')
      .where({ cardId, visitorOpenId: OPENID, authorized: true }).limit(1).get()
    isAuthorized = v.data.length > 0
    // 计算被锁字段（authorized 且当前不可见）
    for (const [k, vis] of Object.entries(fv || DEFAULT_FIELD_VISIBILITY)) {
      if (vis === 'authorized') lockedFields.push(k)
    }
  }
  const visible = filterCardByVisibility(card, fv, isOwner, isAuthorized)
  return { ok:true, card: visible, isOwner, isAuthorized,
           fieldVisibility: fv || DEFAULT_FIELD_VISIBILITY, lockedFields }
}
```

### 1.4 新增 `authorizeVisit` action
```js
case 'authorizeVisit': {
  const { cardId, nickname, avatarUrl } = data || {}
  if (!cardId || !OPENID) return { ok:false, message:'参数不完整' }
  const visitorOpenId = OPENID
  // 1) 写/更新 visitor_profiles（L2 身份）
  await db.collection('visitor_profiles').where({ openid: visitorOpenId })
    .limit(1).get().then(r => {
      if (r.data.length>0) return db.collection('visitor_profiles').doc(r.data[0]._id)
        .update({ data:{ nickname: nickname||'', avatarUrl: avatarUrl||'', authorizedAt: new Date() }})
      return db.collection('visitor_profiles').add({ data:{ openid: visitorOpenId,
        nickname: nickname||'', avatarUrl: avatarUrl||'', authorizedAt: new Date() }})
    })
  // 2) 找/建本次 visit 并标 authorized=true（复用 30min 逻辑）
  const now = new Date()
  const recent = await db.collection('visits').where({ cardId, visitorOpenId })
    .orderBy('visitTime','desc').limit(1).get()
  let visitId
  if (recent.data.length>0 && within30(recent.data[0].visitTime, now)) {
    visitId = recent.data[0]._id
    await db.collection('visits').doc(visitId).update({ data:{
      authorized:true, visitorName:nickname||'', visitorAvatar:avatarUrl||'',
      visitorLevel: Math.max(recent.data[0].visitorLevel||1, 2), visitTime:now }})
  } else {
    const cardRes = await db.collection('cards').doc(cardId).get()
    const r = await db.collection('visits').add({ data:{
      cardId, cardOwnerId: cardRes.data._openid||'', visitorOpenId,
      authorized:true, visitorName:nickname||'', visitorAvatar:avatarUrl||'',
      visitorLevel:2, visitTime:now, visitCount:1, actions:[],
      cardName: cardRes.data.name||'', source:'authorized' }})
    visitId = r._id
  }
  // 3) 返回授权后可见字段（同 getCardView 过滤，isAuthorized=true）
  const cardRes = await db.collection('cards').doc(cardId).get()
  const visible = filterCardByVisibility(cardRes.data, cardRes.data.fieldVisibility, false, true)
  return { ok:true, authorized:true, card: visible, lockedFields: [] }
}
```

### 1.5 列表查询尊重 `authorized`
- `getRecentVisitors` / `getMyVisitorDashboard`：返回前对每个 visit，若 `authorized !== true`，将 `visitorName/visitorPhone/visitorCompany/visitorPosition` 置为占位（如空串或「访客 #XXXX」由前端拼），仅保留 openid 后 4 位作为匿名标识。

### 1.6 旧 visits 祖父（D3）
- 一次性脚本/或查询时兜底：将**无 `authorized` 字段**的旧记录视为 `authorized=true`（它们已存个人字段）。推荐：上线时跑一次
  `db.collection('visits').where({ authorized: _.exists(false) }).update({ data:{ authorized:true } })`（注意分页，参考 LOG-02 的 removeAll 模式）。

> **部署影响**：initVisits 改动须**重新上传部署**。

---

## 2. 前端 `miniprogram/pages/edit/index.js`（P1）

### 2.1 data 新增默认值
```js
fieldVisibility: { ...DEFAULT_FIELD_VISIBILITY },  // 新卡默认
```
（DEFAULT 从共享模块 `../../config/cardVisibility` 引入，与云函数常量保持一致。）

### 2.2 `loadCard` 回填
读取现有卡片时：`this.setData({ fieldVisibility: card.fieldVisibility || defaultFV })`。

### 2.3 `saveCard` 写入
在 L392–408 的 `data` 对象中加入：
```js
fieldVisibility: this.data.fieldVisibility,
```

### 2.4 可见性切换 handler（新增）
```js
onVisibilityChange(e) {
  const { field, value } = e.currentTarget.dataset  // value: 'public'|'authorized'|'private'
  this.setData({ [`fieldVisibility.${field}`]: value })
}
```

---

## 3. 前端 `miniprogram/pages/edit/index.wxml`（P1）

在 `phone` / `email` / `address` 三个联系字段右侧（L100–135 区块），各加一个三态选择器：
```xml
<view class="visibility-picker">
  <text class="vp-label">可见性</text>
  <view class="vp-opts">
    <text class="vp-opt {{fieldVisibility.phone==='public'?'on':''}}"
          data-field="phone" data-value="public" bindtap="onVisibilityChange">公开</text>
    <text class="vp-opt {{fieldVisibility.phone==='authorized'?'on':''}}"
          data-field="phone" data-value="authorized" bindtap="onVisibilityChange">授权后</text>
    <text class="vp-opt {{fieldVisibility.phone==='private'?'on':''}}"
          data-field="phone" data-value="private" bindtap="onVisibilityChange">仅自己</text>
  </view>
</view>
```
（`email`/`address` 同理；`wechatOfficial` 可选加。）

---

## 4. 前端 `miniprogram/pages/preview/index.js`（P2 + D2 + D5）

### 4.1 `loadCard` 改走 `getCardView`
原 L118 `wx.cloud.database().collection('cards').doc(id).get()` 替换为云函数调用：
```js
wx.cloud.callFunction({
  name:'initVisits', data:{ action:'getCardView', data:{ cardId:id } },
  success: res => {
    const r = res.result || {}
    this.setData({
      card: r.card || {},        // 已是服务端过滤后的可见字段
      isOwner: r.isOwner,
      isAuthorized: r.isAuthorized,
      lockedFields: r.lockedFields || [],
      fieldVisibility: r.fieldVisibility || {}
    })
  }
})
```
（owner 路径同样走 getCardView，返回全字段，行为不变。）

### 4.2 授权弹窗 + 原生授权（D1）
data 加 `showAuthModal:false`。CTA 触发：
```js
showAuthModal() { this.setData({ showAuthModal:true }) },
onChooseAvatar(e) {        // 微信原生头像授权
  this.setData({ authAvatar: e.detail.avatarUrl })
},
onNicknameInput(e) { this.setData({ authNickname: e.detail.value }) },
confirmAuth() {            // 调 authorizeVisit
  const { id, authNickname, authAvatar } = this.data
  wx.cloud.callFunction({
    name:'initVisits', data:{ action:'authorizeVisit',
      data:{ cardId:id, nickname:authNickname, avatarUrl:authAvatar } },
    success: res => {
      const r = res.result || {}
      if (r.ok) {
        this.setData({ card:r.card, isAuthorized:true, lockedFields:[],
                      showAuthModal:false })
        wx.showToast({ title:'已解锁完整名片', icon:'success' })
      }
    }
  })
}
```
> 原生授权合规：头像用 `<button open-type="chooseAvatar" bind:chooseavatar="onChooseAvatar">`；昵称用 `<input type="nickname" bind:change="onNicknameInput">`（微信原生昵称 picker）。复用 `account/index.wxml` 既有模式。

### 4.3 授权引导判定
原 L70 `_checkAuthBanner()` 触发条件由 `visitorLevel<2` 改为 `!isAuthorized`（由 getCardView 返回）。

---

## 5. 前端 `miniprogram/pages/preview/index.wxml`（P2 + D2）

- 现有 `card.phone`/`card.email`/`card.address`/`card.wechatOfficial` 等渲染**保持不变**——因为它们现在来自 `getCardView` 返回的 `card`，服务端已按可见性过滤，**未授权访客根本拿不到这些字段**，自然不显示（D2 漏洞由此修复）。
- 新增"锁定占位"区（仅当 `lockedFields.length>0` 且非 owner 时显示）：
```xml
<view class="locked-section" wx:if="{{!isOwner && lockedFields.length>0}}">
  <view class="lock-item" wx:for="{{lockedFields}}" wx:key="*this">
    <text class="lock-icon">🔒</text>
    <text class="lock-text">登录后查看{{fieldLabel[item]}}</text>
  </view>
  <button class="auth-cta" bindtap="showAuthModal">登录查看完整名片</button>
</view>
```
- 新增授权弹窗（modal）：含 `open-type="chooseAvatar"` 按钮 + `type="nickname"` 输入框 + 确认按钮（`bindtap="confirmAuth"`）。

---

## 6. 前端 `miniprogram/pages/visitors/index.js` + `index.wxml`（P4）

### 6.1 `_processVisitors`（L122–145 附近）
- 若 `v.authorized`：保留现有 `name/phone/company/position/avatar` 展示。
- 若 `!v.authorized`：`name` 改为 `'访客 #' + (v.visitorOpenId||'').slice(-4).toUpperCase()`，`phone/company/position` 置空（避免显示占位空串），`avatar` 置默认头像。
- 新增 `authorized: v.authorized || false` 字段供 wxml 徽章。

### 6.2 `index.wxml`（L73 已有 `visitorLevel===2 → 已授权`）
- 改为按 `item.authorized` 显示「已授权 / 未授权（匿名）」徽章。
- 可选：顶部加「全部 / 已授权 / 未授权」分段筛选（改动 `loadVisitors` 的查询条件加 `authorized` 过滤）。

---

## 7. 共享常量模块（新增）

`miniprogram/config/cardVisibility.js`：
```js
module.exports = {
  DEFAULT_FIELD_VISIBILITY: { name:'public', position:'public', company:'public',
    phone:'authorized', email:'authorized', address:'authorized',
    wechatOfficial:'public', companyWebsite:'public', personalIntro:'public',
    businessIntro:'public', experiences:'public', attachments:'public' },
  FIELD_LABELS: { phone:'电话', email:'邮箱', address:'地址', wechatOfficial:'微信', /* ... */ }
}
```
（云函数侧常量需同步一份——或抽成云函数可 require 的 `cloudfunctions/initVisits/visibility.js`，避免两处漂移。）

---

## 8. 改动文件清单 + 部署影响

| 文件 | 类型 | 部署影响 |
|------|------|----------|
| `cloudfunctions/initVisits/index.js` | 云函数（recordVisit/getCardView/authorizeVisit/列表） | **须重部署** |
| `miniprogram/pages/edit/index.js` | 前端 | 热重载 |
| `miniprogram/pages/edit/index.wxml` | 前端 | 热重载 |
| `miniprogram/pages/preview/index.js` | 前端 | 热重载 |
| `miniprogram/pages/preview/index.wxml` | 前端 | 热重载 |
| `miniprogram/pages/visitors/index.js` | 前端 | 热重载 |
| `miniprogram/pages/visitors/index.wxml` | 前端 | 热重载 |
| `miniprogram/config/cardVisibility.js` | 新增前端模块 | 热重载 |
| `cloudfunctions/initVisits/visibility.js`（可选） | 新增云函数模块 | 随 initVisits 部署 |

**风险/注意**：
1. `getCardView` 替换 `preview` 直连 db，是核心数据路径变更，需充分自测（owner 编辑、访客浏览、授权前后）。
2. D3 旧数据祖父脚本上线时执行一次，须分页（参考 LOG-02）。
3. 字段常量前后端各一份，须同步（建议抽共享模块）。
4. 微信 `getUserProfile` 已废弃，授权走 `chooseAvatar` + `nickname` input，符合当前合规。
