// 字段级可见性共享常量（云函数侧）
// 与前端 miniprogram/config/cardVisibility.js 保持完全一致
// D4 决策：敏感字段（phone/email/address）默认 authorized，其余默认 public（向后兼容存量）

const DEFAULT_FIELD_VISIBILITY = {
  name: 'public',
  position: 'public',
  company: 'public',
  phone: 'authorized',
  email: 'authorized',
  address: 'authorized',
  wechatOfficial: 'public',
  companyWebsite: 'public',
  personalIntro: 'public',
  businessIntro: 'public',
  experiences: 'public',
  attachments: 'public'
}

const FIELD_LABELS = {
  name: '姓名',
  position: '职位',
  company: '公司',
  phone: '电话',
  email: '邮箱',
  address: '地址',
  wechatOfficial: '公众号',
  companyWebsite: '公司主页',
  personalIntro: '个人介绍',
  businessIntro: '业务介绍',
  experiences: '经历',
  attachments: '附件'
}

module.exports = {
  DEFAULT_FIELD_VISIBILITY,
  FIELD_LABELS
}
