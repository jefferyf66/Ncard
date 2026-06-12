# Ncard 数据操作审计报告

> 审计范围：`cards`、`user_save_cards`、`visits` 三个数据库集合 + 云存储文件  
> 审计日期：2026-06-11  
> 风险等级：P0 = 立即修复 / P1 = 高优先级 / P2 = 低优先级

---

## 一、保存逻辑风险

### 1.1 user_save_cards 重复保存 ⚠️ P0

**位置**：`pages/preview/index.js` → `saveCard()` 第 227-261 行

**问题**：用户点击「保存名片」时直接调用 `db.collection('user_save_cards').add()`，**没有先查询是否已存在记录**。`_checkSaveStatus()` 只在页面加载时执行一次，不在保存时做二次校验。

**冗余场景**：
- 用户打开分享名片 → 点击"保存" → 网络延迟，连点两次 → 同一 cardId 在 `user_save_cards` 中出现两条记录
- 用户在名片夹 `unsave` 后再保存 → 正常。但如果在旧版本中保存过，新版本 `_checkSaveStatus` 查的是旧记录的同一 `cardId`，理论上不会重复（因为云 DB 默认 `_openid` 过滤），但仍缺少显式的唯一性约束

**修复建议**：在 `add()` 前先查询是否已存在：
```javascript
// 防重复：先查再写
db.collection('user_save_cards').where({ cardId: cardId }).count()
  .then(res => {
    if (res.total > 0) {
      app.hideLoading()
      this.setData({ isSaved: true })
      app.showSuccess('已保存过此名片')
      return Promise.reject('duplicate')
    }
    return db.collection('user_save_cards').add({ data: { ... } })
  })
```

---

### 1.2 cards 集合无唯一性约束 ⚠️ P1

**位置**：`pages/edit/index.js` → `saveCard()` 第 374-381 行

**问题**：新建名片时直接 `collection('cards').add()`，无任何唯一性校验。同一用户可创建完全同名的多张名片。

**冗余场景**：
- 用户创建名片 → 保存成功 → 回到首页 → 再次点击"+" → 输入相同信息 → 保存 → 两张完全相同的名片
- 网络超时后用户重新保存 → 第一条可能已成功但客户端不知道

**修复建议**：
```javascript
// 创建前检查：同一 openId 下是否已有同名+同公司名片
db.collection('cards')
  .where({ name: data.name, company: data.company })
  .count()
  .then(res => {
    if (res.total > 0) {
      wx.showModal({
        title: '重复名片',
        content: '您已创建过相同姓名和公司的名片，是否继续创建？',
        success: (modalRes) => {
          if (modalRes.confirm) { /* 继续 add */ }
        }
      })
    } else {
      // 继续 add
    }
  })
```

---

### 1.3 头像文件无去重 — 单次编辑多次上传 ⚠️ P1

**位置**：`pages/edit/index.js` → `_uploadAvatar()` 第 134-151 行

**问题**：每次调用 `_uploadAvatar()` 都用 `Date.now()` 生成新文件名上传。如果用户在保存前反复更换头像（裁切→不满意→重新选图→裁切），每次都产生一个新的云文件，旧文件全部成为孤儿数据。

**冗余场景**：
- 用户选图 → 裁切 → 返回 → 不满意 → 再选图 → 裁切 → 5 次 → 云存储中有 5 个头像文件，只有最后一个被保存到数据库
- 用户编辑名片换了头像 → 但不保存直接返回 → 新头像文件已上传但未关联任何记录

**修复建议**：
1. 延迟上传：裁切后只保存临时路径到 `this.data.avatar`，在 `saveCard()` 中统一上传
2. 或者：上传成功后立即删除旧头像文件（见 3.x 节）

---

## 二、变更逻辑风险

### 2.1 saveCard update — 全量替换 ⚠️ P1

**位置**：`pages/edit/index.js` → `saveCard()` 第 380 行

**问题**：`db.collection('cards').doc(id).update({ data })` 是**全量替换**整个文档。如果服务端有客户端未加载的字段（例如其他设备新增的字段），这些字段会被**静默删除**。

**当前影响**：目前所有字段都在 `saveCard()` 中显式赋值（第 356-371 行），所以当前不会丢数据。但未来如果有人新增数据库字段而未同步更新 `saveCard()` 的 `data` 对象，就会丢数据。

**修复建议**：使用 `_.set()` 增量更新关键字段，或确保 `data` 对象始终包含所有字段。

---

### 2.2 头像变更 — 旧文件未清理 ⚠️ P0

**位置**：`pages/edit/index.js` → `_uploadAvatar()` + `saveCard()`

**问题**：每次更换头像上传新文件后，旧 `cloud://fileID` 对应的云存储文件**永久保留**。没有任何代码调用 `wx.cloud.deleteFile()`。

**冗余场景**：
- 用户每月换一次头像 → 12 个月后云存储有 12 个头像文件，只有最新的被引用
- 用户创建名片时选择了错误的头像 → 重新选择 → 旧文件成为孤儿

