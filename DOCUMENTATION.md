# 科博名片小程序 - 详细设计文档

---

## 1. 项目概述

**项目名称**：科博名片（Kebo Business Card）

**项目简介**：一款专业的电子名片管理微信小程序，支持名片创建、编辑、分享、访客追踪等功能，采用微信云开发技术栈实现。

**技术栈**：
| 分类 | 技术 | 版本 |
|------|------|------|
| 框架 | 微信小程序 | 原生 |
| 后端 | 微信云开发 | 2.0+ |
| 数据库 | Cloud Firestore | NoSQL |
| 云函数 | Node.js | 16.x |

**设计风格**：素雅简洁、扁平化设计、单色线条图标

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    微信小程序客户端                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │   页面层     │ │   组件层     │ │   工具层     │          │
│  │ (Pages)     │ │ (Components)│ │ (Utils)     │          │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘          │
└─────────│────────────────│────────────────│─────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                    微信云开发平台                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │  云数据库    │ │  云函数      │ │  云存储      │          │
│  │ (Database)  │ │ (Functions) │ │ (Storage)   │          │
│  └─────────────┘ └─────────────┘ └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 页面结构

| 页面路径 | 页面名称 | 功能描述 |
|---------|---------|---------|
| `/pages/index/index` | 首页 | 名片列表、访客统计、快速入口 |
| `/pages/edit/index` | 编辑页 | 创建/编辑名片信息 |
| `/pages/preview/index` | 预览页 | 名片详情展示、分享、操作 |
| `/pages/profile/index` | 个人中心 | 用户信息、设置、主题选择 |
| `/pages/scan/index` | 扫码页 | OCR名片识别 |
| `/pages/visitors/index` | 访客页 | 访客记录管理 |
| `/pages/agreement/index` | 协议页 | 隐私政策、服务条款 |

### 2.3 目录结构

```
Ncard/
├── cloudfunctions/           # 云函数目录
│   ├── getOpenId/            # 获取OpenID
│   ├── getQrCode/            # 生成二维码
│   └── parseCard/            # 名片识别(OCR)
├── miniprogram/              # 小程序源码
│   ├── components/           # 公共组件
│   │   └── cloudTipModal/    # 云开发提示弹窗
│   ├── images/               # 静态资源
│   │   ├── icons/            # 图标资源
│   │   └── tab/              # TabBar图标
│   ├── pages/                # 页面目录
│   │   ├── index/            # 首页
│   │   ├── edit/             # 编辑页
│   │   ├── preview/          # 预览页
│   │   ├── profile/          # 个人中心
│   │   ├── scan/             # 扫码页
│   │   ├── visitors/         # 访客页
│   │   └── agreement/        # 协议页
│   ├── app.js                # 应用入口
│   ├── app.json              # 全局配置
│   └── app.wxss              # 全局样式
├── .gitignore                # Git忽略配置
├── project.config.json       # 项目配置
└── README.md                 # 项目说明
```

---

## 3. 数据模型设计

### 3.1 名片数据结构（cards 集合）

| 字段名 | 类型 | 含义 | 必填 | 默认值 |
|--------|------|------|------|--------|
| _id | string | 文档ID | 自动 | - |
| name | string | 姓名 | 是 | - |
| position | string | 职位 | 否 | '' |
| company | string | 公司名称 | 是 | - |
| phone | string | 手机号码 | 否 | '' |
| email | string | 邮箱地址 | 否 | '' |
| address | string | 地址 | 否 | '' |
| avatar | string | 头像URL | 否 | '' |
| personalIntro | string | 个人介绍 | 否 | '' |
| businessIntro | string | 业务介绍 | 否 | '' |
| experiences | array | 过往经历 | 否 | [] |
| attachments | array | 名片附件 | 否 | [] |
| wechatOfficial | object | 公众号信息 | 否 | {} |
| companyWebsite | object | 公司主页 | 否 | {} |
| createTime | Date | 创建时间 | 是 | 自动 |
| updateTime | Date | 更新时间 | 是 | 自动 |

**experiences 数组元素结构**：
| 字段 | 类型 | 含义 |
|------|------|------|
| company | string | 公司名称 |
| position | string | 职位 |
| period | string | 工作时间 |
| desc | string | 工作描述 |

**wechatOfficial 对象结构**：
| 字段 | 类型 | 含义 |
|------|------|------|
| name | string | 公众号名称 |
| desc | string | 简介 |
| url | string | 公众号链接 |

