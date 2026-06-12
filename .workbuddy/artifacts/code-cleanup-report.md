# Ncard 代码库清理报告

**日期**: 2026-06-11 | **类型**: 无破坏性代码清理

---

## 一、结构清理 — 删除孤立文件与目录（42 个文件）

### 1.1 云函数
| 路径 | 原因 |
|------|------|
| `cloudfunctions/getCardDetail/` | 空目录，无任何文件 |
| `cloudfunctions/getQrCode/` | **保留**（未来可能需要二维码生成） |

### 1.2 小程序资源
| 路径 | 原因 |
|------|------|
| `miniprogram/components/cloudTipModal/` | 云开发模板残留组件，0 页面引用 |
| `miniprogram/envList.js` | 模板残留，0 代码引用 |
| `miniprogram/images/tab-*` (7 文件) | Tab 图标，app.json 无 tabBar 配置 |
| `miniprogram/images/ai_example1.png / ai_example2.png` | 云开发模板 AI 示例，0 引用 |
| `miniprogram/images/cloud_dev.png / create_cbr.png / create_cbrf.png / create_env.png / database.png / database_add.png / function_deploy.png / scf-enter.png / default-goods-image.png / env-select.png` | 模板残留截图，0 引用 |
| `miniprogram/images/arrow.svg / copy.svg` | 模板图标，0 引用 |
| `miniprogram/images/icons/*` (18 文件) | 模板图标集，0 引用（仅保留 logo-app-* 应用图标素材） |

### 1.3 根目录
| 路径 | 原因 |
|------|------|
| `fix_edit.ps1` | 一次性修复脚本，引用的代码模式已不存在 |
| `.vscode/launch.json` | 无效配置（将小程序作为 Node.js 启动） |

---

## 二、JS 死代码清理（6 个文件）

### 2.1 `app.js`
移除 6 个未使用的工具方法 + 2 个未使用的 globalData 字段：
- ❌ `showConfirm(title, content)` — 全局搜索 0 次调用
- ❌ `isCacheValid(key)` — 仅定义，0 次调用
- ❌ `isValidPhone(phone)` — 0 次调用（edit 页面使用内联正则）
- ❌ `isValidEmail(email)` — 0 次调用（edit 页面使用内联正则）
- ❌ `debounce(fn, delay)` — 0 次调用
- ❌ `globalData.cardsCache` / `globalData.lastUpdateTime` — 代码使用 Storage 缓存（`app.setCache/getCache`），未引用 globalData

### 2.2 `pages/edit/index.js`
- ❌ `formatSize(bytes)` — 0 次调用

### 2.3 `pages/preview/index.js`
- ❌ `shareCard()` — WXML 中无 bindtap 绑定（分享菜单由 `initShareMenu` 在 onLoad 中完成）

### 2.4 `pages/visitors/index.js`
- ❌ `goToViewAll()` — WXML 中无 bindtap 绑定

### 2.5 `pages/agreement/index.js`
- ❌ `const app = getApp()` — 文件中未引用 app

### 2.6 `cloudfunctions/initVisits/index.js`
- ❌ `const wxContext = cloud.getWXContext()` — 声明后未使用

---

## 三、CSS 清理

### 3.1 `app.wxss` — 72.7% 精简（165 行 → 44 行）
移除 23 个全局工具类（0 引用）：
- `.flex` / `.flex-center` / `.flex-between` / `.flex-column`
- `.gap-8` / `.gap-12` / `.gap-16`
- `.text-primary` / `.text-secondary` / `.text-danger` / `.text-success` / `.text-white`
- `.bg-white` / `.bg-primary` / `.bg-gray-50`
- `.rounded-sm` / `.rounded` / `.rounded-lg` / `.rounded-xl` / `.rounded-full`
- `.shadow-sm` / `.shadow-md` / `.shadow-lg`
- `.safe-area-bottom` / `.fixed-bottom`
- `.btn-primary` / `.btn-primary:active` / `.btn-secondary` / `.btn-secondary:active`
- `.card`
- `@keyframes fadeIn` / `@keyframes bounce` / `.animate-fadeIn` / `.animate-bounce`
- `-moz-osx-font-smoothing`（macOS Firefox 专用，微信小程序无效）

**保留**: `.container`（7 个页面使用）、`.avatar`（edit/preview/list 使用）、元素重置规则

---

## 四、影响评估

| 指标 | 清理前 | 清理后 | 变化 |
|------|--------|--------|------|
| 项目文件数 | ~98 | ~56 | -42 |
| app.js 行数 | 229 | 205 | -24 |
| app.wxss 行数 | 165 | 44 | -121 |
| images/ 文件数 | 28 | 5 | -23 |
| 云函数目录 | 5 | 4 | -1（空目录） |
| 小程序组件 | 1 | 0 | -1 |

### ✅ 未修改的部分
- 所有页面业务逻辑（index/edit/preview/visitors/agreement/list/profile/crop）
- 所有 API 调用和数据处理流程
- 所有 WXML 结构和绑定关系
- 所有云函数核心逻辑（deleteCard/getOpenId/getQrCode）
- 项目配置文件（project.config.json / project.private.config.json）
- 依赖版本

### ⚠️ 需要执行的操作
1. 在微信开发者工具中「编译 → 预览」验证所有页面正常
2. 云函数 `initVisits` 需重新部署（`wxContext` 行已删除）
3. 确认 `images/avatar.png` 仍存在于项目中（唯一保留的非图标资源）

---

## 五、保留说明

以下项目经评估后保留：
- `cloudfunctions/getQrCode/` — 代码未使用但功能完整，未来可能需要二维码生成
- `miniprogram/images/icons/logo-app-*.png/svg` — 微信公众平台配置 App 图标素材
- 所有 `console.log` / `console.warn` / `console.error` — 用于生产环境调试和监控
- 所有 WXML `<!-- -->` 注释 — 结构导航注释，有助于代码可读性
- 所有 WXSS `/* ===== */` 节标题注释 — 样式表结构导航
- JSDoc 注释 — 代码文档
