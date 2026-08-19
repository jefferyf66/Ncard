# 团队公开目录 · 公众号菜单挂载对接文档

> 适用：将某个团队的「公开成员目录」挂到微信公众号自定义菜单，访客点菜单即进入该团队只读名片列表。
> 前置条件见 §1；路径格式见 §2；操作步骤见 §3。

---

## 1. 前置条件（缺一不可）

1. **小程序与公众号同一主体**：两者均已完成微信认证，且主体一致。
2. **公众号已关联小程序**：公众号后台「小程序管理 → 关联小程序」中绑定 Ncard 小程序（需小程序 AppID）。
3. **小程序已发布上线**：自定义菜单跳转小程序仅对**已发布**版本生效；开发版/体验版无效。
4. **目标团队已开启「公开目录」**：团队 owner 在 `team/detail` 设置里切换「允许公开目录」（`allowDirectoryShare=true`）。未开启时链接返回 `TEAM_NOT_PUBLIC`，访客看不到成员。
5. **获取目标团队 shortId**：在 `team/detail` 团队头可见「团队ID：XXXXXX」，即 shortId（非内部 `_id`）。

---

## 2. 路径格式（必须严格遵守）

```
pages/team/detail?id=<SHORT_ID>&public=1
```

- `id` 用 **shortId**（非 `_id`）：可读、可记忆、与分享链接一致。
- `public=1`：保证非成员/访客打开即进入只读目录网格，不触发成员态探测失败。
- 示例：`pages/team/detail?id=K8F2M7&public=1`

---

## 3. 公众号后台配置步骤

1. 登录 **微信公众平台** → 左侧「内容与互动」→ **自定义菜单**。
2. 新增/编辑一个菜单项：
   - **菜单名称**：如「团队名片」「成员名录」。
   - **菜单内容**：选「跳转小程序」。
   - **小程序 AppID**：填 Ncard 小程序 AppID。
   - **备用网页**（必填占位）：填同主体落地页，如 `https://your-domain.com/ncard`（微信要求填，但走小程序时不使用）。
   - **小程序页面路径**：填 §2 的路径 `pages/team/detail?id=<SHORT_ID>&public=1`。
3. 点「保存并发布」。菜单生效通常有几分钟延迟。

---

## 4. 访客打开后的体验

- 进入 `team/detail` 的 **public 视图**：团队头（名称/描述/logo/人数）+ 成员目录网格（每张只读卡片显示 `name / position / company / department`，头像仅成员本人/owner 开启 `avatarPublic` 后显示）。
- **无任何管理/移除按钮**；owner 在自己端可见「分享团队目录」按钮用于复制/转发。
- 团队成员 `avatarPublic` 默认 `false`；如需展示头像，owner 在成员管理里为成员开启（或成员自行在编辑入口开启）。

---

## 5. 安全边界（与实现一致，见设计稿 §6）

- 公开接口 `getTeamPublicDirectory` 仅返回白名单字段，**绝不返回** `_openid / memberOpenId / cardId / 私人手机 / 微信 / 邮箱 / 地址`。
- `allowDirectoryShare` 默认 `false`，owner 主动开启才生成公开目录。
- shortId 高熵随机（既有 `genShortId()`），被猜测也无法枚举未公开团队（返回 `TEAM_NOT_PUBLIC`）。

---

## 6. 后续可扩展（本期未做）

- 公开页加「申请加入」入口（需审核加入流，归 Phase 2）。
- `companyWebsite` 等组织官网字段按需加入 `PUBLIC_MANAGED` 白名单。
- owner 预览管理态：加 `&preview=1` 仅 owner 生效（待定）。
