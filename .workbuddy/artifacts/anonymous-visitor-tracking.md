# 匿名访客数据追踪与归因 — 技术分析报告

> 日期：2026-06-11 | 状态：分析完成，待决策

---

## 一、问题定义

**"匿名访客"** 指：打开了他人的名片分享链接、查看了名片内容，但自己尚未在 Ncard 中创建名片的微信用户。

**核心矛盾**：名片主人看到的访客列表全是「微信用户」——无头像、无昵称、无公司职位，且同一人多次访问无法归并，访客数据几乎无商业价值。

---

## 二、现状诊断

### 2.1 visits 集合当前 Schema

```js
{
  _id:        string,        // 自动生成
  cardId:     string,        // 被查看的名片 ID
  cardOwnerId: string,       // 名片主人 openId
  visitorOpenId: string,     // 访客 openId（核心标识）
  visitTime:  Date,          // 最后访问时间
  visitCount: number,        // 30 分钟内去重后的访问次数
  actions:    [],            // 预留，未使用
  source:     'direct'       // 硬编码，无实际意义
}
```

### 2.2 🔴 P0 Bug：recordVisit 完全失效

**位置**：`miniprogram/pages/preview/index.js:37`

```js
// ❌ 错误：getOpenId 云函数返回 { success: true, data: { openid: "..." } }
const visitorOpenId = res.result?.openid || ''  
// res.result?.openid → undefined → visitorOpenId = ''

// ✅ 正确：
const visitorOpenId = res.result?.data?.openid || ''
```

**影响链路**：

```
recordVisit() 获取 openId
  → visitorOpenId = ''（始终为空字符串）
  → initVisits/recordVisit 云函数：if (!cardId || !visitorOpenId) return early
  → visits 集合中零条访客记录！
  → 首页「我的访客」「多次来访」「最近访客」全部为零
```

**严重程度**：🔴 Critical — 访客追踪功能自上线以来从未工作过。即使前面代码审查中修复了 `cardOwnerId` 过滤问题，也没有数据可查。

### 2.3 现有字段中的"匿名槽位"

代码中预留了 visitor 扩展字段，但从未写入：

| 字段 | visit 集合 | 前端读取 | 状态 |
|------|-----------|---------|------|
| `visitorName` | ❌ 不存在 | `v.visitorName \|\| '微信用户'` | 永远走 fallback |
| `visitorAvatar` | ❌ 不存在 | `v.visitorAvatar \|\| ''` | 永远空 |
| `visitorPhone` | ❌ 不存在 | `v.visitorPhone \|\| ''` | 永远空 |
| `visitorPosition` | ❌ 不存在 | `v.visitorPosition \|\| ''` | 永远空 |
| `visitorCompany` | ❌ 不存在 | `v.visitorCompany \|\| ''` | 永远空 |
| `source` | ✅ 存在但硬编码 | `v.source ? '通过"${v.source}"查看了您' : ''` | 始终显示"通过 direct 查看了您" |

### 2.4 归因链路缺失

当前进入小程序的场景（`wx.getLaunchOptionsSync().scene`）未被捕获：

| 实际场景 | scene 值 | 能否区分分享来源 | 当前是否入库 |
|---------|---------|-----------------|------------|
| 群聊分享卡片 | 1044 | ✅ 可获取 shareTicket → 群名 | ❌ |
| 单聊分享卡片 | 1007 | ✅ 但无群信息 | ❌ |
| 朋友圈 | 1154 | ❌ 匿名 | ❌ |
| 扫码 | 1011/1012/1013 | ❌ 无 | ❌ |
| 公众号文章 | 1058 | ❌ 无 | ❌ |
| 小程序搜索 | 1001 | ❌ 无 | ❌ |

---

## 三、匿名访客的三个层级

在微信小程序隐私框架下，访客的"可识别程度"分三级：

```
┌─────────────────────────────────────────────────────────┐
│  L3  卡片用户             已有名片 → 查 cards 集合      │
│      可显示：姓名+头像+公司+职位+完整名片链接            │
│      ───────────────────────────────────────────────    │
│  L2  已授权用户           无名片但授权了微信昵称         │
│      可显示：微信昵称+微信头像                           │
│      需主动触发授权弹窗                                   │
│      ───────────────────────────────────────────────    │
│  L1  纯匿名用户           无名片 + 未授权                │
│      可显示：访客 #XXXX（openid hash 前缀）              │
│      可追踪：访问次数、首次/末次、来源渠道               │
└─────────────────────────────────────────────────────────┘
```

