# Ncard 代码审查报告

> 审查日期：2026-06-11 | 审查范围：首页指标卡 + 预览页删除按钮

---

## 审查任务一：首页名片数据指标卡排查

### 1.1 数据结构概览

首页底部「名片数据」区域展示三个指标卡：

| 指标 | 绑定字段 | WXML 位置 |
|------|----------|-----------|
| 我的访客 | `visitorStats.visitors` | line 102 |
| 多次来访 | `visitorStats.viewed` | line 112 |
| 名片数 | `visitorStats.newCards` | line 122 |

数据均由 `loadVisitorData()` 方法负责加载（`pages/index/index.js:88`），每次 `onShow` 触发。

---

### 1.2 "名片数"指标 — 完整数据链路追踪

#### 链路 Step 1：`onShow()` 触发入口 (line 77-86)

```javascript
onShow() {
    const lastUpdate = app.getCache('lastCardUpdate')
    const now = Date.now()
    if (!lastUpdate || now - lastUpdate > 300000) {
        this.loadCards(true)          // 名片列表：有条件刷新（5分钟过期）
    }
    this.loadVisitorData()            // 指标卡：每次 onShow 无条件刷新
}
```

#### 链路 Step 2：`loadVisitorData()` (line 88-100)

```javascript
loadVisitorData() {
    if (!wx.cloud) return

    // 1. 名片总数（cards 集合 — 始终存在）
    wx.cloud.database().collection('cards').count()   // 🔴 全量 count
      .then(res => {
        this.setData({ 'visitorStats.newCards': res.total || 0 })
      })
      .catch(() => {})

    // 2. 访客统计
    this._loadVisitorStats()
}
```

#### 链路 Step 3：数据库查询

```
db.collection('cards').count()
    → 无 where 条件，无 _openid 过滤
    → 返回 cards 集合中 ALL 文档的 total
```

#### 对比：首页名片列表 `loadCards()` (line 200-244)

```javascript
app.getOpenId().then((myOpenId) => {
    var query = collection
        .orderBy('createTime', 'desc')
        .skip(currentPage * pageSize)
        .limit(pageSize)
        .where({ _openid: myOpenId })    // ✅ 按当前用户过滤
    query.get() → 返回当前用户的名片
})
```

#### 🔴 Bug #1 (P0 — 严重数据不一致)

**根因**：`visitorStats.newCards` 使用 `db.collection('cards').count()` **全量统计所有用户名片总数**，而首页卡片列表 `loadCards()` 使用 `where({ _openid: myOpenId })` **仅显示当前用户名片**。

**影响**：
- 多用户环境下，指标卡名片数 ≫ 实际可见名片数
- 例如：3 个用户各创建 2 张名片 → 指标卡显示 6，但每个用户只能看到 2 张
- WXML 标题行 `{{cards.length}} 张名片`（line 5）显示的是真实值，与指标卡数字矛盾

**缓存影响**：`loadCards()` 有 10 分钟缓存（`app.setCache('cardsCache', cards, 600000)`），`visitorStats.newCards` 每次 `onShow` 都实时查询。即使增加 `_openid` 过滤，两者也可能因缓存时效差异短暂不一致，但数值级別不会出错。

**修复方向**：
```javascript
// 修复前
db.collection('cards').count()

// 修复后 — 传入当前用户 openId
app.getOpenId().then(myOpenId => {
    var query = db.collection('cards')
    if (myOpenId) query = query.where({ _openid: myOpenId })
    return query.count()
}).then(res => {
    this.setData({ 'visitorStats.newCards': res.total || 0 })
})
```

---

### 1.3 "我的访客"指标 — 数据来源与统计口径

#### 云函数路径（主路径，line 102-131）

```
loadVisitorData()
  → _loadVisitorStats()
    → app.getOpenId() 获取 myOpenId
    → initVisits 云函数 (action: 'getMyVisitorStats', data: { cardOwnerId: myOpenId })
      → db.collection('visits')
          .where({ cardOwnerId })         // 仅当前用户名片
          .count()
      → 返回 visitors: totalResult.total
```

**统计口径**：所有访问过"当前用户创建的任一名片"的访客记录总数。

#### 降级路径（line 134-158）

```javascript
_loadVisitorStatsDirect() {
    db.collection('visits').count()       // 🔴 全量 count，无 cardOwnerId 过滤
      .then(res => {
        this.setData({ 'visitorStats.visitors': res.total || 0 })
        return db.collection('visits')
          .where({ visitCount: _.gt(1) })
          .count()                        // 🔴 全量 count，无 cardOwnerId 过滤
      })
}
```

#### 🔴 Bug #2 (P1 — 降级路径口径不一致)

