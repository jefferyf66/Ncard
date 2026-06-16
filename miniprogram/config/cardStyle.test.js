/**
 * cardStyle.test.js — 统一样式配置 & 气泡适配 边界场景测试
 * ================================================================
 * 运行方式：在微信开发者工具控制台执行
 *   const test = require('../../config/cardStyle.test')
 *   test.run()
 */

var cardStyle = require('./cardStyle')
var CARD = cardStyle.CARD
var rpxToCanvas = cardStyle.rpxToCanvas
var fitToBubbleSize = cardStyle.fitToBubbleSize
var calcCardHeight = cardStyle.calcCardHeight
var BUBBLE_MAX = cardStyle.BUBBLE_MAX

var passed = 0
var failed = 0
var errors = []

function assert(condition, msg) {
  if (condition) {
    passed++
    console.log('  ✅ ' + msg)
  } else {
    failed++
    var err = '  ❌ ' + msg
    console.error(err)
    errors.push(err)
  }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    passed++
    console.log('  ✅ ' + msg + ' (' + actual + ')')
  } else {
    failed++
    var err = '  ❌ ' + msg + ' expected=' + expected + ' actual=' + actual
    console.error(err)
    errors.push(err)
  }
}

// =========================================================================
// 测试套件 1: rpxToCanvas 转换
// =========================================================================
function test_rpxToCanvas() {
  console.log('\n--- 测试套件 1: rpxToCanvas 转换 ---')

  // 基准：702rpx 卡片宽度映射到 702px Canvas
  assertEq(rpxToCanvas(140, 702), 140, '140rpx → 140px @702w')
  assertEq(rpxToCanvas(32, 702), 32, '32rpx → 32px @702w')
  assertEq(rpxToCanvas(24, 702), 24, '24rpx → 24px @702w')
  assertEq(rpxToCanvas(40, 702), 40, '40rpx → 40px @702w')

  // 缩放到 50%
  assertEq(rpxToCanvas(140, 351), 70, '140rpx → 70px @351w (50%)')
  assertEq(rpxToCanvas(40, 351), 20, '40rpx → 20px @351w (50%)')

  // 极端小尺寸
  var s = rpxToCanvas(140, 100)
  assert(s > 0, '极小编制: 140rpx @100w > 0 (' + s + 'px)')
}

// =========================================================================
// 测试套件 2: calcCardHeight 不同联系方式数量
// =========================================================================
function test_calcCardHeight() {
  console.log('\n--- 测试套件 2: calcCardHeight ---')

  var h0 = calcCardHeight(702, 0)
  var h1 = calcCardHeight(702, 1)
  var h2 = calcCardHeight(702, 2)
  var h3 = calcCardHeight(702, 3)

  assert(h0 > 0, '无联系方式: 高度 > 0')
  assert(h1 > h0, '1行联系方式 > 0行')
  assert(h2 > h1, '2行联系方式 > 1行')
  assert(h3 > h2, '3行联系方式 > 2行')

  // 负数 / 溢出保护
  assertEq(calcCardHeight(702, -1), h0, '负数 → 0行')
  assertEq(calcCardHeight(702, 5), h3, '5行 → 3行上限')

  console.log('  高度对比: 0行=' + h0 + ' 1行=' + h1 + ' 2行=' + h2 + ' 3行=' + h3)
}

// =========================================================================
// 测试套件 3: fitToBubbleSize 气泡适配
// =========================================================================
function test_fitToBubbleSize() {
  console.log('\n--- 测试套件 3: fitToBubbleSize 气泡适配 ---')

  // 无需缩放（小于上限）
  var r1 = fitToBubbleSize(600, 400)
  assertEq(r1.width, 600, '600×400 不缩放: width')
  assertEq(r1.height, 400, '600×400 不缩放: height')
  assertEq(r1.scale, 1.0, '600×400 不缩放: scale=1')

  // 宽度超限
  var r2 = fitToBubbleSize(800, 400)
  assert(r2.scale < 1, '800×400 宽度超限: 缩放 < 1')
  assertEq(r2.width, 600, '800×400 → width=600')
  assertEq(r2.height, 300, '800×400 → height=300 (等比)')

  // 高度超限
  var r3 = fitToBubbleSize(400, 600)
  assert(r3.scale < 1, '400×600 高度超限: 缩放 < 1')
  assertEq(r3.height, 480, '400×600 → height=480')
  assertEq(r3.width, 320, '400×600 → width=320 (等比)')

  // 两者均超限（以更受限者为准）
  var r4 = fitToBubbleSize(900, 600)
  assert(r4.width <= BUBBLE_MAX.width, '900×600 → width ≤ max')
  assert(r4.height <= BUBBLE_MAX.height, '900×600 → height ≤ max')

  // 自定义上限
  var r5 = fitToBubbleSize(500, 500, 400, 300)
  assertEq(r5.width, 300, '500×500 custom(400,300) → width=300')
  assertEq(r5.height, 300, '500×500 custom(400,300) → height=300')

  // 极端小值
  var r6 = fitToBubbleSize(100, 50)
  assertEq(r6.scale, 1.0, '极小尺寸不放大: scale=1')
  assertEq(r6.width, 100, '极小尺寸不放大: width')
}

