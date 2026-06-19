# Ncard 项目规范

## 版本发布流程

每次打 tag 前必须完成以下步骤：

1. **更新 CHANGELOG.md** — 按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式，使用 `Added`/`Changed`/`Fixed`/`Removed` 分类
2. **更新 README.md 版本历史** — 一句话总结，指向 CHANGELOG 链接
3. **更新 `.workbuddy/memory/MEMORY.md`** — 记录新发现的关键配置或约定
4. **git tag** — 使用 SemVer 格式 `vMAJOR.MINOR.PATCH`

## Commit 格式

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <描述>

类型: feat / fix / docs / chore / refactor / test
```

## 版本号

[SemVer](https://semver.org/lang/zh-CN/)：
- MAJOR: 不兼容的 API 变更
- MINOR: 向后兼容的新功能  
- PATCH: 向后兼容的 Bug 修复

## 关键文件

| 文件 | 用途 |
|------|------|
| `CHANGELOG.md` | 版本变更的唯一事实来源 |
| `README.md` | 项目门面（简介+快速开始+技术栈+版本历史） |
| `DEPLOYMENT-GUIDE.md` | 部署步骤 |
| `DOCUMENTATION.md` | 架构和模块说明 |
| `.workbuddy/memory/MEMORY.md` | 项目长期记忆（配置、约定、教训） |

## 微信小程序特殊约定

- `app.json` 不注册测试页面
- `app.json` 不声明未使用的 permission
- 云存储权限：所有用户可读，仅创建者可读写
- MP后台「分享安全校验」开关关闭时正常分享；开启需实现签名代码
