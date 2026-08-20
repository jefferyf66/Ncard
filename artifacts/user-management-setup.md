# 用户管理模块 · 部署与控制台配置手册

> 本文件记录「用户管理模块」上线前**必须在微信云开发控制台手动完成**的步骤。代码侧已全部就绪，但以下项无法由代码自动完成，需人工在控制台操作。

## 一、云函数部署（必做）

在微信开发者工具中，分别对以下云函数「上传并部署（云端安装依赖）」：

1. `getOpenId` —— 含 P1 修复 + users 字段扩展 + root 种子晋升，必须重新部署才生效。
2. `accountManager` —— 新增，用户自助（L1）。
3. `adminManager` —— 新增，运营后台（L2）。

> 注意：`getOpenId` 若不重新部署，P1 修复（重复用户/失败重试）不会生效。

## 二、数据库集合配置（必做）

### 1. `users._openid` 建唯一索引（防重复用户的最强保证）
- 云开发控制台 → 数据库 → `users` 集合 → 索引管理 → 新建索引
- 字段：`_openid`，顺序/唯一：勾选「唯一」，索引名如 `openid_unique`
- 原因：服务端 `where→add` 已做幂等回查，但唯一索引才能从数据库层杜绝并发首登重复建号。

### 2. `config` 集合写入种子 root（建议）
- 新建集合 `config`，添加文档：
  ```
  _id: "root"
  rootOpenids: ["替换为你的微信 OPENID"]
  ```
- 获取自己的 OPENID：临时调用 `getOpenId` 默认 action（不传 action）返回 `data.openid`。
- 作用：`getOpenId.ensureUser` 命中即把你的 `users.role` 晋升为 `root`；换设备/交接时改这个数组即可，**不写死代码**。

### 3. 集合权限（确认）
- `users` / `teams` / `team_members` / `team_invites` / `user_save_cards` / `visits` / `visitor_profiles`：建议设为「**仅创建者可读写**」。
- 所有后台/跨用户读写均由 `getOpenId`/`teamManager`/`accountManager`/`adminManager` 在**服务端 admin 上下文**完成（绕过集合权限规则，但严格按调用方 OPENID 限定自身/目标），客户端零直访。

### 4. `admin_audit_log` 集合
- 无需预建，首次写审计时自动创建。可选建 `createdAt` 普通索引便于排查。

## 三、功能验证清单（部署后）

- [ ] 首次启动：自动建 `users` 记录，`role` 应为 `root`（若你的 OPENID 在 config.rootOpenids）。
- [ ] 「账号设置」页：选择微信头像(chooseAvatar) + 填昵称/真名 → 保存 → 重新进入数据仍在。
- [ ] 「账号设置」页：导出我的数据 → 弹窗显示名片/收藏/访客统计。
- [ ] 「账号设置」页：若未建团队，点注销 → 二次确认 → 账号置 `status=deleted`，本地登录态清空。
- [ ] 「管理后台」页（root/admin 可见）：统计卡有数；用户列表/团队列表加载；root 可见「转让 root」入口。
- [ ] root 转让：输入目标 OPENID → 两步确认 → 原 root 降级为 admin，目标变 root；`admin_audit_log` 有记录。
- [ ] admin 尝试 `setUserRole` / `transferRoot`：应被拒绝（权限不足）。

## 四、已知约束（V1）
- 注销为**软删除**：保留 `cards` 内容，清除 `user_save_cards`，`status=deleted`。`app.getUser()` 已过滤，客户端视为未登录；`ensureUser` 不会重新激活已注销账号。
- `username` handle：V1 不做（字段预留空），V2 按需。
- UNIONID 已随 `ensureUser` 落库（现有用户需下次登录才补齐）。