// =========================================================================
// 测试套件 4: 完整卡片尺寸链
// =========================================================================
function test_fullSizeChain() {
  console.log('\n--- 测试套件 4: 完整尺寸链 ---')

  var testCases = [
    { label: '标准3行', w: 702, c: 3 },
    { label: '长昵称场景', w: 800, c: 3 },
    { label: '无联系方式', w: 702, c: 0 },
    { label: '1行联系方式', w: 702, c: 1 }
  ]

  testCases.forEach(function (tc) {
    var h = calcCardHeight(tc.w, tc.c)
    var fitted = fitToBubbleSize(tc.w, h)

    assert(fitted.width > 0, tc.label + ': width > 0')
    assert(fitted.height > 0, tc.label + ': height > 0')
    assert(fitted.width <= BUBBLE_MAX.width, tc.label + ': width ≤ max')
    assert(fitted.height <= BUBBLE_MAX.height, tc.label + ': height ≤ max')

    // 缩放后宽高比 = 原始宽高比（允许1px舍入误差）
    var origRatio = tc.w / h
    var fittedRatio = fitted.width / fitted.height
    var ratioDiff = Math.abs(origRatio - fittedRatio)
    assert(ratioDiff < 0.02, tc.label + ': 宽高比保持一致 (diff=' + ratioDiff.toFixed(4) + ')')

    console.log('    ' + tc.label + ': ' + tc.w + '×' + h + ' → ' + fitted.width + '×' + fitted.height)
  })
}

// =========================================================================
// 测试套件 5: CARD 常量完整性
// =========================================================================
function test_cardConstants() {
  console.log('\n--- 测试套件 5: CARD 常量完整性 ---')

  var required = [
    'cardWidth', 'cardPadding', 'cardBorderRadius', 'cardBg',
    'avatarSize', 'avatarRadius',
    'nameFontSize', 'nameColor', 'nameFontFamily',
    'positionFontSize', 'positionColor',
    'dividerHeight', 'dividerColor',
    'companyFontSize', 'companyColor',
    'contactFontSize', 'contactColor',
    'footerHeight', 'footerBgStart', 'footerBgEnd',
    'shareBtnText', 'detailBtnText',
    'bannerHeight', 'bannerBg', 'bannerText', 'bannerTextSize', 'bannerTextColor'
  ]

  required.forEach(function (key) {
    var val = CARD[key]
    assert(val !== undefined && val !== null, 'CARD.' + key + ' 已定义')
  })

  // 数值合法性
  assert(CARD.cardWidth > 0, 'cardWidth > 0')
  assert(CARD.avatarSize > 0, 'avatarSize > 0')
  assert(CARD.avatarSize < CARD.cardWidth, 'avatarSize < cardWidth')
  assert(CARD.nameFontSize > CARD.positionFontSize, 'nameFontSize > positionFontSize')
}

// =========================================================================
// 测试套件 6: 气泡上限常量
// =========================================================================
function test_bubbleConstants() {
  console.log('\n--- 测试套件 6: 气泡上限常量 ---')

  assert(BUBBLE_MAX.width > 0, 'BUBBLE_MAX.width > 0')
  assert(BUBBLE_MAX.height > 0, 'BUBBLE_MAX.height > 0')
  assert(BUBBLE_MAX.width >= 400, 'BUBBLE_MAX.width >= 400')
  assert(BUBBLE_MAX.height >= 300, 'BUBBLE_MAX.height >= 300')
}

// =========================================================================
// 运行所有测试
// =========================================================================
function run() {
  console.log('========================================')
  console.log('cardStyle 边界场景测试')
  console.log('========================================')

  passed = 0
  failed = 0
  errors = []

  test_rpxToCanvas()
  test_calcCardHeight()
  test_fitToBubbleSize()
  test_fullSizeChain()
  test_cardConstants()
  test_bubbleConstants()

  console.log('\n========================================')
  console.log('结果: ' + passed + ' 通过, ' + failed + ' 失败')
  if (errors.length > 0) {
    console.log('失败详情:')
    errors.forEach(function (e) { console.error(e) })
  }
  console.log('========================================')

  return { passed: passed, failed: failed, errors: errors }
}

module.exports = { run: run }
