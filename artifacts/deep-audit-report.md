# Ncard 代码审核报告 — 深度诊断

> **审核日期**：2026-06-17
> **审核范围**：基于 `codebase-analysis-report.md` 识别的 5 个高优先级 + 7 个中优先级问题
> **审核方法**：逐文件读取源码，精确定位根因，验证影响范围

---

## 📊 问题清单总览

| # | 严重程度 | 问题摘要 | 涉及文件 | 实施批次 |
|---|---------|---------|---------|---------|
| 1 | 🔴 高 | getQrCode 云函数代码完全缺失 | `cloudfunctions/getQrCode/` | P0 |
| 2 | 🔴 高 | index.wxml 重复渲染节点 + 结构错误 | `pages/index/index.wxml` | P0 |
| 3 | 🔴 高 | initVisits/deleteCard 缺少 wx-server-sdk 依赖声明 | `cloudfunctions/{initVisits,deleteCard}/package.json` | P0 |
| 4 | 🟡 中 | selectDefaultCard 选择未持久化 | `pages/profile/index.js` | P1 |
| 5 | 🟡 中 | DOCUMENTATION.md 严重过时（10+ 处不一致） | `DOCUMENTATION.md` | P1 |
| 6 | 🟡 中 | DEPLOYMENT-GUIDE.md 过时（集合/功能/权限错误） | `DEPLOYMENT-GUIDE.md` | P1 |
| 7 | 🟡 中 | profile.loadCardList 无显式 _openid 过滤 | `pages/profile/index.js` | P1 |
| 8 | 🟡 中 | 主题选择仅本地持久化，无云同步 | `pages/profile/index.js` | P2 |
| 9 | 🟡 中 | handleAction/handleVisitorAction 空壳占位 | `pages/index/index.js` + `pages/visitors/index.js` | P2 |
| 10 | 🟡 中 | ES5/ES6 语法混用风格不一致 | 多文件（visitors/index.js 等） | P2 |
| 11 | 🟡 中 | sitemap.json 未做内容审核配置 | `miniprogram/sitemap.json` | P2 |
| 12 | 🟢 低 | edit 页跳转未注册的 crop 页面 | `pages/edit/index.js` | P2 |

---

## 🔍 逐项深度分析

---

### 问题 #1 · getQrCode 云函数代码完全缺失

**严重程度**：🔴 高（P0 — 阻塞上线）

**诊断结论**：
- `cloudfunctions/getQrCode/` 目录存在，但 `index.js` 文件**完全不存在**
- `Read` 调用确认路径 `cloudfunctions/getQrCode/index.js` 返回 `File does not exist`
- 目录下仅有 `package.json`（声明了 `wx-server-sdk` 依赖），无任何可执行代码
- 调用方：`pages/preview/index.js` 中名片分享/二维码生成功能依赖此云函数
- **影响**：二维码生成功能完全不可用，用户无法生成名片小程序码

**根因分析**：
可能是在历史重构中删除了扫描功能时误删了 `getQrCode/index.js`，或从未完成实现。`package.json` 残留说明此函数曾被规划。

**修复方案**：
```javascript
// cloudfunctions/getQrCode/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { cardId, page } = event
  try {
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: cardId,
      page: page || 'pages/preview/index',
      width: 430,
      isHyaline: true,
    })
    // 上传到云存储
    const ext = result.contentType === 'image/jpeg' ? 'jpg' : 'png'
    const uploadResult = await cloud.uploadFile({
      cloudPath: `qrcodes/${cardId}.${ext}`,
      fileContent: result.buffer,
    })
    return { fileID: uploadResult.fileID }
  } catch (err) {
    console.error('getQrCode error:', err)
    return { error: err.message || '生成小程序码失败' }
  }
}
```

**涉及文件**：
- `cloudfunctions/getQrCode/index.js`（新建）
- `cloudfunctions/getQrCode/package.json`（已存在，无需修改）
- `pages/preview/index.js`（确认调用方式是否匹配返回格式）

