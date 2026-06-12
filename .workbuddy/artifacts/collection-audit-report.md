# Ncard 云开发数据集合全面审计报告

> 审计日期：2026-06-11 | 审计范围：所有 .js / .json / .md 文件

---

## 一、审计总览

| 集合名称 | 代码引用数 | 状态 | 风险等级 |
|----------|-----------|------|---------|
| `cards` | 16 处引用 | ✅ 活跃 | — |
| `scans` | **0 处引用** | 👻 幽灵集合 | 🔴 P0 |
| `settings` | **0 处引用** | ❌ 不存在 | — |
| `user_save_cards` | 7 处引用 | ✅ 活跃 | 🟡 P2 |
| `visitor_profiles` | 4 处引用 | ✅ 活跃 | 🟡 P2 |
| `visits` | 12 处引用 | ✅ 活跃 | — |
| `users`（文档提及） | **0 处引用** | 👻 文档残留 | 🟠 P1 |

---

## 二、逐集合详细分析

### 2.1 `cards` — 名片主表 ✅ 活跃

| 文件 | 行号 | 操作类型 | 用途 |
|------|------|---------|------|
| `miniprogram/pages/index/index.js` | 97 | `.count()` | 首页指标卡「名片数」统计 |
| `miniprogram/pages/index/index.js` | 111 | `.count()` | 降级路径名片数统计 |
| `miniprogram/pages/index/index.js` | 354 | `.get()` | 首页名片列表加载 |
| `miniprogram/pages/preview/index.js` | 130 | `.doc().get()` | 预览页加载名片详情 |
| `miniprogram/pages/preview/index.js` | 556 | `.doc().remove()` | 降级删除（云函数未部署时） |
| `miniprogram/pages/edit/index.js` | 55 | `.doc().get()` | 编辑页加载名片数据 |
| `miniprogram/pages/edit/index.js` | 402 | `.doc().update()` | 编辑已有名片 |
| `miniprogram/pages/edit/index.js` | 403 | `.add()` | 新建名片 |
| `miniprogram/pages/list/index.js` | 69 | `.where({ _id: _.in() }).get()` | 名片夹批量查询已保存名片 |
| `miniprogram/pages/profile/index.js` | 117 | `.get()` | 个人中心名片列表 |
| `miniprogram/pages/visitors/index.js` | 48 | `.count()` | 访客页名片数统计 |
| `cloudfunctions/deleteCard/index.js` | 18 | `.doc().get()` | 级联删除前获取原始数据 |
| `cloudfunctions/deleteCard/index.js` | 50 | `.doc().remove()` | 删除名片文档 |
| `cloudfunctions/initVisits/index.js` | 54 | `.where().get()` | L3 访客身份识别（查访客名片） |

**分析**：
- ✅ 覆盖 CRUD 全生命周期，无遗漏
- ✅ 云函数 + 前端均有引用，架构合理
- ⚠️ `profile/index.js:117` 的 `.get()` 无过滤条件，获取了所有名片（bug，非本次审计范围）

---

### 2.2 `scans` — OCR 扫描记录 👻 幽灵集合

**代码引用数：0**

| 来源 | 行号 | 内容 |
|------|------|------|
| `README.md` | 43 | `\| scans \| OCR 扫描记录 \|` |
| `DEPLOYMENT-GUIDE.md` | 82 | `scans/ — OCR 扫描图片` |
| `DEPLOYMENT-GUIDE.md` | 136 | `\| scans \| OCR 识别记录 \| 仅创建者可读写 \|` |
| `DEPLOYMENT-GUIDE.md` | 151 | `scans 集合：_openid（升序）、createTime（降序）` |

**🔴 结论：纯冗余集合**

- 所有 JavaScript 代码（含云函数）中 **零引用**
- `parseCard` 云函数已在 2026-06-10 移除（见 MEMORY.md 记录）
- 仅在文档中残留引用

**修复建议**：
1. 云控制台删除 `scans` 集合
2. 清理 `README.md` 第 43 行：从集合表中移除 scans 行
3. 清理 `DEPLOYMENT-GUIDE.md`：移除 scans 集合的创建步骤 + 索引建议
4. 清理 `DEPLOYMENT-GUIDE.md` 第 82 行：移除 `scans/` 云存储目录

---

### 2.3 `settings` — 配置集合 ❌ 不存在

**代码引用数：0**

