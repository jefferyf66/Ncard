# 方案 A 交付概览：名片访问数据归位于详情页（per-card）

> 决策来源：用户拍板「访问数据应随具体名片走，移出首页、落到名片详情页」。
> 约束：每步独立 git 提交成回滚锚点；后端 `initVisits` 改动保持向后兼容。

## 一、改动内容（4 个回滚锚点，本地 main，未推远程）

| 锚点 | 范畴 | 关键改动 |
|---|---|---|
| `d06edab` | 后端云函数 | `initVisits` 三聚合 action 增加**可选** `cardId`，缺省全局、传入单卡，向后兼容 |
| `a59779b` | 首页 `index` | 移除「名片数据」三宫格 + 最近访客列表；新增轻量「名片夹」导航入口；清理 4 个死代码图标样式 + 悬空注释（删 643 行） |
| `8d53ecd` | 详情页 `preview` | 新增「访客分析」区（`wx:if isOwner`）：总访客 / 重复访问 / 最近访客 Top5，「查看全部 ›」跳单卡筛选 |
| `63d3157` | 访客页 `visitors` | 支持 `?cardId=` 单卡筛选；单卡模式头部显「本名片访客」+ 卡片名，第三指标自适应为「最近访客」，新增「全部名片 ›」回全局 |

## 二、关键设计决策

1. **per-card 过滤有数据模型支撑**：`visits` 集合每条记录已挂 `cardId` + `cardOwnerId`，所谓"全局聚合"原只按 `cardOwnerId`——本质是伪聚合。新增 `cardId` 维度补齐真实 per-card 口径。
2. **向后兼容**：`cardId` 在所有聚合 action 中可选，不传则维持旧行为，不影响任何现有调用。
3. **名片夹数天然归位**：`list` 页头部本就显示「名片夹 / N 张名片」，故"名片夹数移出首页"无需改代码（Task #137 实质已完成）。
4. **详情页访客分析仅对名片主人可见**（`isOwner`），非主人无此区块，避免越权暴露他人访客。

## 三、数据流

```
preview（自有名片）
  └─ 头部「访客分析」→ loadVisitorAnalytics(cardId, cardOwnerId)
       ├─ getMyVisitorStats{cardOwnerId, cardId}      → 总访客 / 重复访问
       └─ getRecentVisitors{cardOwnerId, cardId, 5}  → Top5 列表
  └─ 「查看全部 ›」→ /pages/visitors/index?cardId=XXX
visitors（?cardId=）
  └─ mode: 'card' → 头部显卡片名、第三指标=最近访客、提供「全部名片 ›」回全局
```

## 四、待办 / 风险提示

- ⚠️ **必须重新上传部署 `initVisits` 云函数**（`d06edab` 改了云端代码，不上线则详情页/访客页单卡筛选读不到数据）。
- 本地 main 领先 `origin/main` 一批提交（含本方案 + 此前 Phase 1/团队目录等），**推送远程 + 打 tag 待你拍板**。
- 真机联调建议：用已有名片分享给另一微信账号，验证详情页访客分析出现数据、访客页 `?cardId=` 正确按单卡过滤。

## 五、回滚方式

任一里程碑出问题，单文件干净回退：
```bash
git checkout a59779b -- miniprogram/pages/index/      # 仅回滚首页
git checkout 8d53ecd -- miniprogram/pages/preview/    # 仅回滚详情页
git checkout 63d3157 -- miniprogram/pages/visitors/   # 仅回滚访客页
git checkout d06edab -- cloudfunctions/initVisits/    # 仅回滚云函数
```