**修改影响**：
- 新增 1 个文件，部署后二维码生成功能恢复
- 需确认 preview 页的调用参数（`cardId` / `page`）是否与新接口一致
- 云存储 `qrcodes/` 路径需确认权限配置

**风险提示**：
- `wxacode.getUnlimited` 的 `scene` 参数最长 32 字符，cardId 若为长字符串需改用短 ID 映射
- 需确认 `pages/preview/index` 页面路径已在 app.json 注册（已确认存在）

---

### 问题 #2 · index.wxml 重复渲染节点 + 结构错误

**严重程度**：🔴 高（P0 — 阻塞上线）

**诊断结论**：
- 第 21-30 行：完整的 `<view class="empty-state">` 块，内含 `empty-title`、`empty-desc`、`empty-btn`
- 第 31-34 行：**裸露的** `empty-title`、`empty-desc`、`empty-btn` 重复出现，无父容器包裹
- 第 34 行的 `</view>` 闭合标签与第 35 行的 `</view>` 导致 WXML 结构嵌套错误
- **影响**：空状态时用户看到**双份内容**（标题、描述、按钮各出现两次），且闭合标签错位可能导致渲染异常

**根因分析**：
编辑者在修改 empty-state 区块时，可能是复制粘贴后忘记删除旧代码，或者重构时新增了包裹容器但未删除原有裸露子元素。

**修复方案**：
删除第 31-34 行的重复裸露节点，保留第 21-30 行完整的 `empty-state` 容器块。

**涉及文件**：
- `miniprogram/pages/index/index.wxml`（第 31-34 行删除）

**修改影响**：
- 纯模板修复，无逻辑变更
- 修复后空状态仅渲染一份内容，闭合标签正确

**风险提示**：
- 修改后需真机验证空状态显示正常
- 检查 `empty-state` 相关 WXSS 样式是否依赖当前错误的 DOM 结构

---

### 问题 #3 · initVisits/deleteCard 缺少 wx-server-sdk 依赖声明

**严重程度**：🔴 高（P0 — 部署阻塞）

**诊断结论**：
- `cloudfunctions/initVisits/package.json`：仅含 `{ name, version, description, main }`，**无 `dependencies` 字段**
- `cloudfunctions/deleteCard/package.json`：同上，**无 `dependencies` 字段**
- 对比：`getOpenId/package.json` 和 `resolveCloudUrls/package.json` 已正确声明 `"wx-server-sdk": "~2.6.3"`
- 两个云函数的 `index.js` 第 2 行均显式 `const cloud = require('wx-server-sdk')`
- **影响**：部署到云端后，`npm install` 不会安装 `wx-server-sdk`，云函数运行时 `require` 失败导致**冷启动崩溃**

**根因分析**：
创建云函数时使用了微信开发者工具的模板（仅含基础 package.json），未手动补充依赖声明。部分函数（getOpenId、resolveCloudUrls）在后续开发中被正确补充，但 initVisits 和 deleteCard 遗漏了。

**修复方案**：
```json
// cloudfunctions/initVisits/package.json
{
  "name": "initVisits",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "~2.6.3"
  }
}
```

```json
// cloudfunctions/deleteCard/package.json
{
  "name": "deleteCard",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "~2.6.3"
  }
}
```

**涉及文件**：
- `cloudfunctions/initVisits/package.json`
- `cloudfunctions/deleteCard/package.json`

**修改影响**：
- 仅补充依赖声明，不改变业务逻辑
- 部署后 `npm install` 自动安装 `wx-server-sdk`，冷启动正常

**风险提示**：
- 本地开发环境可能已有 `node_modules` 缓存，不会报错；**仅在全新部署时复现**
- 修复后需重新部署两个云函数到云端，并验证冷启动正常
- `wx-server-sdk` 版本号建议统一为 `~2.6.3`（与其他云函数保持一致）

---

### 问题 #4 · selectDefaultCard 选择未持久化

**严重程度**：🟡 中（P1 — 上线前修复）