在所有 `.js`、`.json`、`.md` 文件中均未找到 `collection('settings')` 或 `"settings"` 引用。

**结论**：该集合从未被创建或使用，无需任何操作。

---

### 2.4 `user_save_cards` — 名片保存关联 ✅ 活跃

| 文件 | 行号 | 操作类型 | 用途 |
|------|------|---------|------|
| `miniprogram/pages/preview/index.js` | 226 | `.where().get()` | `_checkSaveStatus`：检查是否已保存 |
| `miniprogram/pages/preview/index.js` | 252 | `.where().count()` | `saveCard`：防重复检查 |
| `miniprogram/pages/preview/index.js` | 270 | `.add()` | `saveCard`：写入保存记录 |
| `miniprogram/pages/preview/index.js` | 301 | `.where().get()` | `unsaveCard`：查找要删除的记录 |
| `miniprogram/pages/preview/index.js` | 312 | `.doc().remove()` | `unsaveCard`：删除保存记录 |
| `miniprogram/pages/list/index.js` | 37 | `.get()` | 名片夹加载已保存的名片列表 |
| `cloudfunctions/deleteCard/index.js` | 57 | `.where().remove()` | 级联删除：清理关联记录 |

**分析**：
- ✅ 覆盖增删查全流程
- ⚠️ `_checkSaveStatus`（行 226）用 `limit(1).get()` 查询 + `res.data.length > 0` 判断，而 `saveCard`（行 252）用 `count()`。两个方法在同一页面中对同一集合采用了不同查询策略，逻辑不一致。
- ⚠️ `unsaveCard`（行 301-312）使用 `map` + `Promise.all` 遍历删除多条记录。设计上同一用户对同一 cardId 应只有一条记录，这是容错措施，合理但可简化。

---

### 2.5 `visitor_profiles` — 访客授权身份 ✅ 活跃

| 文件 | 行号 | 操作类型 | 用途 |
|------|------|---------|------|
| `miniprogram/pages/preview/index.js` | 635 | `.limit(1).get()` | 检查是否已有授权记录 |
| `miniprogram/pages/preview/index.js` | 639 | `.doc().update()` | 更新已有授权记录 |
| `miniprogram/pages/preview/index.js` | 650 | `.add()` | 新建授权记录 |
| `cloudfunctions/initVisits/index.js` | 76 | `.where().get()` | L2 访客身份识别 |

**🟡 P2 问题**：`preview/index.js:635` 的查询方式存在风险

```javascript
// 当前代码
db.collection('visitor_profiles').limit(1).get()
```

该查询**没有任何过滤条件**。虽然云开发默认权限仅返回当前用户的数据，但在以下场景可能出问题：
- 用户从未写过 profile，集合为空 → `.then` 中 `profileRes.data.length === 0` → 走 `add` 分支 ✅
- 用户已有记录 → 取到 `data[0]` → 走 `update` 分支 ✅
- ⚠️ 理论上如果用户有 2 条记录（边界情况），`limit(1)` 可能拿到旧记录

**建议**：虽然当前工作正常，但语义上应明确表达意图：

```javascript
// 推荐写法（更明确）
db.collection('visitor_profiles').limit(1).get()
// 等价于——因为权限规则自动过滤 _openid，等同于：
// .where({ _openid: myOpenId }).limit(1).get()
```

当前依赖云开发自动权限过滤，**暂无需修改**，生产环境观察即可。

---

### 2.6 `visits` — 访客记录 ✅ 活跃

| 文件 | 行号 | 操作类型 | 用途 |
|------|------|---------|------|
| `cloudfunctions/initVisits/index.js` | 15 | `.add()` | `ensureCollection`：创建占位记录 |
| `cloudfunctions/initVisits/index.js` | 18 | `.remove()` | `ensureCollection`：删除占位记录 |
| `cloudfunctions/initVisits/index.js` | 95 | `.where().get()` | 30 分钟内重复访问检测 |
| `cloudfunctions/initVisits/index.js` | 110 | `.doc().update()` | 更新最近访问记录（含富化） |
| `cloudfunctions/initVisits/index.js` | 127 | `.add()` | 新访问记录（含富化） |
| `cloudfunctions/initVisits/index.js` | 153 | `.count()` | `getVisitorStats`：总访客数 |
| `cloudfunctions/initVisits/index.js` | 158 | `.where().count()` | `getVisitorStats`：回访数 |
| `cloudfunctions/initVisits/index.js` | 175 | `.get()` | `getRecentVisitors`：最近访客 |
| `miniprogram/pages/index/index.js` | 168 | `.count()` | 前台降级：总访客数 |
| `miniprogram/pages/index/index.js` | 178 | `.where().count()` | 前台降级：回访数 |
| `miniprogram/pages/index/index.js` | 194 | `.get()` | 前台降级：最近访客列表 |
| `miniprogram/pages/visitors/index.js` | 139 | `.count()` | 全量访客页降级统计 |
| `miniprogram/pages/visitors/index.js` | 148 | `.where().count()` | 全量访客页降级回访统计 |
| `miniprogram/pages/visitors/index.js` | 153 | `.get()` | 全量访客页降级列表 |
| `cloudfunctions/deleteCard/index.js` | 64 | `.where().remove()` | 级联删除清理 |

