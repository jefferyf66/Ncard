# Ncard 匿名访客追踪系统 — 实施总结

> 实施日期：2026-06-11  
> 修改文件：10 个  
> 状态：✅ 代码全部完成，待部署和回归

---

## 一、修改清单

### A 组 — P0 前置修复（5/5）

| # | 文件 | 行号 | 问题 | 修复 |
|---|------|------|------|------|
| A1 | `preview/index.js` | 29-75 | recordVisit 的 `res.result?.openid` 解析路径错误，visitorOpenId 永远为空 | 改用 `app.getOpenId()` |
| A2 | `index/index.js` | 88-118 | 指标卡「名片数」`cards.count()` 全量统计，与列表数字矛盾 | 添加 `where({ _openid })` |
| A3 | `index/index.js` | 152-185 | `_loadVisitorStatsDirect` 全量 count visits，无 cardOwnerId 过滤 | 添加 cardOwnerId 过滤 |
| A4 | `list/index.js` | 37-39 | user_save_cards 查询未显式过滤 _openid | 确认：默认权限自动过滤，无需改 |
| A5 | `visitors/index.js` | 29-78 | `cardOwnerId: ''` → 访客统计全量查询 | 传入 myOpenId |

### B 组 — 匿名访客身份识别（8/8）

| # | 文件 | 说明 |
|---|------|------|
| B1 | 云控制台 | ⚠️ 需手动创建 `visitor_profiles` 集合 |
| B2 | `cloudfunctions/initVisits/index.js` | recordVisit 增加三级身份 enrichment |
| B3 | `cloudfunctions/initVisits/index.js` | getRecentVisitors 无需修改 |
| B4 | `preview/index.wxml` + `wxss` | 底部授权通知条 UI |
| B5 | `preview/index.js` | _checkAuthBanner / onAuthUserInfo / dismissAuthBanner |
| B6 | `index/index.js` | _loadRecentVisitors 聚合 + _formatVisitorItem 分层 |
| B7 | `index/index.wxml` + `wxss` | 访客头像分层 + 等级标签 |
| B8 | `visitors/index.wxml` + `wxss` | 全量页同步三级展示 |

---

## 二、核心架构

```
用户打开他人名片
  │
  ├─ recordVisit() [preview.js]
  │   ├─ app.getOpenId() → visitorOpenId ✅
  │   └─ initVisits cloud function
  │       ├─ L3: 查 cards.where({ _openid }) → 真名/头像
  │       ├─ L2: 查 visitor_profiles.where({ _openid }) → 昵称/头像
  │       └─ L1: visitorLevel=1 → 前端显示 "访客 #XXXX"
  │
  ├─ L1 访客 → _checkAuthBanner()
  │   ├─ 检查冷却期 (7天)
  │   ├─ 3 秒后弹出底部授权条
  │   └─ 用户授权 → wx.getUserProfile → visitor_profiles.upsert
  │
  └─ 首页 onShow → _loadRecentVisitors()
      ├─ 取 20 条 visits
      ├─ _aggregateVisitors() 按 visitorOpenId 归并
      ├─ _formatVisitorItem() 三级展示
      └─ 取前 5 渲染
```

---

## 三、回归验证清单

| 场景 | 验证点 | 预期结果 |
|------|--------|---------|
| 自有名片预览 | 底部按钮 | 编辑 + 删除 |
| 他人名片首次查看 | 保存按钮 + 授权引导 | 显示「保存名片」+ 3 秒后授权条 |
| 授权条点击「授权」 | wx.getUserProfile → visitor_profiles | 微信授权弹窗 → 写入成功 |
| 授权条点击「暂不」 | 冷却期记录 | 7 天内不重复显示 |
| 他人名片二次查看 | L1 匿名展示 | "已保存" + "访客 #XXXX" 默认图标 |
| 首页名片数 | = cards.length | 数字一致 |
| 首页访客统计 | 按 cardOwnerId 过滤 | 仅显示自己名片的访客 |
| 名片夹列表 | 跨用户隔离 | 仅显示自己保存的他人名片 |
| 访客全量页 | 三级展示 | L3 真名/L2 昵称/L1 匿名标识 |

---

## 四、待用户操作

- [ ] **云控制台** → 创建 `visitor_profiles` 集合（权限：仅创建者可读写）
- [ ] **云函数** → 右键 `initVisits` → 上传并部署
- [ ] **回归测试** → 按上表逐项验证
- [ ] （可选）更新隐私政策，补充「访客授权信息收集」声明