**诊断结论**：
- `pages/profile/index.js` 第 112-117 行：`selectDefaultCard` 方法
- 当前行为：`wx.showToast({ title: '设置成功' })` + 关闭弹窗
- **问题**：选择结果未存入 `wx.setStorageSync`，也未写入云数据库
- **影响**：用户选择"默认名片"后，下次进入页面状态丢失，选择无效

**根因分析**：
功能只实现了 UI 交互（关闭弹窗 + 提示），遗漏了数据持久化步骤。

**修复方案**：

方案 A（本地优先，快速修复）：
```javascript
selectDefaultCard(e) {
  const cardId = e.currentTarget.dataset.id
  wx.setStorageSync('defaultCardId', cardId)
  this.setData({ defaultCardId: cardId, showDefaultCardPicker: false })
  wx.showToast({ title: '设置成功', icon: 'success' })
}
```

方案 B（云端持久化，多设备同步）：
在 `cards` 集合增加 `isDefault` 字段，选择时更新：
```javascript
async selectDefaultCard(e) {
  const cardId = e.currentTarget.dataset.id
  const db = wx.cloud.database()
  // 先清除旧默认
  await db.collection('cards').where({ _openid: '{openid}', isDefault: true })
    .update({ data: { isDefault: false } })
  // 设置新默认
  await db.collection('cards').doc(cardId).update({ data: { isDefault: true } })
  wx.setStorageSync('defaultCardId', cardId)
  this.setData({ defaultCardId: cardId, showDefaultCardPicker: false })
  wx.showToast({ title: '设置成功', icon: 'success' })
}
```

**涉及文件**：
- `pages/profile/index.js`（修改 `selectDefaultCard` 方法）
- `pages/index/index.js`（首页加载时读取默认名片 ID）

**修改影响**：
- 方案 A：仅本地生效，最小改动，但换设备不生效
- 方案 B：需数据库 schema 变更 + 云函数/客户端写入权限确认

**风险提示**：
- 方案 B 的 `where().update()` 在客户端受权限限制（仅创建者可写），需确认 `_openid` 自动过滤是否满足需求
- 建议先用方案 A 上线，后续迭代加云同步

---

### 问题 #5 · DOCUMENTATION.md 严重过时

**严重程度**：🟡 中（P1 — 上线前修复，避免误导）

**诊断结论**：
经逐行比对，DOCUMENTATION.md 存在**至少 10 处**与实际代码不一致：

| 行号 | 文档描述 | 实际代码 | 严重性 |
|------|---------|---------|-------|
| 48 | `scans` 集合 | 集合不存在，0 代码引用 | 高 |
| 64, 91 | `pages/crop/index` 裁切页 | app.json 未注册此页面 | 高 |
| 78 | `components/cloudTipModal` 组件 | 目录不存在 | 高 |
| 66 | TabBar 导航描述 | app.json 无 tabBar 配置 | 中 |
| 583 | `scope.camera` 权限 | app.json 未声明 | 中 |
| 584 | `scope.writePhotosAlbum` 权限 | app.json 未声明 | 中 |
| 566-576 | 8 个页面（含 crop） | 实际 7 个页面 | 中 |
| 500-517 | app.js 含 initPrivacy/showLoading/isValidPhone/debounce 等方法 | 实际 app.js 不存在这些方法 | 高 |
| 549-558 | app.wxss 含大量工具类 | 实际仅 43 行基础样式 | 中 |
| 627 | 版本历史 v1.2.0 | 实际为 v1.0.9+ | 低 |

**根因分析**：
文档在早期版本编写后，经历了多轮重构（删除扫描功能、删除自定义隐私弹窗、精简 app.js），但文档未同步更新。

**修复方案**：
全面重写 DOCUMENTATION.md，基于当前代码实际状态重新生成：
1. 删除所有 crop/scans/cloudTipModal 相关引用
2. 页面列表更新为 7 个实际页面
3. app.js 方法签名更新为当前版本
4. app.wxss 样式描述更新
5. 权限声明对齐 app.json
6. 版本信息对齐 RELEASE_NOTES.md

**涉及文件**：
- `DOCUMENTATION.md`（全面重写）