**关键认知**：L1 状态下，openid 已是最低程度的身份锚点——它是小程序内唯一且稳定的。即使"纯匿名"，我们仍然能做到：
- 识别同一访客的多次访问（去重归并）
- 记录其访问行为习惯
- 在名片主人看访客列表时，将同一 openid 的多条 visit 记录聚合为一条展示

---

## 四、技术方案设计

### 4.1 方案总览

分三个阶段实施，每个阶段独立可交付：

| 阶段 | 内容 | 改动范围 | 价值 |
|------|------|---------|------|
| **P0 Fix** | 修复 recordVisit 的 openid 解析 | 1 行代码 | 让访客追踪开始工作 |
| **Phase 1** | 访客身份识别 + 聚合展示 | visits 集合 + 云函数 + 前端 | 访客列表不再全是「微信用户」 |
| **Phase 2** | 来源归因 + 设备信息 | recordVisit 云函数 + visits schema | 知道访客从哪来 |
| **Phase 3** | 访客画像聚合 + 运营分析 | 新云函数 + 仪表盘 | 数据驱动决策 |

### 4.2 Phase 1：访客身份识别

#### 4.2.1 数据流

```
用户 A 打开用户 B 的名片
  │
  ├─ 1. recordVisit(cardId, options)
  │     ├─ app.getOpenId() → visitorOpenId  ✅
  │     └─ 调用 initVisits 云函数 recordVisit
  │
  ├─ 2. 云函数端 enrichVisitor(visitorOpenId)
  │     ├─ 查 cards 集合 where({ _openid: visitorOpenId })
  │     │   ├─ 命中 → L3：写入 visitorName/visitorAvatar/visitorPosition/visitorCompany
  │     │   └─ 未命中 → 查 visitor_profiles where({ openid: visitorOpenId })
  │     │       ├─ 命中 → L2：写入 visitorName/visitorAvatar（已授权数据）
  │     │       └─ 未命中 → L1：仅写入 visitorOpenId
  │     └─ 写入 visits 文档
  │
  └─ 3. 前端首次加载预览页时触发授权引导（可选）
        ├─ 检测当前用户是否 L3（已有名片）→ 跳过
        └─ 检测当前用户是否 L2（已授权）→ 跳过
        └─ 否则 → 在合适时机展示「授权微信昵称」引导
           ├─ 同意 → wx.getUserProfile → 存入 visitor_profiles
           └─ 拒绝 → 保持 L1
```

#### 4.2.2 新增集合：visitor_profiles

```js
// 集合：visitor_profiles
// 权限：仅创建者可读写（默认）
{
  _openid:     string,        // 微信 openId（自动）
  nickname:    string,        // 微信昵称
  avatarUrl:   string,        // 微信头像 URL（注意：非 cloud://，是微信 CDN）
  createdAt:   Date,
  updatedAt:   Date
}
```

**为什么需要独立集合而不是写回 visits？**
- 一个访客可能多次访问多张名片 → 写一次 profile，所有 visits 记录受益
- 访客更新微信头像/昵称时只需更新一处
- 敏感数据独立管理，方便后续隐私合规审计

#### 4.2.3 visits 集合 Schema 扩展

```diff
  {
    cardId:         string,
    cardOwnerId:    string,
    visitorOpenId:  string,
    visitTime:      Date,
    visitCount:     number,
    actions:        [],
    source:         'direct',
+   visitorLevel:   'L1' | 'L2' | 'L3',   // 访客识别层级
+   visitorName:    string,                 // 访客显示名
+   visitorAvatar:  string,                 // 访客头像
+   visitorPosition: string,                // 职位（L3 才有）
+   visitorCompany: string,                 // 公司（L3 才有）
  }
```

#### 4.2.4 前端访客列表展示

| 层级 | 头像 | 名称 | 操作按钮 |
|------|------|------|---------|
| L3 | 真实头像 | 真实姓名 + 职位 | 「交换名片」→ 跳转其名片预览页 |
| L2 | 微信头像 | 微信昵称 | 「交换名片」→ 引导创建名片 |
| L1 | 默认头像 | 「访客 #A3F2」 | 「请问是谁」→ 引导授权/创建名片 |

#### 4.2.5 L1 匿名 ID 生成规则