**companyWebsite 对象结构**：
| 字段 | 类型 | 含义 |
|------|------|------|
| name | string | 网站名称 |
| url | string | 网站地址 |
| desc | string | 网站描述 |

### 3.2 访客数据结构（visits 集合）

| 字段名 | 类型 | 含义 |
|--------|------|------|
| _id | string | 文档ID |
| visitorName | string | 访客姓名 |
| visitorPosition | string | 访客职位 |
| visitorCardId | string | 访客名片ID |
| visitedCardId | string | 被访问名片ID |
| visitTime | Date | 访问时间 |
| actions | array | 访问行为 |

---

## 4. 页面详细设计

### 4.1 首页（pages/index/index）

**功能模块**：
1. **隐私授权弹窗** - 首次进入时展示
2. **名片列表** - 展示用户创建的所有名片
3. **访客统计** - 显示访客数量、查看次数
4. **最近访客** - 展示最近访问的用户
5. **快捷入口** - 创建名片、查看访客

**数据加载流程**：
```
onLoad → checkPrivacySetting → loadCards / loadVisitorData
    ↓
onShow → loadVisitorData (定时刷新)
    ↓
onPullDownRefresh → loadCards(true)
    ↓
onReachBottom → loadCards(false) (分页加载)
```

**关键方法**：

| 方法名 | 功能 | 参数 | 返回值 |
|--------|------|------|--------|
| loadCards | 加载名片列表 | isRefresh: boolean | void |
| loadVisitorData | 加载访客数据 | 无 | void |
| goToEdit | 跳转到编辑页 | 无 | void |
| goToPreview | 跳转到预览页 | id: string | void |

---

### 4.2 编辑页（pages/edit/index）

**功能模块**：
1. **头像上传** - 支持拍照/相册选择
2. **基本信息** - 姓名、职位、公司、电话、邮箱、地址
3. **个人介绍** - 多行文本输入
4. **业务介绍** - 多行文本输入
5. **过往经历** - 可添加多条工作经历
6. **公众号信息** - 名称、简介、链接
7. **公司主页** - 名称、地址、描述
8. **名片附件** - 图片附件上传

**表单验证规则**：
| 字段 | 验证规则 | 错误提示 |
|------|---------|---------|
| name | 非空 | 请输入姓名 |
| company | 非空 | 请输入公司名称 |
| phone | 11位手机号格式 | 请输入正确的手机号 |
| email | 邮箱格式 | 请输入正确的邮箱地址 |

**图片压缩策略**：
| 文件大小 | 压缩质量 |
|----------|---------|
| < 1MB | 80% |
| 1MB - 2MB | 70% |
| 2MB - 5MB | 60% |
| > 5MB | 拒绝上传 |

---

### 4.3 预览页（pages/preview/index）

**功能模块**：
1. **名片卡片展示** - 头像、姓名、职位、公司、联系方式
2. **过往经历列表** - 工作经历展示
3. **个人介绍** - 个人描述
4. **业务介绍** - 业务描述
5. **名片附件** - 附件列表及下载
6. **公众号链接** - 点击复制链接
7. **公司主页** - 点击复制链接
8. **操作按钮** - 编辑、保存通讯录、删除、分享

**分享功能**：
- 支持分享给朋友（onShareAppMessage）
- 支持分享到朋友圈（onShareTimeline）

**交互功能**：
| 操作 | 功能说明 |
|------|---------|
| 点击电话 | 弹出菜单：拨打电话/复制号码 |
| 点击邮箱 | 复制邮箱地址 |
| 点击地址 | 复制地址 |
| 点击公众号 | 复制公众号链接 |
| 点击公司主页 | 复制网站链接 |
| 点击附件 | 下载并预览文件 |

---

### 4.4 个人中心（pages/profile/index）

**功能模块**：
1. **用户信息** - 头像、昵称、OpenID
2. **统计数据** - 名片数量、扫码次数、访客数量
3. **设置项** - 清空缓存、关于我们、主题选择
4. **快捷导航** - 名片列表、扫码历史

**主题配色方案**：
| 主题名称 | 颜色值 |
|---------|--------|
| 品牌蓝 | #3B82F6 |
| 活力橙 | #FF6A00 |
| 清新绿 | #00B42A |
| 玫瑰红 | #F53F3F |
| 香槟金 | #D9A94C |
| 神秘紫 | #722ED1 |

---

### 4.5 扫码页（pages/scan/index）