**根因**：降级路径 `_loadVisitorStatsDirect()` 的查询**缺少 `cardOwnerId` 过滤**，而云函数路径正确使用了 `where({ cardOwnerId })`。当云函数未部署时会回退到降级路径，访客统计变为全量汇总 —— 与云函数路径的统计结果完全不一致。

**修复方向**：降级路径也需要先获取 myOpenId 再过滤：
```javascript
_loadVisitorStatsDirect() {
    const myOpenId = this._myOpenId
    var baseQuery = db.collection('visits')
    if (myOpenId) baseQuery = baseQuery.where({ cardOwnerId: myOpenId })
    baseQuery.count().then(...)
    baseQuery.where({ visitCount: _.gt(1) }).count().then(...)
}
```

---

### 1.4 "多次来访"指标 — 数据来源与统计口径

#### 云函数路径

```javascript
// initVisits 云函数 getMyVisitorStats (line 96-101)
db.collection('visits')
    .where({
        cardOwnerId,
        visitCount: db.command.gt(1)    // visitCount > 1
    })
    .count()
```

**统计口径**：在 visits 集合中，满足 `cardOwnerId` 匹配且 `visitCount > 1` 的记录总数。

**`visitCount` 的产生机制**（initVisits 云函数 `recordVisit`）：
- 同一访客在 30 分钟窗口内访问同一张名片 → 不创建新记录，只 `visitCount: db.command.inc(1)`
- 超过 30 分钟或首次访问 → 创建新记录，`visitCount: 1`

**与"名片数"的关系**：无直接数学关系。两者统计的是不同维度的数据（名片数量 vs 访客行为频次）。

#### "多次来访"指标存在的必要性评估

| 维度 | 分析 |
|------|------|
| 业务价值 | ⭐⭐ 中等。让用户感知哪些名片/访客有持续关注，但信息密度不高 |
| 数据可获得性 | ✅ 已有 visitCount 字段，无需额外采集 |
| 命名准确性 | ⚠️ "多次来访"容易与"总访客数"混淆。实际含义是 "visitCount > 1 的记录数" |
| 30 分钟窗口影响 | `visitCount > 1` 的出现条件较苛刻——同一人在 30 分钟内重复访问同一名片 |
| 去重问题 | 同一访客访问多张名片产生多条记录，未按访客维度去重 |

**建议**：**保留但优化**。理由：
- 当前名称"多次来访"易产生歧义，建议改为 **"高频访问"** 或 **"回头访客"**
- 可考虑将统计维度从 `visitCount > 1 的记录数` 改为 `同一 visitorOpenId 有多条记录的去重访客数`，语义更清晰
- 如未来上线"访客详情页"，该指标可下钻展开更丰富的访客画像

---

### 1.5 附带发现：名片列表页 Bug

#### 🔴 Bug #3 (P1 — 名片夹列表跨用户数据泄露)

**文件**：`pages/list/index.js` line 27-39

```javascript
app.getOpenId().then((myOpenId) => {
    // myOpenId 已获取但并未用于过滤！
    db.collection('user_save_cards')
        .orderBy('savedAt', 'desc')
        .get()                          // 🔴 缺少 .where({ _openid: myOpenId })
```

`user_save_cards` 集合中，微信云开发会自动为每条记录添加 `_openid` 字段（当前操作用户的 openId）。但此查询未添加 `where({ _openid: myOpenId })` 过滤条件，会导致返回**所有用户的保存记录**，而非仅当前用户的保存记录。

**影响**：多用户环境下，名片夹列表可能展示其他用户保存的名片。

**修复方向**：
```javascript
db.collection('user_save_cards')
    .where({ _openid: myOpenId })       // 添加此行
    .orderBy('savedAt', 'desc')
    .get()
```

---

## 审查任务二：名片预览页删除按钮逻辑审查

### 2.1 前端条件渲染分析

**文件**：`pages/preview/index.wxml` line 145-170

```html
<view class="function-card">
  <!-- 仅自有名片显示编辑按钮 -->
  <view class="function-item" bindtap="goToEdit" wx:if="{{isOwner}}">
  <!-- 他人名片 + 未保存 → 保存按钮 -->
  <view class="function-item" bindtap="saveCard" wx:if="{{!isOwner && !isSaved}}">
  <!-- 他人名片 + 已保存 → 已保存状态 -->
  <view class="function-item saved" bindtap="unsaveCard" wx:if="{{!isOwner && isSaved}}">
  <!-- 仅自有名片显示删除按钮 -->
  <view class="function-item" bindtap="confirmDelete" wx:if="{{isOwner}}">
</view>
```

**关键判断逻辑**（`pages/preview/index.js` line 187-203）：

