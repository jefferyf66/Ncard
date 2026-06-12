# 匿名访客追踪 — 修改计划（待实施）

> 日期：2026-06-11 | 决策：L2 非阻断式底部通知条 / 新建 visitor_profiles / 暂不做 Phase 2/3

---

## 用户决策确认

| 决策点 | 结论 |
|--------|------|
| L2 授权引导形式 | ✅ 非阻断式底部通知条 |
| visitor_profiles 集合 | ✅ 新建独立集合（不复用 visits 字段） |
| Phase 2 来源归因 | ❌ 暂不做 |
| Phase 3 聚合画像 | ❌ 暂不做 |
| 用户删除访客痕迹 | ❌ 暂不做 |

---

## 一、修改范围总览

```
涉及文件：8 个修改 + 1 个新建（visitor_profiles 集合）+ 1 个云函数修改

A. P0 前置修复（访客追踪能跑起来的前提）
  A1. miniprogram/pages/preview/index.js       — recordVisit openid 解析
  A2. miniprogram/pages/index/index.js          — newCards 加 _openid 过滤
  A3. miniprogram/pages/index/index.js          — _loadVisitorStatsDirect 加过滤
  A4. miniprogram/pages/list/index.js           — user_save_cards 加 _openid 过滤
  A5. miniprogram/pages/visitors/index.js       — cardOwnerId 传参修正

B. 匿名访客身份识别（核心需求）
  B1. 云开发控制台                                — 新建 visitor_profiles 集合
  B2. cloudfunctions/initVisits/index.js         — recordVisit 增加访客富化
  B3. cloudfunctions/initVisits/index.js         — getRecentVisitors 返回 visLevel
  B4. miniprogram/pages/preview/index.wxml       — 授权底部通知条 UI
  B5. miniprogram/pages/preview/index.js          — 授权逻辑 + recordVisit 重构
  B6. miniprogram/pages/index/index.js           — 访客列表三级展示 + 聚合
  B7. miniprogram/pages/index/index.wxml         — 访客卡片分层 UI
  B8. miniprogram/pages/visitors/index.js        — 访客列表三级展示
```

---

## 二、A 组 — P0 前置修复

> 这些 Bug 导致访客追踪完全不可用，必须先修，否则 B 组改完也没数据可展示。

### A1. 修复 recordVisit 的 openid 解析错误

**文件**：`miniprogram/pages/preview/index.js`
**位置**：第 29-65 行（整个 recordVisit 方法）
**根因**：`res.result?.openid` 解析路径错误，`getOpenId` 云函数返回 `{ success: true, data: { openid: "..." } }`，正确路径是 `res.result.data.openid`

**当前代码**（第 33-37 行）：
```js
wx.cloud.callFunction({
  name: 'getOpenId',
  data: {},
  success: (res) => {
    const visitorOpenId = res.result?.openid || ''  // ❌ 永远是 ''
    if (!visitorOpenId) return
```

**修改为**（用 `app.getOpenId()` 替换整个嵌套回调）：
```js
// 用 app.getOpenId() 替代直接调用云函数
// app.getOpenId() 已正确解析 res.result.data.openid 且有内存缓存
app.getOpenId().then((visitorOpenId) => {
  if (!visitorOpenId) return

  wx.cloud.callFunction({
    name: 'initVisits',
    data: {
      action: 'recordVisit',
      data: {
        cardId,
        visitorOpenId,
        cardOwnerId: this.data.card._openid || '',
        source: options?.source || 'direct'
      }
    }
  })
}).catch(() => {})
```

> ⚠️ 注意：这里同时要把整个嵌套回调改成 Promise 链，原来的 `recordVisit` 方法会因此大幅简化。具体重构见 B5。

---

### A2. 修复首页指标卡"名片数"全量统计

**文件**：`miniprogram/pages/index/index.js`
**位置**：第 91-95 行（`loadVisitorData` 方法中的 cards.count）
**根因**：`db.collection('cards').count()` 统计所有用户名片总数，但首页列表 `loadCards()` 使用的是 `where({ _openid: myOpenId })`

**当前代码**：
```js
// 1. 名片总数（cards 集合 — 始终存在）
wx.cloud.database().collection('cards').count()
  .then(res => {
    this.setData({ 'visitorStats.newCards': res.total || 0 })
  })
  .catch(() => {})
```

