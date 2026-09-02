# Ncard 代码库系统性审计 · 交付报告

- **基线版本**：v1.5.5（2026-09-01）
- **执行**：software-ncard-audit 团队（齐活林主理 / 高见远架构师 / 寇豆码工程师 / 严过关 QA）
- **流程**：架构师八维审计（11min）→ 用户拍板修全部 22 项 → 工程师实施（21min）→ QA 回归（18min，20 PASS/1 FAIL）→ 工程师返修 → QA 第 2 轮定点复验（5/5 PASS，路由 NoOne）
- **结论**：0 P0；5 P1 + 17 P2 全部修复闭环，15 个 JS 文件语法校验全绿，纯逻辑脚本 13/13 PASS

---

## 一、修复清单（全部完成）

### P1（5 项）
| ID | 位置 | 问题 | 修复 |
|---|---|---|---|
| F01 | accountManager/index.js:92-96 | exportMyData 泄露 visits.visitorPhone（访客私人手机号，SEC-03 旁路） | 返回前逐条 delete |
| F02 | edit/index.js:114-118,210-222,425-440 | 公众号二维码先删后存竞态（访客端裂图） | 照头像 A3 模式：基线 + saveCard 成功后清理 |
| F03 | edit/index.js:119-120,223-242,258-274 | 附件删除同款竞态（下载 404） | deleteAttachment 纯 UI 移除，差集延迟清理；弹窗文案同步 |
| F04 | list/index.js:44-68 | 名片夹 user_save_cards 无 limit，>20 张静默截断 | limit(20)+skip 分页拉全量 |
| F05 | app.js:98-124 + index/index.js | getCache/setCache 包装不一致：首页恒强制重载 + 团队计数缓存永不命中 | getCache 内部解包（返回 .value+过期判断），tryLoadCache 适配 |

### P2（17 项）
| ID | 位置 | 修复 |
|---|---|---|
| F06 | teamManager | fetchAllPages(:396) + fetchByInIds(:422) 分批聚合；listMembers/getTeamPublicDirectory/getMyTeams/getCardTeams/getCardsTeams/searchTeam 六处全覆盖（返修补齐 getCardTeams/getCardsTeams/searchTeam 三处 _.in 漏分批） |
| F07 | adminManager/config.json（新建） | {"timeout":60,"memorySize":256} 固化超时配置 |
| F08 | teamManager:294-326 | 邀请码限额改条件更新（_.lt(maxUses)），updated===0 回滚三件事 |
| F09 | teamManager:86-91 | createTeam 配额 add 前复查 |
| F10 | initVisits:223-244 | recordVisit 30min 窗口内命中合并更新（字段名 visits.visitTime 读码确认） |
| F11 | preview:369-399 | saveCard add 后复查去重 |
| F12 | deleteCard:43 | 所有权严格校验 `card._openid !== openid`（写入链路查证：唯一 add 点自动注入 _openid） |
| F13 | teamManager:527+937-944 | getTeam 非成员分支 stripSchemaDefaults 剔除 defaultValue |
| F14 | initVisits:458-459 | authorizeVisit nickname trim+slice(30)、avatar slice(500) |
| F15 | visitors/index.js + index.wxml:42-49 | 删假降级直读兜底，云函数失败展示错误态（WXML 补 isError 分支+点击重试）；删 phone 死字段/死绑定 |
| F16 | shareCard.js:43,477-483 | _imageCache 加 MAX=10 LRU |
| F17 | adminManager:180-189 | disbandTeam 改内联 removeAll 分页删除 |
| F18 | storage.js | 硬编码 envId 仅注记（单一真源已确认） |
| F19 | index:204-211 | 降级实施：翻页只追加不重排，仅刷新全量排序（统一排序键需迁移 order 存量数据，风险过高） |
| F20 | edit/index + index 页 | 双入口 last-write-wins 注记（已接受行为） |
| F21 | team/list.js:20-24 | _shownOnce 首载去重 |
| F22 | utils/visitors.js（新建） | ① _mergeVisitorsByOpenId 收敛引用；③ 4 处死参数删除；②④（removeAll 跨函数重复/魔法字符串）接受现状 |

## 二、须重部署云函数（5 个，本地 commit 不等于上线）
1. **accountManager**（F01）
2. **teamManager**（F06/F08/F09/F13）
3. **initVisits**（F10/F14）
4. **deleteCard**（F12）
5. **adminManager**（F07/F17）——⚠️ 部署时必勾「云端安装依赖」；config.json 的 60s 超时部署后到控制台确认生效

前端改动（9 文件）开发者工具编译即生效。

## 三、审计覆盖与未发现问题项
- 深读：6 个云函数全部 action（teamManager 902 行逐 action）+ 小程序全部页面 JS + utils/config
- 无注入（两处正则已转义）、无越权（全部走服务端 OPENID）、公开目录三链路白名单守得住、singleUse 条件更新未复发
- 已核实未复发：list 页直读他人卡（现走 getCardsBatch 服务端过滤）

## 四、Known Issues（已注释声明，不修）
1. F11 客户端去重为尽力而为（并发双击理论可能互删）
2. saveCard 放弃/失败的孤儿上传文件由 storageAudit/storagePurge 对账收口
3. F10 visitTime=now 续期为 30min 合并设计既有语义
4. teamManager getMyTeams:474 孤儿成员记录 TypeError（旧代码同款，低概率）

## 五、产品层建议（不属代码修复）
- defaultCardSchema 中 phone 默认 visible:true（teamManager:848）——团队名片视图会向可访问者展示托管电话，属设计预期，建议 owner 配置弹层加提示

## 六、状态
- 全部改动在工作区，**未 commit、未部署**（待用户指令）
- 建议：部署 5 个云函数后跑一轮 storageAudit 确认无新增孤儿；提交打标时同步 CHANGELOG.md + README 版本历史