**功能模块**：
1. **扫码区域** - 摄像头预览、扫描线动画
2. **图片选择** - 从相册选择图片
3. **OCR识别结果** - 识别出的名片信息
4. **识别历史** - 历史识别记录

**识别流程**：
```
选择图片 → 上传到云存储 → 调用云函数parseCard → 返回识别结果 → 展示并编辑
```

---

## 5. 云函数设计

### 5.1 getOpenId

**功能**：获取用户OpenID

**入口参数**：无

**返回值**：
```javascript
{
  openid: string,
  unionid?: string
}
```

### 5.2 getQrCode

**功能**：生成名片分享二维码

**入口参数**：
| 参数 | 类型 | 含义 |
|------|------|------|
| cardId | string | 名片ID |

**返回值**：
```javascript
{
  qrUrl: string // 二维码图片URL
}
```

### 5.3 parseCard

**功能**：OCR名片识别

**入口参数**：
| 参数 | 类型 | 含义 |
|------|------|------|
| fileID | string | 图片文件ID |

**返回值**：
```javascript
{
  name: string,
  position: string,
  company: string,
  phone: string,
  email: string,
  address: string
}
```

---

## 6. 全局工具函数（app.js）

### 6.1 工具方法

| 方法名 | 功能 | 参数 | 返回值 |
|--------|------|------|--------|
| showLoading | 显示加载提示 | title: string | void |
| hideLoading | 隐藏加载提示 | 无 | void |
| showError | 显示错误提示 | title: string, duration: number | void |
| showSuccess | 显示成功提示 | title: string, duration: number | void |
| showConfirm | 显示确认弹窗 | title: string, content: string | Promise |
| getCache | 获取缓存 | key: string | any |
| setCache | 设置缓存 | key: string, value: any, expire: number | void |
| isCacheValid | 检查缓存是否有效 | key: string | boolean |
| isValidPhone | 验证手机号 | phone: string | boolean |
| isValidEmail | 验证邮箱 | email: string | boolean |
| formatTime | 格式化时间 | date: Date | string |
| debounce | 防抖函数 | fn: function, delay: number | function |

---

## 7. UI设计规范

### 7.1 设计原则

1. **素雅简洁**：采用中性灰色系配色，降低视觉复杂度
2. **扁平化设计**：无渐变填充，仅保留线条和基础形状
3. **线条图标**：统一使用CSS绘制的单色线条图标
4. **间距规范**：基础间距24rpx，卡片圆角20rpx
5. **响应式布局**：使用rpx单位确保跨设备兼容

### 7.2 颜色规范

| 颜色用途 | 颜色值 |
|---------|--------|
| 主文字 | #1F2937 |
| 次要文字 | #4B5563 |
| 辅助文字 | #6B7280 |
| 提示文字 | #9CA3AF |
| 背景色 | #F9FAFB |
| 卡片背景 | #FFFFFF |
| 分隔线 | #F3F4F6 |
| 边框 | #E5E7EB |
| 按钮主色 | #6B7280 → #4B5563 |

### 7.3 字体规范

| 字体用途 | 字号(rpx) | 字重 |
|---------|----------|------|
| 标题 | 44 | 700 |
| 副标题 | 32 | 600 |
| 正文 | 30 | 500 |
| 辅助文字 | 28 | 400 |
| 提示文字 | 24 | 400 |

---

## 8. 安全与隐私

### 8.1 隐私授权

- **相册权限**：用于选择图片上传
- **相机权限**：用于拍照上传和扫码
- **通讯录权限**：用于保存名片到通讯录

### 8.2 数据安全

1. **数据加密**：敏感数据传输使用HTTPS
2. **访问控制**：数据库规则限制仅用户本人可读写自己的名片
3. **隐私政策**：首次使用时展示隐私政策并获取同意

---

## 9. 部署与发布

### 9.1 云开发环境配置

1. 在微信开发者工具中开通云开发
2. 创建云函数并部署
3. 配置数据库规则
4. 配置云存储权限

### 9.2 发布流程

1. 代码审核
2. 上传代码到微信公众平台
3. 提交审核
4. 发布上线

---

## 10. 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|---------|
| v1.0.0 | 2024-06 | 初始版本，基础名片功能 |
| v1.1.0 | 2024-06 | 添加过往经历、附件、个人介绍、业务介绍模块 |
| v1.1.1 | 2024-06 | 添加公众号链接、公司主页模块 |

---

**文档版本**: v1.0  
**创建日期**: 2024年6月  
**作者**: Kebo Team

---