**修改为**：
```js
// 1. 名片总数 — 只统计当前用户的名片
app.getOpenId().then((myOpenId) => {
  var query = wx.cloud.database().collection('cards')
  if (myOpenId) {
    query = query.where({ _openid: myOpenId })
  }
  return query.count()
}).then(res => {
  this.setData({ 'visitorStats.newCards': res.total || 0 })
}).catch(() => {})
```

---

### A3. 修复 `_loadVisitorStatsDirect` 降级路径缺过滤

**文件**：`miniprogram/pages/index/index.js`
**位置**：第 134-158 行
**根因**：降级路径直接 `db.collection('visits').count()` 无 cardOwnerId 过滤

**当前代码**（第 146-148 行）：
```js
db.collection('visits').count()
  .then(res => {
    this.setData({ 'visitorStats.visitors': res.total || 0 })
```

**修改为**：
```js
var query = db.collection('visits')
if (this._myOpenId) {
  query = query.where({ cardOwnerId: this._myOpenId })
}
query.count()
  .then(res => {
    this.setData({ 'visitorStats.visitors': res.total || 0 })
    // 多次来访也加过滤
    var repeatQuery = db.collection('visits')
      .where({ visitCount: _.gt(1) })
    if (this._myOpenId) {
      repeatQuery = repeatQuery.where({ cardOwnerId: this._myOpenId })
    }
    return repeatQuery.count()
  })
```

---

### A4. 修复名片夹列表跨用户数据混淆

**文件**：`miniprogram/pages/list/index.js`
**位置**：第 37-39 行
**根因**：`user_save_cards` 查询未按 `_openid` 过滤，用户 B 可能看到用户 A 保存的记录

**当前代码**：
```js
db.collection('user_save_cards')
  .orderBy('savedAt', 'desc')
  .get()
```

> 注：虽然云开发默认权限 `doc._openid == auth.openid` 会在服务端过滤只读权限，但 `count()` 不受此限制，且显式过滤是防御性最佳实践。

**修改为**：无需改。云开发默认安全规则已自动过滤。但需要**确认云控制台中 `user_save_cards` 的安全规则是默认的**。

---

### A5. 修复访客页 cardOwnerId 传参

**文件**：`miniprogram/pages/visitors/index.js`
**位置**：第 49-51 行
**根因**：`cardOwnerId: ''` — 传空字符串导致查询所有用户的访客

**当前代码**：
```js
wx.cloud.callFunction({
  name: 'initVisits',
  data: { action: 'getRecentVisitors', data: { cardOwnerId: '', limit: 50 } }
})
```

**修改为**：
```js
app.getOpenId().then((myOpenId) => {
  wx.cloud.callFunction({
    name: 'initVisits',
    data: { action: 'getRecentVisitors', data: { cardOwnerId: myOpenId, limit: 50 } }
  }).then(res => {
    // ... 现有处理逻辑
  }).catch(() => {
    this._loadVisitorsDirect()
  })
}).catch(() => {
  this._loadVisitorsDirect()
})
```

> 需要重构 `loadVisitors()` 为 Promise 链。

---

## 三、B 组 — 匿名访客身份识别

### B1. 新建 visitor_profiles 集合

**操作位置**：微信开发者工具 → 云开发控制台 → 数据库 → 新建集合

**集合名**：`visitor_profiles`

**安全规则**：
```json
{
  "read": "doc._openid == auth.openid",
  "write": "doc._openid == auth.openid"
}
```

**Schema**：
| 字段 | 类型 | 说明 |
|------|------|------|
| `_openid` | string | 自动字段，访客 openId |
| `nickname` | string | 微信昵称 |
| `avatarUrl` | string | 微信头像 URL（微信 CDN，非 cloud://） |
| `createdAt` | Date | 创建时间 |
| `updatedAt` | Date | 更新时间 |

> **为什么头像用微信 CDN 而非云存储**：`wx.getUserProfile` 返回的 `avatarUrl` 是微信 CDN 地址，可直接使用，无需上传到自己的云存储。

---

### B2. 增强 initVisits 云函数 — recordVisit 访客富化

