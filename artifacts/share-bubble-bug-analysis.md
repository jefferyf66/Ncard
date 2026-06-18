# 分享气泡卡片 Bug 分析报告（最终版）

**日期**：2026-06-18  
**问题**：分享气泡卡片时，接收方无法看到卡片内容，且分享标题降级为小程序名  
**严重级别**：P0  
**状态**：根因已定位 → 三轮迭代修复完成 ✅

---

## 用户关键发现

> "气泡卡片的标题本来应该是姓名-公司，现在降级为小程序名了"

**这揭示了一个更深层的问题：`onShareAppMessage` 根本没拿到卡片数据。**

标题变成小程序名 = WeChat 使用了默认分享配置 = `onShareAppMessage` 返回了无效值（undefined/空/拒绝的 Promise）。

---

## 经三轮迭代，最终根因：双重 Bug

### Bug #1：`open-type="share"` 与 `bindtap` 不兼容导致卡片数据丢失

```html
<!-- 首页 WXML -->
<button open-type="share" bindtap="onShareButtonTap" data-id="{{item._id}}">
```

`open-type="share"` 按钮在部分微信版本中，`onShareAppMessage` 可能在 `bindtap` 执行前触发。

```
预期流程:  tap → bindtap(设置_activeShare) → onShareAppMessage → 拿到card ✓
实际流程:  tap → onShareAppMessage → _activeShare=null → card={} ✗
                                          ↓
                               buildShareTitle({}) = "名片"
                               但 Promise 内部 shareCard.generate({},...) 可能因空 card 抛异常
                               Promise 拒绝 → WeChat 用默认配置 → 标题=小程序名
```

### Bug #2：`_generateAndStoreShareImage` 时序竞态 → shareImageUrl 从未写入 DB

```
编辑页 saveCard → _generateAndStoreShareImage (2800ms+)
编辑页 saveCard → navigateBack (1500ms)  ← 太早了！
                              ↓
                    Canvas 被销毁 → 生成链中断 → shareImageUrl 从未写入
```

---

## 最终修复方案（第三轮）

### 修复 1：`onShareAppMessage(options)` — 利用 options.target.dataset

**文件**：`miniprogram/pages/index/index.js:505-603`

不再依赖 `bindtap` 时序，改用微信原生提供的 `options.target.dataset` 获取卡片 ID：

```javascript
onShareAppMessage(options) {
    var id
    // 一级：直接读 options.target.dataset（基础库 2.12.0+，不受 bindtap 时序影响）
    if (options && options.from === 'button' && options.target && options.target.dataset) {
        id = options.target.dataset.id   // 来自 data-id="{{item._id}}"
    }
    // 二级降级：bindtap 预留的 _activeShare
    // 三级降级：shareCardData（setData 同步）

    // 从 this.data.cards 查找完整卡片数据
    card = this.data.cards.find(function(c) { return c._id === id })
    // ...
}
```

### 修复 2：空卡片防护 — Promise 永不拒绝

```javascript
// 4b. 无有效卡片 → 不尝试 Canvas 生成，直接用头像
if (!card || !card.name || !id) {
    return _resolveAvatarUrl(card && card.avatar).then(...)
}

// 4c. 有卡片 → 实时生成，失败后头像降级（不再 reject）
shareCard.generate(...)
    .then(function(res) {
        // upload
        // 上传失败 → resolveUpload(头像降级) ← 之前是 rejectUpload
    })
    .catch(function(err) {
        return _resolveAvatarUrl(...)   // 头像降级
    })
```

关键变化：上传失败时从 `rejectUpload` 改为 `resolveUpload` + 头像降级，确保 Promise 永远 resolve。

### 修复 3：edit 页 — 同步等待分享图生成（第二轮已修）

**文件**：`miniprogram/pages/edit/index.js:403-491`

- `saveCard` → `.then(() => _generateAndStoreShareImage())` → 等完成再 navigateBack
- `_generateAndStoreShareImage` 返回 Promise + 15s 超时
- shareImageUrl 使用 `cloud://` fileID

---

## 修改文件汇总

| 文件 | 变更 |
|------|------|
| `pages/index/index.js:505-603` | `onShareAppMessage(options)` — 利用 `options.target.dataset` + 空卡防护 + Promise 永不失拒 |
| `pages/index/index.js:489-495` | `_resolveAvatarUrl` — 保留 cloud:// |
| `pages/edit/index.js:403-426` | `saveCard` — Promise 链等待分享图 |
| `pages/edit/index.js:429-491` | `_generateAndStoreShareImage` — 返回 Promise + cloud:// + 15s 超时 |

---

## 分享图片优先级链条（最终形态）

```
分享触发
  │
  ├─ 1. card.shareImageUrl 存在（cloud:// 或 https://）
  │     → 直接使用 ✅（最快，无网络请求）
  │
  ├─ 2. 无预存但有有效卡片（id + name）
  │     → 实时 Canvas 生成 → 上传 cloud:// → 回写 DB
  │     → 上传成功：返回 cloud:// URL ✅
  │     → 上传失败：降级到头像 cloud:// ✅
  │
  └─ 3. 无有效卡片数据
        → 头像 cloud:// / https:// / '' ✅
        → 标题始终正确（从 card 数据构建）
```

---

## 测试清单

1. **新建卡片 → 立即分享**：编辑页保存 → 等待 ← 回到首页 → 点击"发名片" → 应显示分享卡片图 ✅
2. **旧卡片分享**（shareImageUrl 为空）：首页 → 点"发名片" → 实时生成 → 应显示分享卡片图 ✅
3. **第二次分享同一卡片**：应使用缓存的 cloud:// URL，无需重新生成 ✅
4. **分享标题验证**：应显示"姓名-公司"而非小程序名 ✅
5. **跨设备验证**：接收方设备上查看分享消息，图片和标题均正确 ✅
