// pages/test/index.js
// 测试运行器页面
const unitTest = require('../../test/shareCard.test.js')
const integrationTest = require('../../test/shareFlow.test.js')

Page({
  data: {
    testStatus: '待运行',
    testLogs: []
  },

  onLoad() {
    console.log('[Test] 测试页面加载完成')
  },

  // 运行单元测试
  runUnitTest() {
    console.log('\n>>> 启动单元测试')
    this.setData({ testStatus: '单元测试运行中...' })
    unitTest.runAllTests().then(function(result) {
      this.setData({
        testStatus: '单元测试完成 - ' + result.passed + '/' + result.total + ' 通过'
      })
    }.bind(this))
  },

  // 运行集成测试
  runIntegrationTest() {
    console.log('\n>>> 启动集成测试')
    this.setData({ testStatus: '集成测试运行中...' })
    integrationTest.runShareFlowTest()
    setTimeout(function() {
      this.setData({ testStatus: '集成测试完成 - 查看 console 日志' })
    }.bind(this), 3000)
  },

  // 一键运行所有测试
  runAllTests() {
    console.log('\n>>> 一键运行所有测试')
    this.setData({ testStatus: '运行中...' })
    this.runUnitTest()
    setTimeout(function() {
      this.runIntegrationTest()
    }.bind(this), 1500)
  },

  // 模拟点击"发名片"按钮（最贴近真实场景）
  simulateRealClick() {
    console.log('\n╔══════════════════════════════════════════════╗')
    console.log('║   🎯 模拟真实点击"发名片"按钮                     ║')
    console.log('╚══════════════════════════════════════════════╝')

    const page = integrationTest.createMockPage()
    const cardId = 'card_alpha'
    console.log('[场景] 模拟用户点击卡片', cardId, '的"发名片"按钮')

    // 1. 模拟点击事件
    const clickResult = integrationTest.mockOnShareButtonTap(page, {
      currentTarget: { dataset: { id: cardId } }
    })

    if (clickResult && typeof clickResult.then === 'function') {
      clickResult.then(function() {
        // 2. 模拟微信右上角"···"菜单
        console.log('\n[场景] 用户点击微信右上角"···"，选择好友')
        const shareResult = integrationTest.mockOnShareAppMessage(page)
        console.log('\n[场景] 微信拉起聊天面板，使用以下参数:')
        console.log('  - title:', shareResult.title)
        console.log('  - path:', shareResult.path)
        console.log('  - imageUrl: ' + (shareResult.imageUrl ? '已就绪' : '未生成'))
        console.log('\n[场景] 接收方点击分享卡片 → 打开 preview 页面')
        console.log('  - 解析 path:', shareResult.path)
        console.log('  - 进入详情页: /pages/preview/index')
        console.log('\n✅ 完整流程模拟结束')
      })
    } else {
      const shareResult = integrationTest.mockOnShareAppMessage(page)
      console.log('\n[场景] 分享参数:', shareResult)
    }
  }
})