**分析**：
- ✅ 覆盖增删改查 + 统计全流程
- ⚠️ 云函数端（initVisits）和前端端（index.js / visitors.js）存在 **重复查询逻辑**：
  - 云函数 `getVisitorStats`（行 153-158）和前端 `_loadVisitorStatsDirect`（index.js:168-178）查询条件完全一致
  - 云函数 `getRecentVisitors`（行 175）和前端 `_loadRecentVisitors`（index.js:194）查询条件完全一致
  - 前端降级路径是云函数未部署时的 fallback，**设计上合理，不算真正冗余**

---

### 2.7 `users` — 用户信息 👻 文档幽灵

**代码引用数：0**

仅在 `DEPLOYMENT-GUIDE.md:138` 提及：

```
| `users` | 用户信息 | 仅创建者可读写 |
```

**🟠 P1 问题**：`users` 集合在部署指南中被列为必建集合，但代码中从未使用。该集合的功能已被 `cards`（L3 名片用户身份）和 `visitor_profiles`（L2 授权用户身份）替代。

**修复建议**：从 `DEPLOYMENT-GUIDE.md` 集合表中移除 `users` 行。

---

## 三、跨集合关联分析

### 3.1 当前集合关系图

```
cards ◄────────── user_save_cards ──────────► (名片夹)
  │                      │
  │ cardId               │ cardId
  ▼                      ▼
visits              [名片夹渲染]
  │
  ├── visitorOpenId ──► cards (L3 身份反查)
  └── visitorOpenId ──► visitor_profiles (L2 身份反查)
```

### 3.2 关联合理性评估

| 关联 | 评估 | 说明 |
|------|------|------|
| cards ↔ user_save_cards | ✅ 合理 | 通过 cardId 关联，解耦名片主数据与收藏关系 |
| cards ↔ visits | ✅ 合理 | 通过 cardId + cardOwnerId 关联，访客统计归属正确 |
| visits ↔ cards (反查) | ✅ 合理 | L3 enrichment：通过 visitorOpenId 查 cards 获取访客身份 |
| visits ↔ visitor_profiles (反查) | ✅ 合理 | L2 enrichment：通过 visitorOpenId 查 profiles 获取授权身份 |

### 3.3 是否存在可合并的集合？

| 候选 | 结论 | 理由 |
|------|------|------|
| `user_save_cards` + `cards` | ❌ 不可合并 | 语义不同：一个存名片内容（可读不可写），一个存收藏关系（可变） |
| `visitor_profiles` + `cards` | ❌ 不可合并 | cards 需要 name/phone/company 等完整字段；profiles 仅需 nickname/avatarUrl 两个轻量字段。合并会导致大量空字段 |
| `visitor_profiles` 字段冗余到 `visits` | ❌ 不建议 | visits 是日志表，写入频率高、数据量大；冗余 profile 信息会显著增大存储。当前 enrichment 模式（访问时复制身份快照到 visits）更合理 |

**结论**：当前 5 个活跃集合的职责划分清晰，**无不合理的冗余集合**，无需合并。

---

## 四、问题汇总

### 🔴 P0 — 需要立即处理

| # | 问题 | 影响 | 修复 |
|---|------|------|------|
| P0-1 | `scans` 集合零引用，纯冗余 | 云存储浪费 + 误导新开发者 | 清集合 + 清文档 |

