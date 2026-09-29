/**
 * cardStyle.js — 名片卡片统一样式配置（单一数据源）
 * ================================================================
 * 
 * 设计原则：
 * 1. 所有视觉属性以 rpx 为单位定义（基于 750rpx 设计稿宽度）
 * 2. 首页 WXML 和分享 Canvas 共用此配置，确保视觉一致
 * 3. Canvas 渲染时通过 rpxToCanvas() 转换为实际像素
 *
 * 使用方式：
 *   const { CARD, rpxToCanvas, fitToBubbleSize } = require('../../config/cardStyle')
 *   const avatarPx = rpxToCanvas(CARD.avatarSize, canvasWidth)
 */

// =========================================================================
// 微信气泡卡片尺寸上限
// 分享图片在聊天气泡中显示时，微信会做等比缩放
// 若超出以下限制，调用 fitToBubbleSize() 预先缩放以避免变形/裁切
// =========================================================================
var BUBBLE_MAX = Object.freeze({
  width: 600,   // 气泡卡片最大宽度 (px)
  height: 480   // 气泡卡片最大高度 (px)，保持 5:4 比例
})

// =========================================================================
// 基于 750rpx 设计稿的卡片样式常量
// =========================================================================
var CARD = Object.freeze({

  // === 卡片容器 ===
  cardWidth: 702,             // rpx (750 - 24*2 页面内边距)
  cardPadding: 32,            // rpx (卡片内边距)
  cardBorderRadius: 24,       // rpx
  cardBg: '#FFFFFF',
  cardBorderWidth: 1,         // rpx
  cardBorderColor: 'rgba(0, 0, 0, 0.06)',
  cardShadowBlur: 32,         // rpx
  cardShadowOffsetY: 8,       // rpx
  cardShadowColor: 'rgba(0, 0, 0, 0.08)',

  // === 头像 ===
  avatarSize: 140,            // rpx (正方形)
  avatarRadius: 4,            // rpx（与 UI 卡片锐角风格一致，v1.5.8 由 16 调整）
  avatarBg: '#F1F5F9',
  avatarPlaceholderGradientStart: '#3B82F6',
  avatarPlaceholderGradientEnd: '#8B5CF6',

  // === 顶部区域 (card-top) ===
  topGap: 24,                 // rpx (头像与文字区间距)
  topMarginBottom: 24,        // rpx (card-top 与分割线间距)

  // === 姓名 ===
  nameFontSize: 40,           // rpx
  nameFontWeight: 'bold',
  nameColor: '#1E293B',
  nameFontFamily: "Georgia, 'Times New Roman', serif",
  nameTextAlign: 'left',      // 与首页 UI 一致：文字区左对齐于头像右侧起点

  // === 职位 ===
  positionFontSize: 26,       // rpx
  positionColor: '#64748B',
  positionGap: 8,             // rpx (姓名与职位间距)

  // === 分割线 ===
  dividerHeight: 2,           // rpx
  dividerColor: 'rgba(0, 0, 0, 0.08)',
  dividerMarginBottom: 24,    // rpx

  // === 公司名 ===
  companyFontSize: 32,        // rpx
  companyFontWeight: '600',
  companyColor: '#1E293B',
  companyTextAlign: 'left',

  // === 联系方式 ===
  contactFontSize: 26,        // rpx
  contactColor: '#475569',
  contactTextAlign: 'left',   // 与首页 UI 一致：联系方式左对齐于卡片内边距
  contactItemGap: 40,          // rpx (联系方式各行间距 = 字高 + 行距, ≈1.5倍行高)
  bodyGap: 20,                // rpx (公司名与联系方式区间距)

  // === 底部按钮栏 ===
  footerHeight: 96,           // rpx
  footerBgStart: '#1E3A5F',
  footerBgEnd: '#2D4A6F',
  footerBtnTextSize: 28,      // rpx
  footerBtnTextColor: '#FFFFFF',
  footerBtnTextWeight: '500',
  footerDividerColor: 'rgba(255, 255, 255, 0.3)',
  footerBorderRadiusBottom: 24, // rpx (仅底部圆角)

  // === 按钮文案 ===
  shareBtnText: '发名片',
  detailBtnText: '名片详情',

  // === 分享卡顶部横幅 ===
  bannerHeight: 80,           // rpx (约 76px @702px宽)
  bannerBg: '#F5F7FA',        // 与分享图浅灰底(#F5F7FA)一致，横幅不再有独立底色块
  bannerText: '点击保存我的名片',
  bannerTextSize: 38,         // rpx（字体再次放大，更突出引导，需配合 SHARE_IMAGE_STYLE 抬版本重绘）
  bannerTextColor: '#2563EB',
  bannerTextWeight: '700'     // 加粗更突出
})