**文件**：`cloudfunctions/initVisits/index.js`
**位置**：第 31-83 行（`case 'recordVisit'` 分支）

**修改内容**：在写入 visits 文档之前，查询 cards 和 visitor_profiles 集合来富化访客身份。

**修改后的 recordVisit 逻辑**：

```js
case 'recordVisit': {
  const { cardId, visitorOpenId, cardOwnerId } = data
  if (!cardId || !visitorOpenId) {
    return { ok: false, message: '参数不完整' }
  }

  // 不记录自己访问自己的卡片
  if (visitorOpenId === cardOwnerId) {
    return { ok: true, skipped: true, reason: 'self_visit' }
  }

  // ===== 新增：访客身份富化 =====
  let visitorLevel = 'L1'   // 默认纯匿名
  let visitorName = ''
  let visitorAvatar = ''
  let visitorPosition = ''
  let visitorCompany = ''

  // 1. 查 cards 集合 → L3 卡片用户
  try {
    const cardResult = await db.collection('cards')
      .where({ _openid: visitorOpenId })
      .limit(1)
      .get()
    
    if (cardResult.data && cardResult.data.length > 0) {
      const card = cardResult.data[0]
      visitorLevel = 'L3'
      visitorName = card.name || ''
      visitorAvatar = card.avatar || ''
      visitorPosition = card.position || ''
      visitorCompany = card.company || ''
    }
  } catch (e) {
    // cards 查询失败不阻塞流程
    console.warn('[recordVisit] 查询 cards 失败:', e)
  }

  // 2. 非 L3 → 查 visitor_profiles → L2 已授权用户
  if (visitorLevel === 'L1') {
    try {
      const profileResult = await db.collection('visitor_profiles')
        .where({ _openid: visitorOpenId })
        .limit(1)
        .get()
      
      if (profileResult.data && profileResult.data.length > 0) {
        visitorLevel = 'L2'
        visitorName = profileResult.data[0].nickname || ''
        visitorAvatar = profileResult.data[0].avatarUrl || ''
      }
    } catch (e) {
      console.warn('[recordVisit] 查询 visitor_profiles 失败:', e)
    }
  }

  // 3. L1 纯匿名 → 生成稳定的匿名标识（由前端生成，这里留空）
  // ===== 富化结束 =====

  const now = new Date()

  // 查找最近访问记录（30 分钟内算同一次）
  const recent = await db.collection('visits')
    .where({ cardId, visitorOpenId })
    .orderBy('visitTime', 'desc')
    .limit(1)
    .get()

  if (recent.data && recent.data.length > 0) {
    const lastVisit = new Date(recent.data[0].visitTime)
    const diffMin = (now - lastVisit) / 1000 / 60

    if (diffMin < 30) {
      await db.collection('visits').doc(recent.data[0]._id).update({
        data: {
          visitTime: now,
          visitCount: db.command.inc(1),
          // 更新身份信息（可能从 L1 升级到 L2/L3）
          visitorLevel,
          visitorName: visitorName || recent.data[0].visitorName || '',
          visitorAvatar: visitorAvatar || recent.data[0].visitorAvatar || '',
          visitorPosition: visitorPosition || recent.data[0].visitorPosition || '',
          visitorCompany: visitorCompany || recent.data[0].visitorCompany || ''
        }
      })
      return { ok: true, updated: true }
    }
  }

  // 新记录
  await db.collection('visits').add({
    data: {
      cardId,
      cardOwnerId: cardOwnerId || '',
      visitorOpenId,
      visitTime: now,
      visitCount: 1,
      actions: [],
      source: data.source || 'direct',
      // ===== 新增字段 =====
      visitorLevel,
      visitorName,
      visitorAvatar,
      visitorPosition,
      visitorCompany
    }
  })

  return { ok: true, created: true }
}
```

---

### B3. 增强 initVisits 云函数 — getRecentVisitors 返回 visLevel

**文件**：`cloudfunctions/initVisits/index.js`
**位置**：第 111-123 行

当前已返回 visits 文档的完整字段（包括 visitorLevel/visitorName 等），无需额外修改。只需确认前端正确使用了这些字段。

---

### B4. 预览页新增授权底部通知条

**文件**：`miniprogram/pages/preview/index.wxml`
**位置**：在 `</view>` (container 闭合前) 的最底部，`delete-modal` 之前