```javascript
_checkCardOwnership(cardId) {
    app.getOpenId().then((myOpenId) => {
        var isOwner = (this.data.card._openid === myOpenId)
        if (isOwner) {
            this.setData({ isOwner: true, isSaved: false })
        } else {
            this._checkSaveStatus(cardId)    // isOwner 保持 false
        }
    })
}
```

#### ✅ 检查结论：删除按钮仅 `isOwner === true` 时显示

当用户查看**他人**的名片（`isOwner = false`）时：
- "保存名片" → `saveCard()` — 仅操作 `user_save_cards` 关系表
- "已保存" → `unsaveCard()` — 仅删除 `user_save_cards` 关系记录
- **绝不会出现"删除名片"按钮**

### 2.2 删除操作完整调用链路

```
用户点击「删除名片」
  ↓ confirmDelete()       [preview/index.wxml:164]
  ↓ 显示确认弹窗           [showDeleteConfirm: true]
  ↓ 用户点击「删除」
  ↓ deleteCard()           [preview/index.js:518]
  │
  ├─→ 主路径：云函数调用
  │   wx.cloud.callFunction({ name: 'deleteCard', data: { cardId } })
  │   ↓
  │   deleteCard 云函数 [cloudfunctions/deleteCard/index.js:6]
  │   ├─ 1. db.collection('cards').doc(cardId).get()          获取名片数据
  │   ├─ 2. 校验 card._openid === openid                       权限验证
  │   ├─ 3. 收集 cloud:// 文件 ID (avatar + attachments)
  │   ├─ 4. Promise.all 并行清理：
  │   │   ├─ db.collection('cards').doc(cardId).remove()      删除名片主表
  │   │   ├─ db.collection('user_save_cards')
  │   │   │       .where({cardId}).remove()                   清理所有保存关系
  │   │   ├─ db.collection('visits')
  │   │   │       .where({cardId}).remove()                   清理所有访客记录
  │   │   └─ cloud.deleteFile({fileList})                     清理云存储文件
  │   └─ 5. 返回汇总结果 { ok, allSettled, results, failedCount }
  │
  └─→ 降级路径：云函数调用失败
      db.collection('cards').doc(id).remove()                 仅删除名片主表
      toast "关联数据未清理"
```

### 2.3 逐项风险检查

#### ✅ 检查项 1：保存/取消保存是否误操作主表？

| 方法 | 操作集合 | 操作类型 |
|------|----------|----------|
| `saveCard()` | `user_save_cards` | `.add()` 创建关系记录 |
| `unsaveCard()` | `user_save_cards` | `.doc(id).remove()` 删除关系记录 |

**结论**：`saveCard()` 和 `unsaveCard()` **仅操作 `user_save_cards` 关系表**，绝不触碰 `cards` 主表。✅ 无风险。

#### ✅ 检查项 2：云函数端权限校验

```javascript
// deleteCard 云函数 line 28-30
if (card._openid && card._openid !== openid) {
    return { ok: false, message: '无权删除此名片' }
}
```

**结论**：即使有人绕过前端 UI 直接调用云函数传入他人名片 ID，也会被 `_openid` 校验拦截。✅ 双重保障。

#### ⚠️ 检查项 3：事务边界与数据一致性 (P1)

`deleteCard` 云函数使用 `Promise.all` 并行执行四项清理操作，**非数据库事务**：

```javascript
var results = await Promise.all(tasks)  // line 87
```

**风险场景**：`cards` 删除成功，但 `user_save_cards` 或 `visits` 删除失败 → **孤儿数据残留**：
- 其他用户的名片夹中出现已删除名片的保存记录
- visits 表出现无效访客记录（对应的 cardId 已不存在）

**严重程度**：中等。功能上不影响核心流程（名片夹点击无效记录时 `cards.doc(id).get()` 返回不存在，前端有 error 处理），但会产生数据冗余。

**根因**：微信云开发基础版不支持跨集合事务，`Promise.all` 是当前约束下的最佳折中方案。云函数已通过 `allSettled` 模式（每个 task 内部 `.catch` 返回 `{ ok: false }`）避免单点失败中断整体流程。

**建议**：暂无完美解决方案。可考虑：
1. 定期清理脚本：扫描 `user_save_cards` 中 cardId 对应的 cards 文档是否仍存在，清理孤儿记录
2. 升级到云开发企业版（如有跨集合事务需求）

#### ⚠️ 检查项 4：降级路径的损害范围 (P1)

```javascript
// preview/index.js line 541-554
wx.cloud.database().collection('cards').doc(this.data.id).remove()
    .then(() => {
        app.showSuccess('删除成功（云函数未部署，关联数据未清理）')
    })
```

**风险**：降级路径仅删除 `cards` 文档，**完全跳过** `user_save_cards`、`visits`、云存储文件的清理。