**修改影响**：
- 纯文档变更，无代码影响
- 消除新开发者/审核者被过时文档误导的风险

**风险提示**：
- 建议基于代码实际内容重新生成，而非逐条修补（修补可能遗漏其他不一致）
- 重写后需与代码交叉验证

---

### 问题 #6 · DEPLOYMENT-GUIDE.md 过时

**严重程度**：🟡 中（P1 — 上线前修复，避免部署错误）

**诊断结论**：
经逐行比对，DEPLOYMENT-GUIDE.md 存在以下关键不一致：

| 行号 | 文档描述 | 实际代码 | 严重性 |
|------|---------|---------|-------|
| 137 | 集合列表含 `scans`、`users` | 应为 `visits`、`visitor_profiles` | 高 |
| 153 | 索引建议引用 `scans` 集合 | 集合不存在 | 高 |
| 232 | 审核清单含 "OCR 扫描识别功能正常" | OCR 功能已移除 | 中 |
| 236 | 审核清单含 "TabBar 导航切换正常" | 无 TabBar 配置 | 中 |
| 201-212 | 权限声明含 `scope.userLocation`、`scope.writePhotosAlbum` | app.json 未声明 | 中 |
| 327 | 标签含 "扫描, OCR" | 功能已移除 | 低 |

**根因分析**：
同 DOCUMENTATION.md，重构后文档未同步。

**修复方案**：
1. 集合列表更新为 5 个活跃集合：cards / visits / user_save_cards / visitor_profiles / config
2. 删除 scans/users 相关引用和索引建议
3. 审核清单移除 OCR/TabBar 检查项，增加访客追踪/名片分享检查项
4. 权限声明对齐 app.json 实际声明
5. 标签移除 "扫描, OCR"，增加 "名片, 访客追踪"

**涉及文件**：
- `DEPLOYMENT-GUIDE.md`（修订）

**修改影响**：
- 纯文档变更，无代码影响
- 修正部署指南可避免运维人员创建错误的集合/索引

**风险提示**：
- 部署指南直接影响生产环境搭建，错误信息可能导致创建无用集合或遗漏必要集合

---

### 问题 #7 · profile.loadCardList 无显式 _openid 过滤

**严重程度**：🟡 中（P1 — 防御性编程）

**诊断结论**：
- `pages/profile/index.js` 第 102-109 行：`db.collection('cards').get()`
- 无 `.where({ _openid: app.getOpenId() })` 过滤
- 当前云数据库 cards 集合权限为「仅创建者可读写」，底层自动按 `_openid` 过滤
- **但**：若权限配置被误改为「所有用户可读」，则会泄露所有用户名片数据
- 代码语义上应显式表达"查询自己的名片"的意图

**根因分析**：
开发者依赖了云数据库权限的隐式过滤，未在查询层做防御性编码。

**修复方案**：
```javascript
async loadCardList() {
  const db = wx.cloud.database()
  const openid = app.getOpenId()
  const { data } = await db.collection('cards')
    .where({ _openid: openid })
    .get()
  this.setData({ cardList: data })
}
```

**涉及文件**：
- `pages/profile/index.js`（loadCardList 方法）

**修改影响**：
- 增加显式过滤，逻辑行为与当前一致（权限已是仅创建者可读）
- 代码语义更清晰，防御性更强

**风险提示**：
- `app.getOpenId()` 需确认在 profile 页 `onLoad` 时已初始化完成
- 参照 index 首页的写法（已使用 `.where({ _openid: myOpenId })`）

---

### 问题 #8 · 主题选择仅本地持久化，无云同步

**严重程度**：🟡 中（P2 — 上线后优化）

**诊断结论**：
- `pages/profile/index.js` 第 86-90 行：`selectTheme` 方法
- `wx.setStorageSync('themeColor', theme)` 仅本地存储
- 换设备/清缓存后主题偏好丢失
- **当前影响有限**：主题为个人偏好，丢失后用户重新选择即可

**根因分析**：
主题功能设计为纯前端体验，未规划云同步。