```js
// 基于 openid 生成稳定的匿名标识
function anonymizeId(openid) {
  // 取后 4 位 hex，保证同一 openid 始终映射到同一匿名 ID
  const hash = openid.slice(-4).toUpperCase()
  return `访客 #${hash}`
}
```

### 4.3 Phase 2：来源归因

#### 4.3.1 recordVisit 云函数增强

```js
// cloudfunctions/initVisits/index.js — recordVisit case
case 'recordVisit': {
  const { cardId, visitorOpenId, cardOwnerId, source, sourceDetail, enterOptions } = data

  // 获取访客端场景信息（由前端传入）
  const scene = enterOptions?.scene || 0
  
  // 场景 → 来源标签映射
  const sceneLabels = {
    1007: '单聊分享', 1044: '群聊分享', 1154: '朋友圈',
    1011: '扫码', 1012: '长按扫码', 1013: '相册扫码',
    1001: '搜索', 1058: '公众号', 1038: '小程序返回'
  }
  
  const sourceLabel = source || sceneLabels[scene] || '未知来源'

  // 写入
  await db.collection('visits').add({
    data: {
      cardId, cardOwnerId, visitorOpenId,
      visitTime: now, visitCount: 1,
      source: sourceLabel,
      sourceDetail: sourceDetail || '',
      scene: scene,
      // ... 富化字段
    }
  })
}
```

#### 4.3.2 前端传入参数

```js
// preview/index.js — recordVisit
recordVisit(cardId, options) {
  const enterOptions = wx.getLaunchOptionsSync()
  // enterOptions = { scene: 1044, shareTicket: 'xxx', referrerInfo: {...} }

  wx.cloud.callFunction({
    name: 'initVisits',
    data: {
      action: 'recordVisit',
      data: {
        cardId,
        visitorOpenId,
        cardOwnerId: this.data.card._openid || '',
        source: options?.source || '',
        enterOptions: {
          scene: enterOptions.scene,
          shareTicket: enterOptions.shareTicket || ''
        }
      }
    }
  })
}
```

### 4.4 Phase 3：访客聚合画像

#### 4.4.1 新增云函数：getVisitorProfiles

```js
// cloudfunctions/initVisits — 新 action: getVisitorProfiles
case 'getVisitorProfiles': {
  const { cardOwnerId } = data

  // 聚合所有访问过该用户名片的访客
  const pipeline = [
    { $match: { cardOwnerId } },
    { $group: {
      _id: '$visitorOpenId',
      totalVisits: { $sum: '$visitCount' },
      firstVisit: { $min: '$visitTime' },
      lastVisit: { $max: '$visitTime' },
      cardsViewed: { $addToSet: '$cardId' },
      sources: { $addToSet: '$source' },
      visitorLevel: { $max: '$visitorLevel' },
      visitorName: { $last: '$visitorName' },
      visitorAvatar: { $last: '$visitorAvatar' }
    }},
    { $sort: { lastVisit: -1 } },
    { $limit: 50 }
  ]

  // 注意：小程序云开发的基础版不支持 aggregate
  // 降级方案：客户端分步查询 + 内存聚合
}
```

> ⚠️ **云开发基础版限制**：不支持 `aggregate` 管道。降级方案为客户端获取 visit 列表后做前端聚合，或升级到专业版。

### 4.5 授权引导时机设计

```
访客首次查看他人名片
  │
  ├─ 名片页面正常渲染（不需授权也能看）
  │
  ├─ 页面底部展示轻量授权条（非阻断式，不遮挡内容）
  │   ┌─────────────────────────────────────────┐
  │   │ 🔒 授权微信昵称后，名片主人可以看到您是谁  │
  │   │                          [授权] [暂不]   │
  │   └─────────────────────────────────────────┘
  │
  ├─ 点击「授权」
  │   └─ wx.getUserProfile({ desc: '用于名片主人识别您的身份' })
  │       ├─ 成功 → 写入 visitor_profiles → 刷新当前页面（下次 visit 可见）
  │       └─ 失败/取消 → 无操作
  │
  └─ 点击「暂不」
      └─ 关闭授权条，storage 记录「已拒绝」（7 天后重新询问）