**触发条件**：`deleteCard` 云函数调用失败（云函数未部署 / 网络超时 / 返回异常）。

**后果**：
- user_save_cards 残留 → 名片夹中出现"幽灵名片"（点击加载失败）
- visits 残留 → 访客统计出现无效数据
- 云存储文件未清理 → 存储空间浪费

**建议**：
- 在云函数部署确认后，移除或收紧降级逻辑
- 或降级路径也至少尝试清理 `user_save_cards` 和 `visits`

---

### 2.4 🔴 附带发现：#4 (P0 — recordVisit 访客记录完全不工作)

**文件**：`pages/preview/index.js` line 29-65

```javascript
recordVisit(cardId, options) {
    wx.cloud.callFunction({
        name: 'getOpenId',
        success: (res) => {
            const visitorOpenId = res.result?.openid || ''   // 🔴 BUG!
            // getOpenId 云函数返回结构: { success: true, data: { openid: ... } }
            // 正确路径: res.result.data.openid
            // res.result.openid → undefined → visitorOpenId = ''
```

**对比 `app.js` 中正确的解析方式** (line 169)：
```javascript
var openId = (res.result && res.result.data && res.result.data.openid) || ''  // ✅
```

**影响链**：
1. `visitorOpenId` 始终为空字符串 `''`
2. `initVisits` 云函数 `recordVisit` 收到 `visitorOpenId: ''`
3. 云函数校验 `if (!cardId || !visitorOpenId)` → 返回 `{ ok: false, message: '参数不完整' }`
4. **所有访客记录完全无法写入 visits 集合**

**这意味着首页的"我的访客"、"多次来访"、"最近访客"三个指标全部为空/零值（除非之前有其他正确的 recordVisit 调用路径写入过数据）。**

**修复方向**：
```javascript
// 方案 A：直接复用 app.getOpenId()（推荐）
recordVisit(cardId, options) {
    app.getOpenId().then((visitorOpenId) => {
        if (!visitorOpenId) return
        wx.cloud.callFunction({
            name: 'initVisits',
            data: {
                action: 'recordVisit',
                data: { cardId, visitorOpenId, cardOwnerId: this.data.card._openid || '', source: options?.source || 'direct' }
            }
        })
    })
}

// 方案 B：修复路径解析
const visitorOpenId = (res.result && res.result.data && res.result.data.openid) || ''
```

---

## 问题汇总

| # | 严重级别 | 位置 | 问题 | 影响 |
|---|---------|------|------|------|
| 1 | **P0** | `index.js:92` | `visitorStats.newCards` 全量 count 无名片过滤 | 指标卡显示所有人名片总数 |
| 2 | **P0** | `preview.js:37` | `recordVisit` 中 `res.result.openid` 路径错误 | 所有访客记录无法写入数据库 |
| 3 | P1 | `index.js:146-151` | `_loadVisitorStatsDirect()` 降级路径缺少 cardOwnerId 过滤 | 云函数未部署时统计口径不一致 |
| 4 | P1 | `list.js:37-39` | `user_save_cards` 查询未按 `_openid` 过滤 | 名片夹列表跨用户数据混淆 |
| 5 | P1 | `deleteCard` 云函数 | Promise.all 非事务，部分失败产生孤儿数据 | user_save_cards/visits 残留记录 |
| 6 | P1 | `preview.js:546` | 降级删除仅清理 cards，不处理关联数据 | 孤儿记录 + 云存储残留 |
| 7 | 建议 | `index.wxml:113` | "多次来访"指标命名不准确 | 用户认知偏差 |
| 8 | 建议 | `index.wxml` | `subtitle` 与 `newCards` 双源数据不一致 | 顶部标签与指标卡数字矛盾 |

---

## 优先级修复建议

### 立即修复（P0）

1. **Bug #1**：`loadVisitorData()` 中 `cards.count()` 添加 `where({ _openid: myOpenId })` 过滤
2. **Bug #2**：`recordVisit()` 中修复 `getOpenId` 云函数返回值解析路径，或改用 `app.getOpenId()`

### 近期修复（P1）

3. **Bug #3**：`_loadVisitorStatsDirect()` 添加 cardOwnerId 过滤
4. **Bug #4**：`list/index.js` 的 `user_save_cards` 查询添加 `_openid` 过滤
5. **Bug #5**：降级删除路径至少清理 user_save_cards（批量 where({cardId}).remove()）

### 迭代优化（建议）

6. "多次来访"指标重命名为"高频访问"或调整统计维度
7. 名片数指标统一使用同一数据源（metrics 与列表数量统一）
8. 定期清理孤儿数据脚本（user_save_cards 中无效 cardId）