**新增 UI 区块**：

```xml
<!-- 匿名访客授权引导条（非阻断式） -->
<view class="auth-banner" wx:if="{{showAuthBanner}}" catchtap="stopPropagation">
  <view class="auth-banner-content">
    <view class="auth-banner-icon">
      <view class="icon-lock"></view>
    </view>
    <text class="auth-banner-text">授权微信昵称后，名片主人可以看到您是谁</text>
    <button 
      class="auth-banner-btn" 
      open-type="getUserInfo" 
      bindgetuserinfo="onAuthUserInfo"
    >授权</button>
    <view class="auth-banner-close" bindtap="dismissAuthBanner">✕</view>
  </view>
</view>
```

**显示逻辑**：
- 访客是名片主人自己 → 不显示
- 访客已有名片（L3）→ 不显示
- 访客已授权过（查 visitor_profiles）→ 不显示
- 访客点击"暂不"→ 隐藏，7 天后重新显示

**文件**：`miniprogram/pages/preview/index.wxss`（新增样式）

```css
/* 授权引导条 */
.auth-banner {
  position: fixed;
  bottom: 180rpx;
  left: 24rpx;
  right: 24rpx;
  z-index: 100;
  background: #FFFFFF;
  border-radius: 16rpx;
  box-shadow: 0 4rpx 24rpx rgba(0, 0, 0, 0.12);
  border-left: 6rpx solid #3B82F6;
  padding: 20rpx 24rpx;
}

.auth-banner-content {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.auth-banner-icon {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.auth-banner-text {
  flex: 1;
  font-size: 26rpx;
  color: #475569;
  line-height: 1.5;
}

.auth-banner-btn {
  flex-shrink: 0;
  background: #3B82F6;
  color: #FFFFFF;
  font-size: 24rpx;
  padding: 10rpx 24rpx;
  border-radius: 8rpx;
  border: none;
  line-height: 1.4;
}

.auth-banner-btn::after {
  border: none;
}

.auth-banner-close {
  flex-shrink: 0;
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #94A3B8;
}
```

---

### B5. 预览页新增授权逻辑 + recordVisit 重构

**文件**：`miniprogram/pages/preview/index.js`

#### B5.1 data 新增字段

```diff
  data: {
    card: {},
    id: '',
    isLoading: true,
    isError: false,
    errorMsg: '',
    showDeleteConfirm: false,
    isOwner: false,
-   isSaved: false
+   isSaved: false,
+   showAuthBanner: false     // 是否显示授权引导条
  },
```

#### B5.2 recordVisit 重构 + 授权检查