### 🟠 P1 — 建议近期处理

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| P1-1 | README.md 仍列出 `scans` 集合 | `README.md:43` | 移除 scans 行 |
| P1-2 | README.md 仍列出 `parseCard` 云函数 | `README.md:33` | 移除 parseCard 行 + 更新云函数数 |
| P1-3 | DEPLOYMENT-GUIDE 列出 `scans` 集合/存储目录 | `DEPLOYMENT-GUIDE.md:82,136,151` | 移除 3 处 scans 引用 |
| P1-4 | DEPLOYMENT-GUIDE 列出 `users` 集合（零引用） | `DEPLOYMENT-GUIDE.md:138` | 移除 users 行 |
| P1-5 | DEPLOYMENT-GUIDE 列出 `parseCard` 云函数 | `DEPLOYMENT-GUIDE.md:95` | 移除 parseCard 行 |
| P1-6 | DOCUMENTATION.md 未提及 `user_save_cards` + `visitor_profiles` | `DOCUMENTATION.md` | 补充 2 个活跃集合 |

### 🟡 P2 — 低优改进

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| P2-1 | `_checkSaveStatus`（`.limit(1).get()`）与 `saveCard`（`.count()`）查询策略不一致 | `preview/index.js:226 vs 252` | 统一用 `count()` |
| P2-2 | `visitor_profiles` 查询无显式过滤条件（依赖云开发权限） | `preview/index.js:635` | 无需修改，仅为审计记录 |

---

## 五、优化建议实施清单

### 5.1 云控制台操作（需用户手动操作）

- [ ] 删除 `scans` 集合
- [ ] 确认 `visitor_profiles` 集合已创建

### 5.2 代码修改（待实施）

| # | 文件 | 操作 | 优先级 |
|---|------|------|--------|
| 1 | `README.md:43` | 从集合表中移除 `\| scans \| OCR 扫描记录 \|` | 🔴 |
| 2 | `README.md:33` | 移除 `\| parseCard/ \| 名片 OCR 识别 \|` | 🟠 |
| 3 | `README.md:40-45` | 更新集合表，补充 `user_save_cards` + `visitor_profiles` | 🟠 |
| 4 | `DEPLOYMENT-GUIDE.md:82` | 移除 `scans/ — OCR 扫描图片` 行 | 🟠 |
| 5 | `DEPLOYMENT-GUIDE.md:95` | 移除 `parseCard` 云函数行 | 🟠 |
| 6 | `DEPLOYMENT-GUIDE.md:136` | 移除 `scans` 集合行 | 🟠 |
| 7 | `DEPLOYMENT-GUIDE.md:138` | 移除 `users` 集合行 | 🟠 |
| 8 | `DEPLOYMENT-GUIDE.md:151` | 移除 `scans` 索引建议 | 🟠 |
| 9 | `DEPLOYMENT-GUIDE.md:130-153` | 更新集合表，补充 `user_save_cards` + `visitor_profiles` | 🟠 |
| 10 | `DOCUMENTATION.md` | 补充 `user_save_cards` + `visitor_profiles` 集合说明 | 🟠 |
| 11 | `preview/index.js:226,252` | 统一 `_checkSaveStatus` 和 `saveCard` 的查询策略 | 🟡 |

### 5.3 更新后的正确集合清单

| 集合 | 用途 | 状态 |
|------|------|------|
| `cards` | 名片主数据 | ✅ |
| `visits` | 访客记录 | ✅ |
| `user_save_cards` | 用户保存名片关联 | ✅ |
| `visitor_profiles` | 访客授权身份 | ✅ |
| ~~`scans`~~ | ~~OCR 扫描记录~~ | 🗑️ 已废弃 |
| ~~`users`~~ | ~~用户信息~~ | 🗑️ 从未使用 |

---

## 六、附加发现

### 6.1 `preview/index.js:556` — 降级删除路径不完整

```javascript
// 降级路径（deleteCard 云函数未部署时）
wx.cloud.database().collection('cards').doc(this.data.id).remove()
```

**风险**：仅删除 `cards` 文档，不清理 `user_save_cards` + `visits` + 云存储文件。

**缓解**：此路径仅在云函数未部署时触发（正常不会走到），且 `wx:if="{{isOwner}}"` 确保只有卡片主人能删除。**建议在降级路径中补充一条 `console.error` 警告**以方便问题定位：

```javascript
// 修改建议
console.error('[Preview] 云函数未部署，降级删除不完整！请部署 deleteCard 云函数')
```

---

*报告由 WorkBuddy 自动生成 | 审计文件范围：项目内所有 .js / .json / .md 文件*