**修复方案**：
短期不修（P2），长期可考虑：
- 在 `visitor_profiles` 集合增加 `themeColor` 字段
- 选择时同步写入云端
- 首页/编辑页加载时从云端读取（本地缓存作为降级）

**涉及文件**：
- `pages/profile/index.js`
- `pages/index/index.js`、`pages/edit/index.js`（读取主题）

**修改影响**：
- 涉及数据库 schema 变更和多个页面读取逻辑
- 建议作为 v2.0 体验优化项

**风险提示**：
- 当前不影响核心功能，优先级低

---

### 问题 #9 · handleAction/handleVisitorAction 空壳占位

**严重程度**：🟡 中（P2 — 上线后优化）

**诊断结论**：
- `pages/visitors/index.js` 第 182-191 行：`handleAction` 方法
  ```javascript
  handleAction(e) {
    const action = e.currentTarget.dataset.action
    wx.showToast({ title: action, icon: 'none' })
  }
  ```
- `pages/index/index.js` 第 818-827 行：`handleVisitorAction` 同样仅 showToast
- 用户点击访客操作按钮（如"查看详情"、"发消息"等），仅弹出 Toast 文字，无实际功能

**根因分析**：
访客操作功能作为 UI 占位预留，后端交互逻辑尚未实现。

**修复方案**：
短期（上线前）：移除空壳按钮，避免用户困惑
长期：实现具体交互逻辑（查看访客名片、发消息等）

**涉及文件**：
- `pages/visitors/index.js`（handleAction）
- `pages/visitors/index.wxml`（操作按钮模板）
- `pages/index/index.js`（handleVisitorAction）
- `pages/index/index.wxml`（访客操作按钮）

**修改影响**：
- 移除按钮：UI 变更，用户无法看到不可用的操作入口
- 实现功能：需设计完整的访客交互流程

**风险提示**：
- 空壳按钮上线会导致用户体验差（点击无反应只有 Toast）
- 建议上线前至少隐藏空壳操作入口

---

### 问题 #10 · ES5/ES6 语法混用风格不一致

**严重程度**：🟡 中（P2 — 上线后优化）

**诊断结论**：
- `pages/visitors/index.js` 全文使用 `var` / `function()` ES5 风格
- 其他页面（index、edit、profile）已使用 `const/let` / 箭头函数
- 同一项目内风格割裂，增加维护成本

**根因分析**：
visitors 页面可能由不同开发阶段/不同模板生成。

**修复方案**：
统一为 ES6+ 风格：
- `var` → `const`/`let`
- `function()` → 箭头函数（适当场景）
- 回调嵌套 → async/await（适当场景）

**涉及文件**：
- `pages/visitors/index.js`（主要需修改）
- 其他文件抽查确认一致性

**修改影响**：
- 纯语法重构，不改变业务逻辑
- 需充分测试确保无回归

**风险提示**：
- 微信小程序基础库 2.x 已全面支持 ES6，无兼容性风险
- 建议配合 ESLint 规则统一风格

---

### 问题 #11 · sitemap.json 未做内容审核配置

**严重程度**：🟡 中（P2 — 上线后优化）

**诊断结论**：
- 当前 `sitemap.json` 内容：`{ "rules": [{ "action": "allow", "page": "*" }] }`
- 所有页面均允许微信搜索引擎收录
- 名片详情页（preview）包含用户个人信息（手机号、邮箱等），不应被公开搜索
- **影响**：用户名片信息可能被微信搜索索引，存在隐私泄露风险

**根因分析**：
使用开发者工具创建项目时的默认配置，未根据业务特点调整。

**修复方案**：
```json
{
  "rules": [
    {
      "action": "allow",
      "page": "pages/index/index"
    },
    {
      "action": "disallow",
      "page": "pages/preview/index"
    },
    {
      "action": "disallow",
      "page": "pages/visitors/index"
    },
    {
      "action": "disallow",
      "page": "pages/list/index"
    },
    {
      "action": "disallow",
      "page": "pages/profile/index"
    },
    {
      "action": "allow",
      "page": "pages/edit/index"
    }
  ]
}
```