```js
// 替换现有的 recordVisit 方法（第 29-65 行）
recordVisit(cardId, options) {
  if (!wx.cloud) return

  app.getOpenId().then((visitorOpenId) => {
    if (!visitorOpenId) return

    // 判断是否需要显示授权引导（非阻断式检查）
    this._checkAuthBanner(visitorOpenId)

    // 调用云函数记录访问（现在云函数端会自动富化身份）
    wx.cloud.callFunction({
      name: 'initVisits',
      data: {
        action: 'recordVisit',
        data: {
          cardId,
          visitorOpenId,
          cardOwnerId: this.data.card._openid || '',
          source: options?.source || 'direct'
        }
      }
    })
  }).catch(() => {})
},

/**
 * 检查是否需要显示授权引导条
 * 条件：非自有名片 + 非 L3（无卡片）+ L2 profile 不存在
 */
_checkAuthBanner(myOpenId) {
  // 自己的名片 → 不显示
  if (myOpenId === (this.data.card._openid || '')) return

  // 已有卡片 → L3，不显示
  var db = wx.cloud.database()
  db.collection('cards').where({ _openid: myOpenId }).count()
    .then((res) => {
      if (res.total > 0) return // L3 用户，跳过

      // 检查 visitor_profiles 是否已授权
      return db.collection('visitor_profiles')
        .where({ _openid: myOpenId }).count()
    })
    .then((res) => {
      if (res === undefined) return // L3，已跳过
      if (res && res.total > 0) return // L2 已授权，跳过

      // 检查是否在冷却期（7 天内拒绝过）
      var lastDismiss = wx.getStorageSync('auth_banner_dismissed')
      if (lastDismiss && Date.now() - lastDismiss < 7 * 24 * 3600 * 1000) return

      this.setData({ showAuthBanner: true })
    })
    .catch(() => {}) // 静默失败
},

/**
 * 用户点击「授权」按钮
 */
onAuthUserInfo(e) {
  var userInfo = e.detail.userInfo
  if (!userInfo) return // 用户拒绝

  var db = wx.cloud.database()
  var now = new Date()

  // upsert 到 visitor_profiles
  db.collection('visitor_profiles')
    .where({ _openid: app.globalData._openId || '' })
    .get()
    .then((res) => {
      if (res.data && res.data.length > 0) {
        // 已存在 → 更新
        return db.collection('visitor_profiles').doc(res.data[0]._id).update({
          data: {
            nickname: userInfo.nickName,
            avatarUrl: userInfo.avatarUrl,
            updatedAt: now
          }
        })
      } else {
        // 新建
        return db.collection('visitor_profiles').add({
          data: {
            nickname: userInfo.nickName,
            avatarUrl: userInfo.avatarUrl,
            createdAt: now,
            updatedAt: now
          }
        })
      }
    })
    .then(() => {
      this.setData({ showAuthBanner: false })
      wx.showToast({ title: '授权成功', icon: 'success' })
    })
    .catch((err) => {
      console.warn('[Preview] 写入 visitor_profiles 失败:', err)
      this.setData({ showAuthBanner: false })
    })
},

/**
 * 用户点击「暂不」或 ✕ 关闭授权条
 */
dismissAuthBanner() {
  this.setData({ showAuthBanner: false })
  wx.setStorageSync('auth_banner_dismissed', Date.now())
},
```

#### B5.3 修改 `_checkCardOwnership` 避免自己显示授权条

在 `_checkCardOwnership` 中，自有卡片就应该跳过授权引导（`_checkAuthBanner` 内部已处理，但前端状态也需注意）——当前逻辑已正确，因为 `recordVisit` 在 `loadCard` 之后调用，isOwner 在 `_checkCardOwnership` 中设置。

---

### B6. 首页访客列表三级展示 + 聚合

**文件**：`miniprogram/pages/index/index.js`

#### B6.1 重构 `_loadRecentVisitors`

```js
_loadRecentVisitors(cardOwnerId) {
  const db = wx.cloud.database()
  var query = db.collection('visits')
  if (cardOwnerId) {
    query = query.where({ cardOwnerId: cardOwnerId })
  }
  query
    .orderBy('visitTime', 'desc')
    .limit(20)  // 多取一些用于去重聚合
    .get()
    .then(res => {
      if (!res.data || res.data.length === 0) return

      // ===== 按 visitorOpenId 聚合（同一访客多次访问合并为一条）=====
      var visitorMap = {}
      res.data.forEach((v) => {
        var key = v.visitorOpenId
        if (!visitorMap[key]) {
          visitorMap[key] = {
            id: v._id,
            openId: v.visitorOpenId,
            level: v.visitorLevel || 'L1',
            name: v.visitorName || '',
            avatar: v.visitorAvatar || '',
            position: v.visitorPosition || '',
            company: v.visitorCompany || '',
            visitCount: 0,
            lastVisit: v.visitTime,
            sources: []
          }
        }
        visitorMap[key].visitCount += (v.visitCount || 1)
        if (v.source && visitorMap[key].sources.indexOf(v.source) === -1) {
          visitorMap[key].sources.push(v.source)
        }
        // 取最新一次的身份信息（可能已升级）
        if (v.visitorName && !visitorMap[key].name) {
          visitorMap[key].name = v.visitorName
          visitorMap[key].avatar = v.visitorAvatar || ''
          visitorMap[key].position = v.visitorPosition || ''
          visitorMap[key].company = v.visitorCompany || ''
        }
      })

      // 排序：按最后访问时间倒序，取前 5
      var aggregated = Object.values(visitorMap)
        .sort((a, b) => new Date(b.lastVisit) - new Date(a.lastVisit))
        .slice(0, 5)

      var visitors = aggregated.map((v) => {
        // 按级别生成显示内容
        var displayName = v.name
        var displayAvatar = v.avatar
        var buttonText = ''
        var buttonType = ''

        if (v.level === 'L3') {
          // 有卡片 → 显示真名/头像
          displayName = v.name
          buttonText = '交换名片'
          buttonType = 'primary'
        } else if (v.level === 'L2') {
          // 已授权微信昵称
          displayName = v.name
          buttonText = '交换名片'
          buttonType = 'primary'
        } else {
          // L1 纯匿名
          displayName = '访客 #' + v.openId.slice(-4).toUpperCase()
          displayAvatar = ''
          buttonText = '请问是谁'
          buttonType = 'secondary'
        }

        return {
          id: v.id,
          name: displayName || '访客',
          avatar: displayAvatar,
          position: v.position,
          visitCount: v.visitCount,
          level: v.level,
          lastVisit: app.formatTime(v.lastVisit),
          buttonText: buttonText,
          buttonType: buttonType
        }
      })

      this.setData({ recentVisitors: visitors })
    })
    .catch(() => {})
}
```