```

**重要合规提示**：
- `wx.getUserProfile` 自 2024 年基础库 2.27.1 起，每次调用都需要用户手动确认（不能静默获取）
- 描述文案必须清晰说明用途
- 授权条不可遮挡页面核心内容，不可使用「诱导」文案

---

## 五、数据隐私与合规

### 5.1 数据收集声明

需在小程序隐私政策中补充：

> **访客信息收集说明**
> - 当您查看他人名片时，系统会记录您的访问时间、来源渠道
> - 若您主动授权微信昵称和头像，名片主人可在其访客列表中看到您的微信昵称和头像
> - 您的 openId 仅用于访客去重识别，不关联其他个人信息
> - 您可以随时在小程序设置中清除您的访客记录

### 5.2 用户数据权利

| 权利 | 实现方式 |
|------|---------|
| 查看自己被收集的数据 | 「我的 → 访客记录」中展示 |
| 删除自己的访客痕迹 | 功能待开发（清除 visitor_profiles + 相关 visits 记录） |
| 撤销授权 | 功能待开发（删除 visitor_profiles → 退回 L1） |

### 5.3 安全规则

```js
// visitor_profiles 集合权限
{
  "read": "doc._openid == auth.openid",    // 仅本人可读
  "write": "doc._openid == auth.openid"     // 仅本人可写
}
```

> ⚠️ 注意：名片主人不能直接读 visitor_profiles，而是由云函数在写入 visits 时做 enrichment，将昵称/头像**复制**到 visits 文档中。这样名片主人看到的 visits 中有 visitorName，但无法直接访问 visitor_profiles 集合。

---

## 六、实施计划

### P0 Fix（立即）

| 文件 | 行号 | 修改 |
|------|------|------|
| `miniprogram/pages/preview/index.js` | 37 | `res.result?.openid` → 改用 `app.getOpenId()` 获取 visitorOpenId |

### Phase 1：身份识别（1-2 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 新建 visitor_profiles 集合 | MP 云开发控制台 | 设置权限规则 |
| 扩展 visits Schema | `cloudfunctions/initVisits/index.js` | recordVisit 中查 cards + visitor_profiles 做 enrichment |
| 授权引导 UI | `miniprogram/pages/preview/index.wxml` + `.js` | 轻量授权条组件 |
| 聚合访客展示 | `miniprogram/pages/index/index.js` | 按 visitorOpenId 去重聚合 + L1/L2/L3 分层展示 |
| 前端列表适配 | `pages/index/` + `pages/visitors/` | visitorLevel 决定头像/名称/按钮 |

### Phase 2：来源归因（1 天）

| 任务 | 说明 |
|------|------|
| 前端传入 enterOptions | preview.js recordVisit 增加 scene + shareTicket |
| 云函数 source 映射 | scene → 中文来源标签 |
| 访客列表展示来源 | `visitors/index.wxml` 补充来源字段 |

### Phase 3：聚合画像（按需）

| 任务 | 说明 |
|------|------|
| 访客聚合查询 | 云函数或客户端聚合（取决于云开发版本） |
| 访客趋势图表 | 仪表盘新增「新访客 vs 回头客」等指标 |
| 访问导出 | 导出访客列表为 CSV 供 CRM 导入 |

---

## 七、风险与边界

| 风险 | 说明 | 缓解 |
|------|------|------|
| `wx.getUserProfile` 废弃 | 微信可能在某个版本彻底移除此 API | 已有降级：L3 查 cards → L1 匿名展示，L2 只是锦上添花 |
| 云开发 aggregate 不可用 | 基础版不支持聚合管道 | 客户端内存聚合（50 条以内性能无问题） |
| 隐私合规审查 | 收集微信昵称/头像需通过审核 | 隐私政策明确声明 + 用户主动授权 + 可删除 |
| openid 跨小程序不可用 | 同一微信用户在不同小程序 openid 不同 | 不影响（Ncard 是单小程序） |
| unionid 需要绑定开放平台 | 获取 unionid 需要额外的开放平台配置 | 当前需求不需要跨应用识别，openid 足够 |

---

## 八、决策点

需要确认以下事项后进入实施：

1. **L2 授权引导的交互形式**：全局弹窗（阻断式）还是底部通知条（非阻断式）？建议非阻断式，不干扰看名片的核心体验。

2. **visitor_profiles 独立集合**：同意新建还是复用现有 visits 的 visitorName 字段？强烈建议独立集合，后续维护成本更低。

3. **Phase 3 聚合画像的优先级**：是否需要与 Phase 1 一起做？建议先完成 P0 Fix + Phase 1 核心链路跑通，Phase 2/3 按需求迭代。

4. **用户数据删除机制**：是否需要在 MVP 中包含「访客删除自己的访问痕迹」功能？建议 MVP 阶段标注「开发中」，先确保核心追踪链路可用。
