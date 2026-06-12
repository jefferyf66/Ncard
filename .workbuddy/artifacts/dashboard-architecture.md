# 首页仪表盘数据获取架构技术设计

> 版本：v1.0 | 日期：2026-06-11 | 作者：Ncard 技术组
> 运行时环境：微信原生小程序 + 云开发（DYNAMIC_CURRENT_ENV）

---

## 目录

1. [环境适配说明](#0-环境适配说明)
2. [一、指标卡取数方案](#一指标卡取数方案)
3. [二、计算逻辑与数据处理](#二计算逻辑与数据处理)
4. [三、数据可信性评估与容错机制](#三数据可信性评估与容错机制)
5. [四、最近访客列表渲染与交互](#四最近访客列表渲染与交互)
6. [五、组件结构示意](#五组件结构示意)
7. [附：BUG 清单 & 改进对比](#附bug-清单--改进对比)

---

## 0. 环境适配说明

### 0.1 语言限定

用户要求以 **TypeScript** 输出，但本项目运行时是**微信原生小程序（JS）**。TS 在此作为**设计语言**，使用 JSDoc 注释 + 接口定义来约束实现，实际运行时无需 TS 编译器。

**映射关系**：

| TS 构造 | 实际 JS 写法 |
|---------|-------------|
| `interface` | JSDoc `@typedef` 注释 |
| `enum` | `const` 对象 + JSDoc |
| `as` 类型断言 | 无需转换 |
| `Promise<T>` | 原生 Promise |

### 0.2 分支策略说明

本项目实现存在三个重要分支，均需在实施时同步修复：

```
                                  ┌─ 主路径（云函数 initVisits）
数据查询请求 ──┤
               ├─ 降级路径（直查 DB）── 缺少 cardOwnerId 过滤 ◀── BUG
               └─ 缓存路径（本地 Storage）
```

本架构统一三条路径的过滤条件与返回结构。

---

## 一、指标卡取数方案

### 1.1 数据架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                     首页 Page (pages/index)                      │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ DashboardService │  │   CacheManager   │  │ UIRenderer    │  │
│  │  (数据获取)      │  │   (缓存策略)     │  │ (降级视觉)    │  │
│  └───────┬─────────┘  └───────┬──────────┘  └───────┬───────┘  │
│          │ fetchDashboard()    │                      │          │
│          ▼                    ▼                      ▼          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    DataSourceRouter                        │   │
│  │                                                           │   │
│  │   Priority: 云函数(主) → 直查DB(降级1) → 缓存(降级2)       │   │
│  └──────────────────────────────────────────────────────────┘   │
│          │                 │                 │                   │
│          ▼                 ▼                 ▼                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ initVisits   │  │  直查 DB     │  │  Storage     │          │
│  │ 云函数       │  │  cards.count │  │  Cache       │          │
│  └──────────────┘  │  visits.count│  └──────────────┘          │
│                    └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 核心 TypeScript 接口定义

```typescript
// ============================================================
// dashboard.types.ts — 仪表盘领域模型
// ============================================================

/** 时间范围枚举 */
enum TimeRange {
  TODAY      = 'today',
  THIS_WEEK  = 'this_week',
  THIS_MONTH = 'this_month',
  CUSTOM     = 'custom',
}

/** 数据新鲜度 */
enum DataFreshness {
  LIVE    = 'live',     // 实时，< 1 分钟
  RECENT  = 'recent',   // 近 5 分钟
  STALE   = 'stale',    // 5~30 分钟
  FALLBACK = 'fallback', // 降级快照
}

/** 数据源标识 */
enum DataSource {
  CLOUD_FUNCTION  = 'cloud_function',
  DIRECT_DB       = 'direct_db',
  LOCAL_CACHE     = 'local_cache',
  EMPTY_FALLBACK  = 'empty_fallback',
}

/** 单个指标卡数据 */
interface IndicatorCard {
  label: string;           // 显示标签，如 "我的访客"
  value: number;           // 数值
  prevValue?: number;      // 上一周期对比值（用于趋势箭头）
  trend?: 'up' | 'down' | 'flat';
  freshness: DataFreshness;
  source: DataSource;
  tooltip?: string;        // 悬浮说明文案
}

/** 访客记录 */
interface VisitorRecord {
  id: string;
  cardId: string;
  cardName?: string;       // 关联的名片名称（连表查询）
  visitorOpenId: string;
  visitorName?: string;
  visitorPosition?: string;
  visitTime: number;       // Unix 毫秒时间戳
  visitCount: number;
  source: VisitSource;
  actions: VisitorAction[];
}

type VisitSource = 'direct' | 'share' | 'qrcode' | 'search';
type VisitorAction = 'viewed' | 'saved' | 'called' | 'emailed';

/** 仪表盘完整数据 */
interface DashboardData {
  indicators: IndicatorCard[];
  recentVisitors: VisitorRecord[];
  fetchMeta: {
    timestamp: number;
    costMs: number;
    source: DataSource;
    freshness: DataFreshness;
  };
}

/** 仪表盘查询参数 */
interface DashboardQuery {
  timeRange: TimeRange;
  customStart?: number;    // Unix 毫秒
  customEnd?: number;
  ownerOpenId: string;     // 统计归属，当前用户 openId
}

/** 数据获取结果封装（统一错误处理） */
interface FetchResult<T> {
  ok: boolean;
  data?: T;
  source: DataSource;
  error?: string;
  fallbackReason?: string;  // 降级原因
}
```

### 1.3 指标一：「我的访客」(`visitors`)

| 维度 | 定义 |
|------|------|
| **数据源主表** | `visits` |
| **API 接口** | 云函数 `initVisits` — `action: 'getMyVisitorStats'` |
| **降级接口** | `db.collection('visits').where({ cardOwnerId }).count()` |
| **业务语义** | 在当前时间范围内，访问过「我创建的任一名片」的**去重访客数** |
| **当前 BUG** | 降级路径缺少 `cardOwnerId` 过滤，统计所有用户的访客总量 |

#### 查询条件（SQL 等价表述）

```sql
-- 主路径（云函数）
SELECT COUNT(*) AS visitors
FROM visits
WHERE cardOwnerId = :currentOpenId
  AND visitTime >= :timeStart
  AND visitTime <  :timeEnd;

-- 改进后：按 visitorOpenId 去重计数
SELECT COUNT(DISTINCT visitorOpenId) AS visitors
FROM visits
WHERE cardOwnerId = :currentOpenId
  AND visitTime >= :timeStart
  AND visitTime <  :timeEnd;
```

#### 时间范围映射

```typescript
function resolveTimeRange(range: TimeRange, custom?: { start: number; end: number }): { start: number; end: number } {
  const now = Date.now();
  const dayStart = new Date(new Date().toDateString()).getTime();

  switch (range) {
    case TimeRange.TODAY:
      return { start: dayStart, end: now };
    case TimeRange.THIS_WEEK: {
      const dayOfWeek = new Date().getDay();
      const monday = dayStart - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 86400000;
      return { start: monday, end: now };
    }
    case TimeRange.THIS_MONTH: {
      const d = new Date();
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      return { start: monthStart, end: now };
    }
    case TimeRange.CUSTOM:
      return { start: custom?.start ?? 0, end: custom?.end ?? now };
    default:
      return { start: 0, end: now }; // 不限时间
  }
}
```

> **注意**：当前 `recordVisit` 云函数存在 P0 Bug（`res.result.openid` 路径错误），访客数据完全无法写入。修复之后才能产生有效统计数据。修复方案见附录 A.1。

#### 云函数增强（getMyVisitorStats 改造）

```javascript
// cloudfunctions/initVisits/index.js — action: getMyVisitorStats
case 'getMyVisitorStats': {
  const { cardOwnerId, timeStart, timeEnd } = data;

  // 构建时间 + 所有者复合过滤条件
  const whereClause = { cardOwnerId };
  if (timeStart !== undefined || timeEnd !== undefined) {
    whereClause.visitTime = {};
    if (timeStart) whereClause.visitTime = db.command.gte(new Date(timeStart));
    if (timeEnd)   whereClause.visitTime = { ...whereClause.visitTime, ...db.command.lt(new Date(timeEnd)) };
  }

  // 访客总数 → 改为 DISTINCT visitorOpenId
  // 云开发不支持聚合管道，使用客户端后处理
  const rawVisits = await db.collection('visits')
    .where(whereClause)
    .field({ visitorOpenId: true, visitCount: true })
    .limit(1000)   // 客户端上限
    .get();

  const uniqueVisitors = new Set();
  let repeatCount = 0;
  for (const v of rawVisits.data) {
    uniqueVisitors.add(v.visitorOpenId);
    if (v.visitCount > 1) repeatCount++;
  }

  return {
    ok: true,
    visitors: uniqueVisitors.size,
    viewed: repeatCount,
    totalRecords: rawVisits.data.length,
    // 数据量超过 1000 时的兜底标记
    isPartial: rawVisits.data.length >= 1000,
  };
}
```

> **说明**：微信云开发 `db.command.aggregate` 管道中的 `$group` 有 1000 条默认上限（可设 `maxTimeMS` 但无法突破）。当数据量 < 1000 时精确去重；超过后标记 `isPartial: true`，前端可切换为近似统计。

### 1.4 指标二：「多次来访」(`viewed`)

| 维度 | 定义 |
|------|------|
| **数据源主表** | `visits` |
| **聚合函数** | `COUNT(*) WHERE visitCount > 1`（当前）→ 建议改为 `COUNT(DISTINCT visitorOpenId) WHERE visitCount >= 2` |
| **业务语义** | 在一个时间周期内同一访客多次访问同一名片的行为数（当前）；改进后为「回头访客的独立人数」 |
| **命名建议** | 当前名称"多次来访"易与总访客数混淆 → 建议改为 **"回头访客"** 或 **"高频访问"** |

#### 数学公式

```
// 当前公式（存在歧义）
多次来访数 = COUNT(visits WHERE cardOwnerId = X AND visitCount > 1)

// 改进公式（语义更清晰）
回头访客数 = COUNT(DISTINCT visitorOpenId WHERE cardOwnerId = X AND visitCount >= 2)
```

#### 字段映射

| 统计含义 | visits 字段 | 过滤条件 |
|---------|------------|---------|
| 总访客记录数 | `COUNT(*)` | `cardOwnerId = X` |
| 独立访客数 | `COUNT(DISTINCT visitorOpenId)` | `cardOwnerId = X` |
| 多次来访记录数 | `COUNT(*) WHERE visitCount > 1` | `cardOwnerId = X` |
| **回头访客独立人数** | `COUNT(DISTINCT visitorOpenId) WHERE visitCount >= 2` | `cardOwnerId = X` |

### 1.5 指标三：「名片数」(`newCards`)

| 维度 | 定义 |
|------|------|
| **数据源表** | `cards` |
| **API 接口** | `db.collection('cards').where({ _openid: myOpenId }).count()` |
| **业务语义** | 当前用户创建的名片总数 |
| **当前 BUG** | 缺少 `_openid` 过滤，统计了全量用户的名片总和 🔴 P0 |

#### 修复后的取数逻辑

```typescript
// 伪代码
async function fetchCardCount(myOpenId: string): Promise<FetchResult<number>> {
  // 主路径
  try {
    const res = await db
      .collection('cards')
      .where({ _openid: myOpenId })
      .count();
    return { ok: true, data: res.total, source: DataSource.DIRECT_DB };
  } catch (err) {
    // 降级 1：尝试无过滤 count（最后手段）
    try {
      const res = await db.collection('cards').count();
      return {
        ok: true,
        data: res.total,
        source: DataSource.DIRECT_DB,
        fallbackReason: 'openId 过滤失败，使用全量统计（数值可能偏高）',
      };
    } catch (err2) {
      // 降级 2：返回缓存
      const cached = getCache('dashboard:cardCount');
      if (cached !== null) {
        return { ok: true, data: cached, source: DataSource.LOCAL_CACHE };
      }
      return { ok: false, source: DataSource.EMPTY_FALLBACK, error: '数据不可用' };
    }
  }
}
```

#### 与列表数量的数据一致性

```typescript
// 首页有两处显示名片数量，必须来自同一数据源
// BEFORE (不一致)：标题=cards.length, 指标卡=cards.count()
// AFTER  (一致)：  标题=indicators.cardCount, 指标卡=indicators.cardCount

interface PageData {
  cards: Card[];                           // 名片列表（分页）
  indicators: {
    visitors: IndicatorCard;               // 我的访客
    viewed: IndicatorCard;                 // 回头访客
    cardCount: IndicatorCard;              // 名片数 ← 统一来源
  };
}
```

### 1.6 统一取数入口 `fetchDashboard()`

```typescript
/**
 * 仪表盘数据统一获取入口
 * 
 * 设计原则：
 * 1. 一个入口，三种数据并行获取
 * 2. AllSettled 模式：单指标失败不影响其他指标
 * 3. 每条数据带 source + freshness 元信息
 * 4. 缓存优先用于渲染，后台静默刷新
 */
async function fetchDashboard(query: DashboardQuery): Promise<DashboardData> {
  const startTime = Date.now();

  // 并行获取三个指标（不互相阻塞）
  const [visitorResult, repeatResult, cardCountResult, recentResult] =
    await Promise.allSettled([
      fetchVisitorCount(query),
      fetchRepeatVisitorCount(query),
      fetchCardCount(query.ownerOpenId),
      fetchRecentVisitors(query),
    ]);

  const costMs = Date.now() - startTime;

  return {
    indicators: [
      buildIndicator('我的访客', visitorResult),
      buildIndicator('回头访客', repeatResult),
      buildIndicator('名片数', cardCountResult),
    ],
    recentVisitors: unwrapSettled(recentResult) ?? [],
    fetchMeta: {
      timestamp: Date.now(),
      costMs,
      source: computeOverallSource([visitorResult, repeatResult, cardCountResult]),
      freshness: computeFreshness(costMs),
    },
  };
}
```

---

## 二、计算逻辑与数据处理

### 2.1 指标聚合公式矩阵

| 指标 | 主公式 | 备选公式（降级） | 去重策略 |
|------|--------|-----------------|---------|
| 我的访客 | `COUNT(DISTINCT visitorOpenId)` | `COUNT(*)` — 近似值 | 客户端 Set 去重 |
| 回头访客 | `COUNT(DISTINCT visitorOpenId) WHERE visitCount ≥ 2` | `COUNT(*) WHERE visitCount > 1` — 去掉重 | 同上去重 |
| 名片数 | `COUNT(*) WHERE _openid = me` | `COUNT(*)` — 兜底（有偏差） | 无需去重 |

### 2.2 异常值处理策略

```typescript
// ============================================================
// dashboard.anomaly.ts — 异常值处理
// ============================================================

/** 空值填充规则 */
const EMPTY_FALLBACK: Record<string, number> = {
  visitors: 0,
  viewed: 0,
  cardCount: 0,
};

/** 离群值剔除（适用于趋势对比） */
function removeOutliers(values: number[], threshold = 3): number[] {
  if (values.length < 4) return values; // 样本太小不剔除
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return values.filter(v => Math.abs(v - mean) <= threshold * std);
}

/** 数据精度保留 */
function formatStatValue(value: number): string {
  if (value >= 10000) return (value / 10000).toFixed(1) + 'w';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
  return String(value);
}

/** 趋势计算（与上一周期比较） */
function computeTrend(current: number, previous?: number): IndicatorCard['trend'] {
  if (previous === undefined || previous === 0) return 'flat';
  const delta = (current - previous) / previous;
  if (delta > 0.05) return 'up';
  if (delta < -0.05) return 'down';
  return 'flat';
}
```

### 2.3 缓存策略

```typescript
// ============================================================
// dashboard.cache.ts — 多层缓存
// ============================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;          // 过期时间 ms
  source: DataSource;
}

interface CacheConfig {
  /** 指标数据缓存 TTL */
  indicatorTTL: number;         // 默认 5 分钟 = 300000ms
  /** 最近访客列表 TTL */
  recentVisitorsTTL: number;    // 默认 2 分钟 = 120000ms
  /** 后台静默刷新间隔 */
  backgroundRefreshInterval: number; // 默认 30 秒 = 30000ms
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  indicatorTTL: 300000,
  recentVisitorsTTL: 120000,
  backgroundRefreshInterval: 30000,
};

class DashboardCacheManager {
  private storage = wx.getStorageSync;  // 本地 Storage
  private memCache = new Map<string, CacheEntry<any>>();  // 内存缓存

  /**
   * 读取缓存：内存 > Storage > 网络
   * 分层优先级：内存(最快) → Storage(持久) → fetch(网络)
   */
  get<T>(key: string): T | null {
    // L1: 内存
    const mem = this.memCache.get(key);
    if (mem && Date.now() - mem.timestamp < mem.ttl) {
      return mem.data;
    }

    // L2: Storage
    try {
      const raw = this.storage(key);
      if (raw && Date.now() - raw.timestamp < raw.ttl) {
        this.memCache.set(key, raw); // 回填内存
        return raw.data;
      }
    } catch { /* Storage 读取失败，跳过 */ }

    return null;
  }

  set<T>(key: string, data: T, ttl: number, source: DataSource): void {
    const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl, source };
    this.memCache.set(key, entry);
    try {
      this.storage(key, entry);
    } catch { /* Storage 写入失败不阻塞 */ }
  }

  /**
   * 判断是否应触发后台静默刷新
   * 策略：内存缓存存在但已存活超过 backgroundRefreshInterval → 触发
   */
  shouldBackgroundRefresh(key: string, interval: number): boolean {
    const mem = this.memCache.get(key);
    if (!mem) return true;
    return Date.now() - mem.timestamp > interval;
  }
}

/** 缓存与实时数据优先级判定逻辑 */
const DATA_PRIORITY = {
  // 每次 onShow: 检查缓存是否过期，过期则重新获取
  // 下拉刷新: 忽略缓存，强制实时
  // 后台静默: 不阻塞渲染，在数据返回后无感更新
} as const;
```

### 2.4 数据获取流水线伪代码

```typescript
/**
 * 首页完整数据加载流水线
 * 
 * ┌─────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────┐
 * │ onShow  │───▶│ 读取 L1 缓存 │───▶│ 渲染缓存快照  │───▶│ 判定刷新  │
 * └─────────┘    └──────────────┘    └───────────────┘    └────┬─────┘
 *                       │ 缓存未命中                          │ 需刷新
 *                       ▼                                     ▼
 *              ┌────────────────┐                   ┌─────────────────┐
 *              │ 读取 L2 Storage│                   │ fetchDashboard() │
 *              └───────┬────────┘                   └────────┬────────┘
 *                      │                                     │
 *              ┌───────▼────────┐                   ┌────────▼────────┐
 *              │ 渲染降级快照   │                   │ setData 更新 UI │
 *              │ + stale 标记   │                   │ + 更新缓存      │
 *              └────────────────┘                   └─────────────────┘
 */
async function pageOnShowLoad(): Promise<void> {
  // Step 1: 尝试从缓存获取（不阻塞 UI）
  const cached = cacheManager.get<DashboardData>('dashboard:v1');
  if (cached) {
    this.setData({ dashboard: cached });  // 立即渲染
  }

  // Step 2: 判断是否需要实时刷新
  const needsRefresh = !cached
    || cacheManager.shouldBackgroundRefresh('dashboard:v1', 30000);

  if (!needsRefresh) return;  // 缓存足够新鲜

  // Step 3: 实时获取
  const query: DashboardQuery = {
    timeRange: this.data.selectedTimeRange ?? TimeRange.THIS_MONTH,
    ownerOpenId: this._myOpenId,
  };

  try {
    const result = await fetchDashboard(query);
    cacheManager.set('dashboard:v1', result, 300000, result.fetchMeta.source);
    this.setData({ dashboard: result });
  } catch (err) {
    // Step 4: 失败时如果已有缓存则继续用，否则显示错误
    if (!cached) {
      this.setData({
        'dashboard.indicators': DEFAULT_EMPTY_INDICATORS,
        'dashboard.fetchMeta.freshness': DataFreshness.FALLBACK,
      });
    }
  }
}
```

---

## 三、数据可信性评估与容错机制

### 3.1 数据完整性风险矩阵

| 风险项 | 数据源 | 出现概率 | 影响 | 检测方式 |
|--------|--------|---------|------|---------|
| visits 集合不存在 | visits | 中（首次使用） | 云函数报错 | `_loadVisitorStats` catch |
| 云函数未部署 | initVisits | 中（开发阶段） | 云函数调用失败 | catch → 降级 |
| getOpenId 返回空 | getOpenId | 低 | 无法按用户过滤 | 返回值检查 |
| 微信版本过低 | wx.cloud | 极低 | 完全不工作 | `!wx.cloud` 前置检查 |
| 网络超时 | 所有 | 低 | 数据加载失败 | 10 秒超时定时器 |
| recordVisit Bug | getOpenId | **确定** 🔴 | 访客数据无法写入 | 代码审查发现 |
| `newCards` 全量 | cards | **确定** 🔴 | 指标卡数倍偏差 | 代码审查发现 |

### 3.2 时效性延迟定义

| 数据项 | 理论延迟 | 实际延迟 | 说明 |
|--------|---------|---------|------|
| 名片数 | T+0 | ≤5 秒 | cards.count() 准实时，受缓存影响 |
| 访客数 | T+0 | ≤30 秒 | recordVisit 实时写入，首页 onShow 刷新 |
| 最近访客 | T+0 | ≤2 分钟 | 有独立较短 TTL |
| 多次来访 | T+0 | ≤30 秒 | 与访客数同步刷新 |

### 3.3 多级降级方案

```
                    ┌──────────────────────────────┐
                    │  用户打开首页                  │
                    └────────────┬─────────────────┘
                                 │
                    ┌────────────▼─────────────────┐
                    │ L1: 内存缓存 (< 30s 直接命中) │
                    │ 状态: LIVE / RECENT          │
                    │ 视觉: 正常显示，无标记        │
                    └────────────┬─────────────────┘
                           缓存未命中 / 过期
                                 │
                    ┌────────────▼─────────────────┐
                    │ L2: 云函数获取 (主路径)       │
                    │ initVisits.getMyVisitorStats  │
                    │ 状态: LIVE                   │
                    └────────────┬─────────────────┘
                           云函数失败 / 未部署
                                 │
                    ┌────────────▼─────────────────┐
                    │ L3: 直查 DB (降级 1)          │
                    │ db.collection('visits')       │
                    │ .where({ cardOwnerId }).count │
                    │ 状态: STALE (缺少去重)        │
                    │ 视觉: 灰色小字 "统计中"       │
                    └────────────┬─────────────────┘
                          直查 DB 失败
                                 │
                    ┌────────────▼─────────────────┐
                    │ L4: Storage 快照 (降级 2)     │
                    │ wx.getStorageSync('dashboard')│
                    │ 状态: FALLBACK               │
                    │ 视觉: 黄色边框 + "离线数据"   │
                    └────────────┬─────────────────┘
                          快照也不可用
                                 │
                    ┌────────────▼─────────────────┐
                    │ L5: 空状态占位 (降级 3)       │
                    │ value: "--"                  │
                    │ 视觉: 灰色占位 + 重试按钮     │
                    └──────────────────────────────┘
```

### 3.4 降级状态视觉提示设计

```typescript
/**
 * 根据数据新鲜度返回 UI 状态标记
 */
function getFreshnessIndicator(freshness: DataFreshness, source: DataSource): {
  className: string;
  badge?: string;
  borderColor?: string;
} {
  switch (freshness) {
    case DataFreshness.LIVE:
      return { className: '' };  // 正常显示，无标记
    case DataFreshness.RECENT:
      return { className: '', badge: undefined };  // 近 5 分钟，正常
    case DataFreshness.STALE:
      return {
        className: 'stat-stale',
        badge: '统计中',
        borderColor: '#e5e7eb',
      };
    case DataFreshness.FALLBACK:
      return {
        className: 'stat-fallback',
        badge: source === DataSource.LOCAL_CACHE ? '离线数据' : '数据暂不可用',
        borderColor: '#f59e0b',  // amber 黄色警示
      };
  }
}
```

#### WXML 降级状态渲染

```html
<!-- 指标卡带降级标记 -->
<view class="stat-item {{indicator.freshnessMeta.className}}">
  <view class="stat-icon">
    <view class="icon-users"></view>
  </view>
  <view class="stat-info">
    <text class="stat-value">
      {{indicator.freshness === 'fallback' ? '--' : indicator.formattedValue}}
    </text>
    <view class="stat-label-row">
      <text class="stat-label">{{indicator.label}}</text>
      <text class="stat-badge" wx:if="{{indicator.freshnessMeta.badge}}">
        {{indicator.freshnessMeta.badge}}
      </text>
    </view>
  </view>
  <!-- 趋势箭头 -->
  <view class="stat-trend" wx:if="{{indicator.trend}}">
    <text class="trend-{{indicator.trend}}">
      {{indicator.trend === 'up' ? '↑' : indicator.trend === 'down' ? '↓' : '→'}}
    </text>
  </view>
</view>
```

### 3.5 数据质量告警阈值

```typescript
interface QualityThresholds {
  /** 单次 fetch 耗时超过此值 → 触发性能警告 */
  fetchLatencyWarnMs: number;      // 默认 3000ms
  /** 连续降级次数 → 触发可用性告警 */
  consecutiveFallbackCount: number; // 默认 3
  /** 缓存过期时间过长 → 数据过期告警 */
  cacheStaleThresholdMs: number;    // 默认 600000 (10分钟)
  /** 名片数不一致容忍度（列表数 vs 指标卡数） */
  cardCountDriftTolerance: number;  // 默认 0（必须一致）
}

const QUALITY_THRESHOLDS: QualityThresholds = {
  fetchLatencyWarnMs: 3000,
  consecutiveFallbackCount: 3,
  cacheStaleThresholdMs: 600000,
  cardCountDriftTolerance: 0,
};

/** 告警日志输出（开发阶段 console，生产阶段可接入日志服务） */
function logQualityEvent(event: {
  level: 'warn' | 'error';
  metric: string;
  detail: string;
}): void {
  const prefix = `[DashboardQuality][${event.level.toUpperCase()}]`;
  console[event.level](`${prefix} ${event.metric}: ${event.detail}`);
  // 生产环境可在此接入 WeChat 实时日志 wx.getRealtimeLogManager()
}
```

### 3.6 跨系统一致性校验

```typescript
/**
 * 校验点 1：名片数 — cards 列表 vs 指标卡
 * 
 * 指标卡的 cardCount 与页面标题的 cards.length 必须来自同一查询。
 * 本架构统一使用 fetchCardCount() 返回值，消除双源不一致。
 */
function validateCardCountConsistency(listCount: number, indicatorValue: number): boolean {
  const drift = Math.abs(listCount - indicatorValue);
  const ok = drift <= QUALITY_THRESHOLDS.cardCountDriftTolerance;
  if (!ok) {
    logQualityEvent({
      level: 'warn',
      metric: 'cardCountDrift',
      detail: `listCount=${listCount}, indicator=${indicatorValue}, drift=${drift}`,
    });
  }
  return ok;
}

/**
 * 校验点 2：访客数 — 云函数结果 vs 直查 DB 结果
 * 
 * 在开发模式下，可同时请求云函数和直查 DB 的结果做对比。
 */
async function crossValidateVisitorCount(query: DashboardQuery): Promise<void> {
  try {
    const [cfResult, dbResult] = await Promise.allSettled([
      callCloudFunction('initVisits', { action: 'getMyVisitorStats', data: query }),
      directDBQuery('visits', { cardOwnerId: query.ownerOpenId }),
    ]);
    // 偏差 > 10% 时记录
  } catch { /* 校验失败不影响主流程 */ }
}
```

---

## 四、最近访客列表渲染与交互

### 4.1 列表字段设计

```typescript
interface RecentVisitorItem {
  // === 核心标识 ===
  id: string;              // 访客记录 _id，用于列表 key 和详情跳转
  visitorOpenId: string;   // 访客唯一标识

  // === 展示字段 ===
  avatarUrl: string;       // 头像（默认灰色占位图标）
  displayName: string;     // 显示名称：微信昵称 > "微信用户"
  displayPosition: string; // 职位信息
  cardName: string;        // 被访问的名片名称（关联查询）

  // === 时间与行为 ===
  lastVisitTime: number;   // Unix 毫秒时间戳
  lastVisitLabel: string;  // 格式化展示："3分钟前" / "今天 14:30" / "06-10"
  visitCount: number;      // 累计访问次数（30分钟窗口增量）
  source: VisitSource;     // 访问来源
  sourceLabel: string;     // "直接访问" / "分享进入" / "扫码进入"
  recentActions: VisitorAction[];  // 最近行为

  // === 交互状态 ===
  isKnown: boolean;        // 是否已填写姓名（true → "交换名片"；false → "请问是谁"）
  hasUnreadActions: boolean; // 是否有未读行为（用于红点提示）
}
```

### 4.2 分页 / 虚拟滚动策略

```typescript
/**
 * 分页策略
 * 
 * 首页最近访客区域：固定展示 5 条（当前行为不变）
 * 缩略列表使用 limit: 5，不需要虚拟滚动
 * 
 * 全部访客页（pages/visitors/index）：建议使用分页 + 下拉加载
 * pageSize: 20, 使用 .skip().limit() 方式
 */

interface VisitorListQuery {
  cardOwnerId: string;
  pageSize: number;        // 默认 20
  pageIndex: number;       // 从 0 开始
  sortField: 'visitTime' | 'visitCount';
  sortOrder: 'desc' | 'asc';
  filterKeyword?: string;  // 搜索关键词（匹配 visitorName）
  filterSource?: VisitSource;  // 来源筛选
  filterDateRange?: { start: number; end: number };  // 时间筛选
}

/**
 * 虚拟滚动评估
 * 
 * 对于首页"最近访客"（5 条）：不需要虚拟滚动。
 * 对于 visitors 全量页（可能 > 200 条）：
 *   - 推荐使用微信官方的 <recycle-view> 虚拟列表组件
 *   - 或使用简单分页（.skip + .limit），每次加载 20 条
 *   - 评估结论：当前阶段用分页即可，若 DAU 超过 100 且单页 > 500 条再引入 recycle-view
 */
```

### 4.3 交互功能规划

```typescript
/**
 * 首页最近访客区域交互列表
 */

// 交互 1: 点击展开详情面板
function onVisitorItemTap(item: RecentVisitorItem): void {
  // 跳转到 visitor-detail 页（需新建）
  wx.navigateTo({
    url: `/pages/visitor-detail/index?recordId=${item.id}&visitorId=${item.visitorOpenId}`,
  });
  // 详情面板内容：
  //   - 访客轨迹时间线（按时间倒序展示所有 visits 记录）
  //   - 关联名片信息
  //   - 累计访问次数趋势图
  //   - "交换名片" / "发消息" 操作按钮
}

// 交互 2: 筛选排序（在 visitors 全量页）
function applyFilter(query: VisitorListQuery): void {
  // 筛选条件：
  //   - 按时间：今日 / 本周 / 本月 / 自定义
  //   - 按来源：直接访问 / 分享进入 / 扫码进入
  //   - 按行为：已保存我的名片 / 已拨打电话 / 已发邮件
  // 排序：
  //   - 最近访问（默认）
  //   - 访问次数（降序）
}

// 交互 3: 悬停预览访客轨迹摘要
// 小程序不支持 CSS hover，改用长按 (longpress) 事件
function onVisitorItemLongPress(item: RecentVisitorItem): void {
  // 弹出轻量 ActionSheet：
  //   - 最近 3 条访问记录
  //   - "查看完整轨迹" → 跳转详情页
  //   - "交换名片" → 发起交换请求
  wx.showActionSheet({
    itemList: ['查看完整轨迹', '交换名片', '标记为已读'],
    success: (res) => {
      if (res.tapIndex === 0) onVisitorItemTap(item);
      if (res.tapIndex === 1) handleExchangeCard(item);
      if (res.tapIndex === 2) markVisitorRead(item.id);
    },
  });
}

// 交互 4: 批量操作评估
// 当前阶段不建议实现批量操作，理由：
//   1. 访客数据隐私敏感，批量操作可能引发合规问题
//   2. 小程序交互模型限制，多选 UI 设计复杂
//   3. 实际业务中批量操作访客的需求极少
// 如果未来需要，建议的操作：
//   - 批量标记已读（本地状态，不写 DB）
//   - 批量导出访客数据（需隐私授权）
```

### 4.4 最近访客数据获取

```typescript
/**
 * 首页版最近访客（5 条，轻量展示）
 */
async function fetchRecentVisitors(query: DashboardQuery): Promise<RecentVisitorItem[]> {
  // 主路径：云函数
  try {
    const res = await wx.cloud.callFunction({
      name: 'initVisits',
      data: {
        action: 'getRecentVisitors',
        data: {
          cardOwnerId: query.ownerOpenId,
          limit: 5,
          timeStart: query.timeRange !== TimeRange.CUSTOM
            ? resolveTimeRange(query.timeRange).start
            : query.customStart,
          timeEnd: query.timeRange !== TimeRange.CUSTOM
            ? resolveTimeRange(query.timeRange).end
            : query.customEnd,
        },
      },
    });

    if (res.result?.ok) {
      return mapToVisitorItems(res.result.list);
    }
  } catch { /* 降级 */ }

  // 降级：直查 DB（带 cardOwnerId 过滤）
  try {
    const db = wx.cloud.database();
    let q = db.collection('visits')
      .where({ cardOwnerId: query.ownerOpenId })
      .orderBy('visitTime', 'desc')
      .limit(5);
    const res = await q.get();
    return mapToVisitorItems(res.data);
  } catch { /* 彻底失败 */ }

  return [];
}

function mapToVisitorItems(raw: VisitorRecord[]): RecentVisitorItem[] {
  return raw.map(v => ({
    id: v.id,
    visitorOpenId: v.visitorOpenId,
    avatarUrl: '', // visits 表暂无头像字段，使用默认占位
    displayName: v.visitorName || '微信用户',
    displayPosition: v.visitorPosition || '',
    cardName: v.cardName || '',
    lastVisitTime: new Date(v.visitTime).getTime(),
    lastVisitLabel: formatRelativeTime(v.visitTime),
    visitCount: v.visitCount,
    source: v.source,
    sourceLabel: SOURCE_LABELS[v.source] || '直接访问',
    recentActions: v.actions || [],
    isKnown: !!v.visitorName,
    hasUnreadActions: false, // 暂不实现
  }));
}

/** 相对时间格式化 */
function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;

  const d = new Date(dateStr);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

const SOURCE_LABELS: Record<VisitSource, string> = {
  direct: '直接访问',
  share: '分享进入',
  qrcode: '扫码进入',
  search: '搜索进入',
};
```

---

## 五、组件结构示意

### 5.1 三层组件树

```
pages/index/index.wxml
│
├─ <view class="header">               // 页面标题栏
│   └─ <text> 我的名片 ({{indicators.cardCount.value}} 张)
│
├─ <view class="card-list">            // 名片列表（现有逻辑不变）
│   └─ <card-item> × N
│
├─ <dashboard-section>                 // ← 新增：仪表盘区域组件
│   │
│   ├─ <time-range-selector>           // 时间范围选择器
│   │   ├─ 今日 / 本周 / 本月 / 自定义
│   │   └─ 选中态：品牌蓝底色 + 白色文字
│   │
│   ├─ <stats-row>                     // 指标卡行
│   │   ├─ <stat-card
│   │   │     label="我的访客"
│   │   │     value="{{indicators.visitors.value}}"
│   │   │     trend="{{indicators.visitors.trend}}"
│   │   │     freshness="{{indicators.visitors.freshness}}"
│   │   │     onTap="goToVisitors"
│   │   │   />
│   │   ├─ <stat-card
│   │   │     label="回头访客"
│   │   │     value="{{indicators.viewed.value}}"
│   │   │     ...
│   │   │   />
│   │   └─ <stat-card
│   │   │     label="名片数"
│   │   │     value="{{indicators.cardCount.value}}"
│   │   │     onTap="goToCardList"
│   │   │   />
│   │
│   ├─ <section-header>               // 最近访客标题行
│   │   ├─ "最近访客"
│   │   └─ "查看全部 ›" → goToVisitors
│   │
│   └─ <visitor-list>                 // 最近访客 5 条
│       ├─ <visitor-item
│       │     avatar="{{item.avatarUrl}}"
│       │     name="{{item.displayName}}"
│       │     time="{{item.lastVisitLabel}}"
│       │     source="{{item.sourceLabel}}"
│       │     count="{{item.visitCount}}"
│       │     isKnown="{{item.isKnown}}"
│       │     onTap="goToVisitorDetail"
│       │     onLongPress="showVisitorActions"
│       │   /> × 5
│       └─ <view class="empty-visitors" wx:if="{{recentVisitors.length === 0}}">
│             暂无访客记录
```

### 5.2 Page data 定义（统合后）

```typescript
interface IndexPageData {
  // === 名片列表（现有） ===
  cards: Card[];
  isLoading: boolean;
  isEmpty: boolean;
  isError: boolean;
  errorMsg: string;
  hasMore: boolean;
  pageSize: number;
  currentPage: number;
  showPrivacyPopup: boolean;

  // === 仪表盘（重构后，替代 visitorStats + recentVisitors） ===
  dashboard: {
    indicators: {
      visitors: IndicatorCard;
      viewed: IndicatorCard;
      cardCount: IndicatorCard;
    };
    recentVisitors: RecentVisitorItem[];
    fetchMeta: {
      timestamp: number;
      costMs: number;
      source: DataSource;
      freshness: DataFreshness;
    };
  };

  // === 时间范围（新增） ===
  selectedTimeRange: TimeRange;  // 默认 THIS_MONTH
  customDateRange?: { start: number; end: number };

  // === 降级状态标记（新增） ===
  isFallback: boolean;
  fallbackReason: string;
}
```

### 5.3 服务模块划分

```
miniprogram/
├── app.js                          // 全局入口（不变）
├── pages/index/
│   ├── index.js                    // Page 层（重构后精简为调度逻辑）
│   ├── index.json
│   ├── index.wxml                  // 含上述组件树
│   └── index.wxss
├── services/                       // ← 新增：业务逻辑层
│   ├── dashboard.service.js        // 仪表盘数据获取 + 计算
│   ├── cache.manager.js            // 多层缓存管理
│   └── anomaly.handler.js          // 异常值处理
├── types/                          // ← 新增：JSDoc 类型定义
│   └── dashboard.types.js          // 核心接口定义（JSDoc @typedef）
└── utils/
    └── time.util.js                // 时间范围计算 + 相对时间格式化
```

### 5.4 Page 层调度代码（重构后示意）

```javascript
// pages/index/index.js — 重构后的精简版
const app = getApp();
const dashboardService = require('../../services/dashboard.service');
const cacheManager = require('../../services/cache.manager');

Page({
  data: {
    cards: [],
    isLoading: true,
    isEmpty: false,
    isError: false,
    errorMsg: '',
    hasMore: true,
    pageSize: 10,
    currentPage: 0,
    showPrivacyPopup: false,

    // 仪表盘数据（统一结构）
    dashboard: {
      indicators: {
        visitors:  { label: '我的访客', value: 0, freshness: 'fallback', source: 'empty_fallback' },
        viewed:    { label: '回头访客', value: 0, freshness: 'fallback', source: 'empty_fallback' },
        cardCount: { label: '名片数',   value: 0, freshness: 'fallback', source: 'empty_fallback' },
      },
      recentVisitors: [],
      fetchMeta: { timestamp: 0, costMs: 0, source: 'empty_fallback', freshness: 'fallback' },
    },
    selectedTimeRange: 'this_month',
    isFallback: false,
    fallbackReason: '',
  },

  onLoad() { this.checkPrivacySetting(); },

  onShow() {
    // 名片列表：按需刷
    const lastUpdate = app.getCache('lastCardUpdate');
    if (!lastUpdate || Date.now() - lastUpdate > 300000) {
      this.loadCards(true);
    }

    // 仪表盘：缓存优先 + 后台刷新
    this.loadDashboard();
  },

  async loadDashboard() {
    // 1. 缓存命中 → 即时渲染
    const cached = cacheManager.get('dashboard:v1');
    if (cached) {
      this.setData({ dashboard: cached, isFallback: false });
    }

    // 2. 不需要刷新 → 返回
    if (cached && !cacheManager.shouldBackgroundRefresh('dashboard:v1', 30000)) return;

    // 3. 实时获取（不阻塞 UI）
    try {
      const result = await dashboardService.fetchDashboard({
        timeRange: this.data.selectedTimeRange,
        ownerOpenId: this._myOpenId,
      });
      cacheManager.set('dashboard:v1', result, 300000, result.fetchMeta.source);
      this.setData({ dashboard: result, isFallback: false });

      // 4. 一致性校验：名片数
      dashboardService.validateCardCountConsistency(
        this.data.cards.length,
        result.indicators.cardCount.value
      );
    } catch {
      // 5. 降级：已有缓存则继续用
      if (!cached) {
        this.setData({ isFallback: true, fallbackReason: '数据加载失败' });
      }
    }
  },

  onTimeRangeChange(e) {
    const range = e.currentTarget.dataset.range;
    this.setData({ selectedTimeRange: range });
    this.loadDashboard();  // 立即按新范围刷新
  },
});
```

---

## 附：BUG 清单 & 改进对比

### A.1 P0 Bug：recordVisit 访客记录完全无法写入

**位置**：`preview/index.js:37`

```diff
- const visitorOpenId = res.result?.openid || ''
+ // 方案 A：复用 app.getOpenId() — 一条链路，不易出错
+ recordVisit(cardId, options) {
+   app.getOpenId().then((visitorOpenId) => {
+     if (!visitorOpenId) return;
+     wx.cloud.callFunction({
+       name: 'initVisits',
+       data: {
+         action: 'recordVisit',
+         data: { cardId, visitorOpenId, cardOwnerId: this.data.card._openid || '', source: options?.source || 'direct' }
+       }
+     })
+   })
+ }
```

### A.2 P0 Bug：名片数全量统计

**位置**：`index.js:92`

```diff
- wx.cloud.database().collection('cards').count()
+ // 改为在 loadDashboard 统一流程中处理
+ // 修复方案参见 §1.5 的 fetchCardCount()
```

### A.3 P1 Bug：降级路径

**位置**：`index.js:134-157`

```diff
- _loadVisitorStatsDirect() {
-   db.collection('visits').count()
-     .then(res => { this.setData({ 'visitorStats.visitors': res.total || 0 }) })
-     ...
- }
+ // 修复：降级也必须按 cardOwnerId 过滤
+ _loadVisitorStatsDirect(myOpenId) {
+   const db = wx.cloud.database();
+   let query = db.collection('visits');
+   if (myOpenId) query = query.where({ cardOwnerId: myOpenId });
+   query.count().then(...)
+ }
```

### A.4 改进前后对比

| 维度 | 改进前 | 改进后 |
|------|--------|--------|
| 数据一致性 | 名片数双源矛盾 | 统一 fetchCardCount 输出 |
| 错误路径 | recordVisit 100% 失败 | 复用 app.getOpenId 修复 |
| 降级完整性 | 降级路径缺 cardOwnerId 过滤 | 三条路径统一 where 条件 |
| 缓存策略 | 简单 5 分钟 Storage | 内存 L1 + Storage L2 + 后台刷新 |
| 视觉反馈 | 无降级状态提示 | 三级下降：正常 → stale 灰色 → fallback 黄色 |
| 时间范围 | 不支持 | 今日/本周/本月/自定义 |
| 代码组织 | Page 层直接操作 DB | Service 层抽象 + CacheManager |
| 类型安全 | 无类型 | JSDoc @typedef 接口约束 |