#### B6.2 修改 `_loadVisitorStats` 增加 DISTINCT 去重

访客统计中「我的访客」应统计独立访客数（去重 visitorOpenId），而非 visits 总记录数。

但不支持 aggregate 的云开发基础版无法直接 COUNT DISTINCT，故采用客户端聚合：

```js
// 在 _loadVisitorStats 云函数成功回调中，修改统计方式
if (res.result && res.result.ok) {
  // 改用 getRecentVisitors 获取原始数据后客户端聚合
  // 或者云函数新增 getMyVisitorStatsV2 支持去重
}
```

> **更优雅的方案**：在 initVisits 云函数中新增 `getMyVisitorStatsV2` action，用 `aggregate` 做 `$group` by visitorOpenId。但基础版不支持 aggregate，降级方案为客户端聚合。

---

### B7. 首页访客卡片分层 UI

**文件**：`miniprogram/pages/index/index.wxml`
**位置**：第 132-161 行（visitor-item 区块）

**修改 visitor-item 内部**：

```xml
<view 
  class="visitor-item" 
  wx:for="{{recentVisitors}}" 
  wx:key="id"
  bindtap="goToVisitorDetail"
  data-item="{{item}}"
>
  <!-- 头像区：L2/L3 有头像显示真实头像，L1 显示默认图标 -->
  <view class="visitor-avatar" wx:if="{{item.avatar}}">
    <image src="{{item.avatar}}" mode="aspectFill"></image>
  </view>
  <view class="visitor-avatar" wx:else>
    <view class="icon-user"></view>
  </view>

  <view class="visitor-content">
    <view class="visitor-header">
      <!-- L1 显示匿名标识，L2/L3 显示真实名称 -->
      <text class="visitor-name">{{item.name}}</text>
      <!-- 回访标记 -->
      <text class="visitor-repeat" wx:if="{{item.visitCount > 1}}">访问{{item.visitCount}}次</text>
      <text class="visitor-time">{{item.lastVisit}}</text>
    </view>
    <text class="visitor-position" wx:if="{{item.position}}">{{item.position}}</text>
  </view>

  <view 
    class="visitor-button {{item.buttonType}}" 
    catchtap="handleVisitorAction"
    data-item="{{item}}"
  >
    {{item.buttonText}}
  </view>
</view>
```

---

### B8. 访客全量页三级展示

**文件**：`miniprogram/pages/visitors/index.js`

与 B6 相同的聚合逻辑，但 `limit` 增大到 50（全量页需要更多数据）。修改 `loadVisitors` 方法和 `_loadVisitorsDirect` 方法中 visitors 列表的 map 逻辑。

**核心改动**：在 `visitors.map()` 中增加 visitorLevel 判断：