**修复建议**：
```javascript
_uploadAvatar(tempFilePath) {
  const oldAvatarFileID = this.data.avatar // 保存旧文件 ID
  // ... 上传逻辑 ...
  success: (uploadRes) => {
    this.setData({ avatar: uploadRes.fileID })
    // 删除旧头像文件
    if (oldAvatarFileID && oldAvatarFileID.indexOf('cloud://') === 0) {
      wx.cloud.deleteFile({ fileList: [oldAvatarFileID] })
    }
  }
}
```

---

### 2.3 附件删除 — 云存储文件未清理 ⚠️ P0

**位置**：`pages/edit/index.js` → `deleteAttachment()` 第 192-196 行

**问题**：从编辑页删除附件时，只是从本地 `this.data.attachments` 数组中移除，**云存储文件从未被删除**。附件 URL 是 `cloud://fileID` 格式。

**冗余场景**：
- 用户添加 3 个附件 → 删除 2 个 → 保存 → 只有 1 个附件被引用，但云存储中仍有 3 个文件

**修复建议**：
```javascript
deleteAttachment(e) {
  const index = parseInt(e.currentTarget.dataset.index)
  const attachments = [...this.data.attachments]
  const removed = attachments.splice(index, 1)[0]
  this.setData({ attachments })
  // 删除云存储文件
  if (removed && removed.url && removed.url.indexOf('cloud://') === 0) {
    wx.cloud.deleteFile({ fileList: [removed.url] }).catch(() => {})
  }
}
```

---

### 2.4 无乐观锁 / 版本控制 ⚠️ P2

**位置**：`pages/edit/index.js` → `saveCard()` 第 380 行

**问题**：更新时没有使用条件更新（如 `_.eq('version', currentVersion)`）。多设备同时编辑同一张名片时，后保存的覆盖先保存的，无冲突提示。

**修复建议**：在 `cards` 集合中新增 `_version` 字段，更新时用：
```javascript
db.collection('cards').where({ _id: id, _version: currentVersion }).update({
  data: { ...data, _version: _.inc(1) }
})
```
如果 `stats.updated === 0` 则提示冲突。

---

## 三、删除逻辑风险

### 3.1 删除名片 — 级联清理完全缺失 ⚠️ P0

**位置**：`pages/preview/index.js` → `deleteCard()` 第 497-514 行

**问题**：`deleteCard()` 只删除了 `cards` 集合中的一条文档，以下关联数据全部成为**孤儿**：

| 待清理项 | 位置 | 当前状态 |
|----------|------|----------|
| 头像文件 | 云存储 `avatars/` | ❌ 未删除 |
| 附件文件 | 云存储 `attachments/` | ❌ 未删除 |
| user_save_cards 记录 | 数据库集合 | ❌ 未删除（其他用户保存过此名片） |
| visits 记录 | 数据库集合 | ❌ 未删除（其他人访问过此名片） |

**冗余场景**：
- 用户创建名片 → 被 10 人保存 → 被 50 人访问 → 用户删除名片 → `user_save_cards` 有 10 条无效引用、`visits` 有 50 条无效记录、云存储有头像 + N 个附件残留

**修复建议**：
```javascript
deleteCard() {
  const card = this.data.card
  const cardId = this.data.id

  // 1. 收集需要删除的云文件
  const filesToDelete = []
  if (card.avatar && card.avatar.indexOf('cloud://') === 0) {
    filesToDelete.push(card.avatar)
  }
  if (card.attachments) {
    card.attachments.forEach(a => {
      if (a.url && a.url.indexOf('cloud://') === 0) filesToDelete.push(a.url)
    })
  }

  // 2. 删除数据库记录
  const db = wx.cloud.database()
  const deletePromises = [
    db.collection('cards').doc(cardId).remove(),
    // 清理所有用户对此名片的保存记录
    db.collection('user_save_cards').where({ cardId: cardId }).remove(),
    // 清理此名片的所有访客记录
    db.collection('visits').where({ cardId: cardId }).remove()
  ]

  // 3. 删除云存储文件
  if (filesToDelete.length > 0) {
    deletePromises.push(wx.cloud.deleteFile({ fileList: filesToDelete }))
  }

  Promise.all(deletePromises).then(...)
}
```

> ⚠️ 注意：`user_save_cards` 的 `where().remove()` 需要云开发数据库权限设置为「所有用户可读写」或使用云函数，否则只能删除本人的记录。建议将删除逻辑移入云函数执行。

---

### 3.2 unsaveCard 逻辑正常 ✅

**位置**：`pages/preview/index.js` → `unsaveCard()` 第 266-299 行

当前逻辑正确：只删除当前用户的 `user_save_cards` 记录，不影响其他用户或 `cards` 集合。无需修改。

---

## 四、数据一致性排查

### 4.1 cardOwnerId 数据写入错误 ⚠️ P1