**涉及文件**：
- `miniprogram/sitemap.json`

**修改影响**：
- 仅影响微信搜索收录，不影响小程序内功能
- 首页和编辑页允许收录（公开内容），其他页面禁止

**风险提示**：
- 需确认哪些页面确实需要被搜索收录
- sitemap.json 配置不影响小程序内页面跳转和分享

---

### 问题 #12 · edit 页跳转未注册的 crop 页面

**严重程度**：🟢 低（P2 — 上线后优化）

**诊断结论**：
- `pages/edit/index.js` 第 98-128 行：`chooseAvatar()` 方法
- 内含 `wx.navigateTo({ url: '/pages/crop/index' })` 跳转
- `app.json` 未注册 `pages/crop/index` 页面
- 实际执行时 `navigateTo` 会失败（页面不存在）
- 但当前代码已有降级路径（chooseMedia/chooseImage 三级降级），crop 跳转可能处于死代码路径

**根因分析**：
早期设计了头像裁切功能，后因复杂度移除 crop 页面，但 edit.js 中的跳转代码未清理。

**修复方案**：
删除 `chooseAvatar` 中指向 crop 页面的跳转代码，仅保留 `chooseMedia/chooseImage` + 直接上传流程。

**涉及文件**：
- `pages/edit/index.js`（chooseAvatar 方法）

**修改影响**：
- 删除死代码路径，不改变现有可执行路径
- 头像选择流程仍通过 chooseMedia/chooseImage → 直接上传到云存储

**风险提示**：
- 需确认当前头像选择流程的完整可用性
- 删除前需验证 crop 跳转确实处于不可达路径

---

## 🏗️ 实施优先级建议

### P0 — 阻塞上线（必须修复）

| # | 问题 | 预估工作量 | 依赖项 |
|---|------|----------|--------|
| 1 | getQrCode 云函数缺失 | 30 分钟 | 确认 preview 页调用方式 |
| 2 | index.wxml 重复渲染 | 5 分钟 | 无 |
| 3 | 依赖声明缺失 | 5 分钟 | 重新部署云函数验证 |

### P1 — 上线前修复（避免误导/风险）

| # | 问题 | 预估工作量 | 依赖项 |
|---|------|----------|--------|
| 4 | selectDefaultCard 未持久化 | 15 分钟（方案A）/ 60 分钟（方案B） | 确认默认名片业务需求 |
| 5 | DOCUMENTATION.md 过时 | 90 分钟 | 与代码交叉验证 |
| 6 | DEPLOYMENT-GUIDE.md 过时 | 45 分钟 | 与代码交叉验证 |
| 7 | loadCardList 无显式过滤 | 5 分钟 | 确认 getOpenId 可用 |

### P2 — 上线后优化（体验/规范改进）

| # | 问题 | 预估工作量 | 依赖项 |
|---|------|----------|--------|
| 8 | 主题选择无云同步 | 60 分钟 | 数据库 schema 变更 |
| 9 | 空壳操作按钮 | 30 分钟（隐藏）/ 数天（实现） | 访客交互流程设计 |
| 10 | ES5/ES6 风格混用 | 60 分钟 | 充分回归测试 |
| 11 | sitemap.json 配置 | 15 分钟 | 确认收录策略 |
| 12 | crop 页面死代码 | 10 分钟 | 验证头像选择流程 |

---

## 📝 总结

**P0 共 3 项**，均为可直接导致功能故障或部署失败的问题，建议作为上线前的必要修复项。其中 #2（WXML 重复渲染）修复最简单（删 4 行），#3（依赖声明）修复最快（加 2 行），#1（getQrCode 缺失）需新建代码文件。

**P1 共 4 项**，不修复不会导致崩溃，但会造成文档误导（#5/#6）、功能形同虚设（#4）、或防御性缺失（#7）。建议上线前完成。

**P2 共 5 项**，属于体验优化和代码规范层面，可在上线后按迭代计划逐步处理。

---

> **下一步**：用户审核确认本报告后，按 P0 → P1 → P2 顺序执行修复。