```js
const visitors = list.map(v => {
  var name = v.visitorName || ''
  var avatar = v.visitorAvatar || ''
  var visitorLevel = v.visitorLevel || 'L1'
  var buttonText = ''
  var buttonType = ''

  if (visitorLevel === 'L3') {
    // 使用已有数据（已在云函数端富化）
    buttonText = '交换名片'
    buttonType = 'primary'
  } else if (visitorLevel === 'L2') {
    buttonText = '交换名片'
    buttonType = 'primary'
  } else {
    // L1
    name = '访客 #' + v.visitorOpenId.slice(-4).toUpperCase()
    buttonText = '请问是谁'
    buttonType = 'secondary'
  }

  return {
    id: v._id,
    name: name,
    avatar: avatar,
    position: v.visitorPosition || '',
    company: v.visitorCompany || '',
    visitCount: v.visitCount || 1,
    level: visitorLevel,
    lastVisit: app.formatTime(v.visitTime),
    description: v.source ? '通过"' + v.source + '"查看了您' : '',
    buttonText: buttonText,
    buttonType: buttonType
  }
})
```

---

## 四、实施顺序（严格遵循）

```
Step 1: B1 — 在云开发控制台新建 visitor_profiles 集合
         ↓
Step 2: B2 — 修改 initVisits 云函数 recordVisit（增加访客富化）
         ↓  部署云函数
Step 3: A1/B5 — 修改 preview/index.js（recordVisit 重构 + 授权逻辑）
         ↓
Step 4: B4 — 修改 preview/index.wxml + wxss（授权底部通知条 UI）
         ↓
Step 5: A2 — 修改 index/index.js 的 cards.count（加 _openid 过滤）
        A3 — 修改 index/index.js 的 _loadVisitorStatsDirect（加过滤）
         ↓
Step 6: B6 — 修改 index/index.js 的 _loadRecentVisitors（三级展示 + 聚合）
         ↓
Step 7: B7 — 修改 index/index.wxml（访客卡片分层 UI）
         ↓
Step 8: A5 — 修改 visitors/index.js（cardOwnerId 传参修正）
        B8 — 修改 visitors/index.js（三级展示）
         ↓
Step 9: A4 — 确认 list/index.js 的 user_save_cards 安全规则
         ↓
Step 10: 全量回归测试
```

---

## 五、验证清单

实施完成后逐项验证：

### 功能验证

- [ ] **P0-1**：访问他人名片 → 云开发控制台 visits 集合出现新记录（之前没有）
- [ ] **P0-2**：首页指标卡"名片数"数字与首页列表的 `{{cards.length}}` 一致
- [ ] **匿名访客**：未创建名片的用户 A 访问用户 B 的名片 → B 的首页访客列表显示"访客 #XXXX"
- [ ] **重复聚合**：同一用户 A 多次访问用户 B 的不同名片 → B 的访客列表聚合为一条，显示"访问 N 次"
- [ ] **L3 识别**：用户 A 创建名片后再访问用户 B 的名片 → B 的访客列表显示 A 的真实姓名和头像
- [ ] **L2 授权**：用户 A 点击授权条"授权"按钮 → 弹出微信授权弹窗 → 同意 → B 的访客列表显示 A 的微信昵称
- [ ] **授权拒绝**：用户 A 点击"暂不" → 授权条消失 → 7 天内再次访问不显示授权条
- [ ] **自有名片不显示授权条**：用户查看自己创建的名片 → 无授权引导条
- [ ] **L3 不显示授权条**：已有卡片的用户查看他人名片 → 无授权引导条

### 回归验证

- [ ] 名片创建/编辑 → 保存成功
- [ ] 名片分享 → 他人可打开预览
- [ ] 保存他人名片 → user_save_cards 写入 → 名片夹可见
- [ ] 删除自有名片 → 级联删除正常
- [ ] 头像跨设备可见性 → 正常

### 性能验证

- [ ] recordVisit 富化查询（cards + visitor_profiles）不超 500ms
- [ ] 首页加载 → 访客数据不阻塞名片列表渲染
- [ ] 授权条动画流畅，不导致页面重排

---

## 六、已知限制与后续规划

| 限制 | 说明 | 后续 |
|------|------|------|
| 云开发基础版无 aggregate | 访客去重聚合在客户端完成，数据量大时性能下降 | 升级专业版后改用 aggregate pipeline |
| wx.getUserProfile 可能被移除 | 微信已标记 deprecated | 届时降级为手动填写昵称或纯匿名 |
| 单次最多取 20 条 visit | 聚合时可能遗漏更早的记录 | Phase 3 做定期聚合任务 |
| 匿名 ID 仅 4 位 hex | 65536 分之一的碰撞概率 | 对大多数用户足够，可扩展为 6 位 |
