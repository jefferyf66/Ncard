# users 集合字段设计文档

- **集合名（Collection）**：`users`
- **用途**：存储每个微信用户的账号主记录，作为「快速登录 MVP」的账号中心。
- **写入方**：仅由云函数 `getOpenId`（admin SDK 上下文）通过 `ensureUser` action 写入；
  **客户端小程序不直接访问**本集合。

## 字段表

| 字段名        | 类型   | 必填 | 说明                                                                          |
| ------------- | ------ | ---- | ----------------------------------------------------------------------------- |
| `_openid`     | string | 是   | 微信用户唯一标识（主键）。admin 上下文 `add()` 不会自动注入，须显式写入。      |
| `unionid`     | string | 否   | 微信开放平台 UnionID；未绑定开放平台时为空字符串 `''`。                        |
| `nickname`    | string | 否   | 昵称；用户主动完善资料时写入，初始为空字符串。                                |
| `avatarUrl`   | string | 否   | 头像地址；用户主动完善资料时写入，初始为空字符串。                            |
| `themeColor`  | string | 否   | 主题色偏好；初始为空字符串。                                                  |
| `defaultCardId` | string | 否 | 默认名片 ID；初始为空字符串。                                               |
| `registeredAt`| number | 是   | 注册时间戳（`Date.now()`）。                                                  |
| `lastLoginAt` | number | 是   | 最近登录时间戳（`Date.now()`）；每次 `ensureUser` 调用都会更新。              |

## 索引

- `_openid`：唯一索引（**云开发仅默认对 `_id` 建索引，`_openid` 需手动创建唯一索引**，作为 `ensureUser` 先查后写在极端并发下的兜底）。

## 权限

- 集合权限设置为「**仅创建者可读写**」（客户端不可读写他人记录，亦不直接读写本集合）。

## 重要注意事项（D2 坑）

> 云函数使用 admin SDK 上下文调用 `db.collection('users').add({ data: {...} })` 时，
> **不会自动注入 `_openid` 字段**，必须在 `data` 中显式写入 `_openid: OPENID`，
> 否则文档将缺失主键，导致后续 `where({ _openid })` 查询无法命中。

## 客户端访问约定

- 客户端**禁止**直接 `wx.cloud.database().collection('users').add/get/update`，
  所有读写均经由云函数 `getOpenId` 的 `ensureUser` action 完成。
- 客户端通过 `app.globalData.user` 与本地缓存 `wx.getStorageSync('user')` 读取当前用户记录
  （见 `miniprogram/app.js` 的 `ensureUser()` / `getUser()`）。