// =========================================================================
// rpx → Canvas 像素转换
// @param {number} rpx    - rpx 值
// @param {number} canvasW - 卡片在 Canvas 上的目标宽度 (px)
// @returns {number} 实际像素值
// =========================================================================
function rpxToCanvas(rpx, canvasW) {
  return Math.round(rpx * canvasW / CARD.cardWidth)
}

// =========================================================================
// 气泡尺寸适配
// 当卡片渲染尺寸超出微信气泡限制时，等比缩放至适配范围
// @param {number} cardW - 卡片自然宽度 (px)
// @param {number} cardH - 卡片自然高度 (px)
// @param {number} [maxW] - 最大宽度，默认 BUBBLE_MAX.width
// @param {number} [maxH] - 最大高度，默认 BUBBLE_MAX.height
// @returns {{ width: number, height: number, scale: number }}
// =========================================================================
function fitToBubbleSize(cardW, cardH, maxW, maxH) {
  maxW = maxW || BUBBLE_MAX.width
  maxH = maxH || BUBBLE_MAX.height

  var scaleW = maxW / cardW
  var scaleH = maxH / cardH
  var scale = Math.min(scaleW, scaleH, 1.0)  // 只缩小不放大

  return {
    width: Math.round(cardW * scale),
    height: Math.round(cardH * scale),
    scale: scale
  }
}

// =========================================================================
// 计算卡片在 Canvas 上的自然高度
// 基于 CARD 常量和实际内容（联系方式行数）
// @param {number} canvasW     - 卡片 Canvas 宽度
// @param {number} contactCount - 联系方式行数 (0-3)
// @returns {number} 卡片自然高度 (px)
// =========================================================================
function calcCardHeight(canvasW, contactCount) {
  var c = contactCount || 0
  if (c < 0) c = 0
  if (c > 3) c = 3

  // 高度公式（从上到下累加）：
  // padding_top + card-top(avatar + gap) + topMarginBottom
  // + divider + dividerMarginBottom
  // + company + bodyGap + contacts(c items) + padding_bottom

  var padding = rpxToCanvas(CARD.cardPadding, canvasW)
  var avatar = rpxToCanvas(CARD.avatarSize, canvasW)
  var topGap = rpxToCanvas(CARD.topGap, canvasW)
  var topMargin = rpxToCanvas(CARD.topMarginBottom, canvasW)
  var divider = rpxToCanvas(CARD.dividerHeight, canvasW)
  var dividerMargin = rpxToCanvas(CARD.dividerMarginBottom, canvasW)
  var companyFont = rpxToCanvas(CARD.companyFontSize, canvasW)
  var bodyGap = rpxToCanvas(CARD.bodyGap, canvasW)
  var contactGap = rpxToCanvas(CARD.contactItemGap, canvasW)

  // card-top 高度取头像和文字区中较大者 + topGap
  // 文字区 = nameFontSize + positionGap + positionFontSize
  var nameFont = rpxToCanvas(CARD.nameFontSize, canvasW)
  var posFont = rpxToCanvas(CARD.positionFontSize, canvasW)
  var posGap = rpxToCanvas(CARD.positionGap, canvasW)
  var textH = nameFont + posGap + posFont
  var cardTopH = Math.max(avatar, textH) + topGap

  // card-body (contactGap 已含字体高度 = 总行距)
  var contactsH = c > 0 ? c * contactGap : 0
  var bodyH = companyFont + bodyGap + contactsH

  return padding           // top padding
    + cardTopH
    + topMargin
    + divider
    + dividerMargin
    + bodyH
    + padding              // bottom padding
}

// =========================================================================
// 计算卡片默认 Canvas 尺寸（未经气泡适配）
// =========================================================================
function defaultCardCanvasSize() {
  // 默认：卡片宽度 = CARD.cardWidth px (1:1 映射)
  // 高度根据 3 行联系方式计算（最大情况）
  var w = CARD.cardWidth  // 702
  var h = calcCardHeight(w, 3)
  return { width: w, height: h }
}

module.exports = {
  BUBBLE_MAX: BUBBLE_MAX,
  CARD: CARD,
  rpxToCanvas: rpxToCanvas,
  fitToBubbleSize: fitToBubbleSize,
  calcCardHeight: calcCardHeight,
  defaultCardCanvasSize: defaultCardCanvasSize
}
