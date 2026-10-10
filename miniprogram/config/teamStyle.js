/**
 * teamStyle.js — 团队分享卡统一样式配置（单一数据源）
 * ============================================
 * 为 team/detail 的三种分享（目录 / 邀请成员 / 填写名片）提供统一品牌蓝视觉令牌。
 * 设计稿基准 750rpx，绘制画布固定 600x480（5:4，恰为微信气泡上限，无需再缩放）。
 */

// 微信气泡卡片尺寸上限（分享图在聊天气泡中显示，超出等比缩放）
var BUBBLE_MAX = Object.freeze({ width: 600, height: 480 })

// 团队分享卡样式令牌（统一品牌蓝 #3B82F6 / #2563EB，锐角风格与 App 一致）
var TEAM_CARD = Object.freeze({

  // 画布（逻辑像素，5:4）
  canvasWidth: 600,
  canvasHeight: 480,

  // 颜色
  bg: '#FFFFFF',
  brandBlue: '#3B82F6',
  brandBlueDeep: '#2563EB',
  ink: '#1E293B',
  muted: '#64748B',
  line: '#E2E8F0',
  chipBg: '#E6F1FB',
  chipText: '#2563EB',

  // 左侧装饰条（目录/填写卡用）
  barWidth: 8,

  // 顶部蓝横幅（仅邀请成员卡用）
  bandHeight: 96,
  bandTextSize: 30,

  // logo 首字块
  logoSize: 96,
  logoRadius: 8,
  logoTextSize: 52,

  // 团队名（Georgia 衬线）
  nameFontSize: 40,
  nameFont: "Georgia, 'Times New Roman', serif",
  nameColor: '#1E293B',

  // 元信息
  metaFontSize: 26,
  metaColor: '#64748B',

  // 底栏 CTA
  ctaHeight: 64,
  ctaTextSize: 28
})

// 样式版本：外观变更抬版本 → 触发缓存击穿重绘（与 SHARE_IMAGE_STYLE 同机制）
var TEAM_SHARE_STYLE = 'v1'

// 以 750rpx 设计稿为基准的 rpx→canvas 像素换算（预留，当前绘制直接用画布像素）
function rpxToCanvas(rpx, canvasW) {
  return Math.round(rpx * canvasW / 750)
}

module.exports = {
  BUBBLE_MAX: BUBBLE_MAX,
  TEAM_CARD: TEAM_CARD,
  TEAM_SHARE_STYLE: TEAM_SHARE_STYLE,
  rpxToCanvas: rpxToCanvas
}