**位置**：`pages/preview/index.js` → `recordVisit()` 第 29-63 行  
联动：`cloudfunctions/initVisits/index.js` 第 31-83 行

**问题**：前端 `recordVisit()` 调用云函数时不传 `cardOwnerId`（第 43-48 行），云函数默认值 `cardOwnerId || ''` 使所有访客记录的 `cardOwnerId` 均为空字符串。这导致：

- `getMyVisitorStats` 云函数中 `where({ cardOwnerId: '' })` 匹配**所有**记录，而不是当前用户
- `getRecentVisitors` 同理，返回所有访客而非当前用户的访客
- 首页 `_loadVisitorStats` 调用时 `cardOwnerId: ''`（index.js 第 107 行），永远看不到按用户过滤的统计

**修复建议**：前端传递 `cardOwnerId: this.data.card._openid`：
```javascript
// preview/index.js recordVisit()
wx.cloud.callFunction({
  name: 'initVisits',
  data: {
    action: 'recordVisit',
    data: {
      cardId,
      visitorOpenId,
      cardOwnerId: this.data.card._openid || '',  // ← 添加此行
      source: options?.source || 'direct'
    }
  }
})
```

---

### 4.2 跨集合数据引用 — 删除后残留 ⚠️ P0

见 3.1 节详述。删除名片后：
- `user_save_cards` 中的记录变成死链接 → 名片夹列表查询 `_.in(cardIds)` 时，已删除的 ID 不返回数据，表现为「已保存的名片神秘消失」
- `visits` 中的记录变成死链接 → 访客统计页可能显示不存在名片的访问记录

---

### 4.3 无事务保障 ⚠️ P1

**影响范围**：整个代码库

云开发基础版不支持事务 API。当前所有写操作都是单步执行，无法保证原子性。最典型的风险场景见 `deleteCard()`：如果先删除 `cards` → 成功 → 然后删除云文件 → 失败 → 卡片已删但文件残留。

**修复建议**：将需要多步协同的操作（删除名片、创建名片+上传头像）封装为云函数，在云函数端用 try/catch 做尽力回滚。

---

### 4.4 云存储累积冗余 — 无清理机制 ⚠️ P0

**综合影响**：2.2 + 2.3 + 3.1

| 冗余类型 | 触发频率 | 影响 |
|----------|----------|------|
| 更换头像残留 | 每次换头像 | 每用户每名片 × 更换次数 |
| 附件删除残留 | 编辑时删除附件 | 每名片 × 删除次数 |
| 名片删除残留 | 每次删除 | 头像 + 全部附件 |
| 裁切重选残留 | 编辑时反复裁切 | 见 1.3 |

云存储费用按存储量+流量计费，长期运行下冗余文件会持续增加成本。

---

## 五、修复优先级总结

| 优先级 | 问题 | 位置 | 影响 |
|--------|------|------|------|
| **P0** | 删除名片无级联清理 | preview/deleteCard | 数据库+云存储双重冗余 |
| **P0** | 头像更换旧文件不删 | edit/_uploadAvatar | 云存储持续膨胀 |
| **P0** | 附件删除不清理云文件 | edit/deleteAttachment | 云存储持续膨胀 |
| **P0** | 名片夹重复保存 | preview/saveCard | 脏数据 |
| **P1** | cards 无唯一性校验 | edit/saveCard | 重复名片 |
| **P1** | cardOwnerId 数据写入错误 | preview/recordVisit | 访客统计不准 |
| **P1** | 保存时全量替换 | edit/saveCard | 并发编辑丢数据 |
| **P1** | 编辑中多次上传头像 | edit/_uploadAvatar | 云存储冗余 |
| **P2** | 无乐观锁版本控制 | edit/saveCard | 多设备冲突 |

---

## 六、建议的云函数封装

将删除名片逻辑封装为云函数 `deleteCard`，在服务端一次性完成级联清理：

```javascript
// cloudfunctions/deleteCard/index.js
exports.main = async (event) => {
  const { cardId } = event
  const db = cloud.database()
  
  // 1. 获取名片记录以收集文件 ID
  const card = await db.collection('cards').doc(cardId).get()
  const filesToDelete = []
  if (card.data.avatar) filesToDelete.push(card.data.avatar)
  if (card.data.attachments) {
    card.data.attachments.forEach(a => { if (a.url) filesToDelete.push(a.url) })
  }

  // 2. 并行删除
  const results = await Promise.allSettled([
    db.collection('cards').doc(cardId).remove(),
    db.collection('user_save_cards').where({ cardId }).remove(),
    db.collection('visits').where({ cardId }).remove(),
    filesToDelete.length > 0 ? cloud.deleteFile({ fileList: filesToDelete }) : Promise.resolve()
  ])

  return { ok: true, results }
}
```

> `Promise.allSettled` 确保一个失败不会阻塞其他清理操作。调用方根据 results 判断各部分成功率。
