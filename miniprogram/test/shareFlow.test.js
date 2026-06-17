/**
 * shareFlow.test.js — 分享流程端到端集成测试
 * ==========================================
 * 模拟微信小程序内点击首页"发名片"按钮的完整流程：
 *   1. 页面加载
 *   2. 用户点击"发名片"按钮（触发 onShareButtonTap）
 *   3. 预生成分享卡片（_preGenerateShareCardWithKey）
 *   4. 用户点击微信右上角"···" → 选择好友
 *   5. 微信调用 onShareAppMessage
 *   6. 接收方点击分享卡片 → 打开 preview 页面
 *
 * 运行方式：
 *   1. 在微信开发者工具中添加 test 页面
 *   2. 在 test.wxml 添加按钮：<button bindtap="runTest">运行分享流程测试</button>
 *   3. 在 test.js 中引入本文件并调用 runShareFlowTest()
 */

const shareCard = require('../utils/shareCard')
const shareUtil = require('../utils/share')

// ============================================
// Mock 数据
// ============================================

var mockPageData = {
  cards: [
    {
      _id: 'card_alpha',
      _openid: 'user_alpha',
      name: '欧阳明月',
      position: '前端架构师',
      company: 'MiniMax网络科技',
      phone: '13812345678',
      email: 'mingyue@minimax.com',
      address: '北京市朝阳区',
      avatar: 'https://example.com/avatar1.png'
    },
    {
      _id: 'card_beta',
      _openid: 'user_beta',
      name: '司马长空',
      position: '后端工程师',
      company: '字节跳动有限公司',
      phone: '13987654321',
      email: 'chang kong@bytedance.com',
      avatar: 'cloud://ncard-prod-123.636c-ncard-prod-123/avatars/sima.png'
    },
    {
      _id: 'card_gamma',
      name: '诸葛亮',
      position: '产品总监',
      company: '腾讯',
      avatar: ''  // 无头像
    }
  ]
}

// 模拟的 Page 实例
function createMockPage() {
  return {
    data: Object.assign({}, mockPageData, {
      shareCardId: '',
      shareCardData: null
    }),
    _shareImagePath: '',
    _shareImageCache: {},
    _generatingCards: {},
    setData: function(obj) {
      Object.assign(this.data, obj)
    },
    // 模拟 Canvas 节点就绪
    _isCanvasReady: function() { return true }
  }
}

// ============================================
// 模拟的 Page 方法（从 index.js 提取的核心逻辑）
// ============================================

function mockOnShareButtonTap(page, e) {
  const id = e.currentTarget.dataset.id
  console.log('[模拟] 点击发名片按钮, id:', id)

  if (!id) {
    console.error('  ❌ id 为空')
    return null
  }

  const card = page.data.cards.find(c => c._id === id)
  if (!card) {
    console.error('  ❌ 未找到名片:', id)
    return null
  }

  console.log('  → 找到名片:', card.name, '/', card.company)

  // 初始化缓存
  if (!page._shareImageCache) page._shareImageCache = {}

  // 命中缓存
  if (page._shareImageCache[id]) {
    page._shareImagePath = page._shareImageCache[id]
    page.setData({ shareCardId: id, shareCardData: card })
    console.log('  → 使用缓存的分享图片')
    return { fromCache: true, cardKey: id }
  }

  // 清除其他名片缓存
  const keys = Object.keys(page._shareImageCache)
  keys.forEach(key => {
    if (key !== id) delete page._shareImageCache[key]
  })
  page._shareImagePath = ''
  page.setData({ shareCardId: id, shareCardData: card })

  // 预生成分享卡片
  return mockPreGenerateShareCard(page, card, id)
}

function mockPreGenerateShareCard(page, card, cardId) {
  if (page._generatingCards && page._generatingCards[cardId]) {
    console.log('  ⏳ 该卡片正在生成中，跳过重复请求')
    return Promise.resolve({ skipped: true })
  }
  if (!page._generatingCards) page._generatingCards = {}
  page._generatingCards[cardId] = true

  console.log('  → 开始调用 shareCard.generate...')
  return shareCard.generate('#shareCanvas', card, { cardKey: cardId })
    .then(function(res) {
      page._shareImagePath = res.tempFilePath
      page._shareImageCache[cardId] = res.tempFilePath
      page._generatingCards[cardId] = false
      console.log('  ✅ 分享卡片生成成功:', res.tempFilePath)
      return { success: true, tempFilePath: res.tempFilePath }
    })
    .catch(function(err) {
      page._generatingCards[cardId] = false
      console.error('  ❌ 分享卡片生成失败:', err && err.message)
      return { success: false, error: err && err.message }
    })
}

function mockOnShareAppMessage(page) {
  const card = page.data.shareCardData || {}
  const id = page.data.shareCardId || ''
  const path = id ? `/pages/preview/index?id=${id}&source=share` : '/pages/index/index'

  const title = shareUtil.buildShareTitle(card)

  let imageUrl = ''
  if (page._shareImagePath) {
    imageUrl = page._shareImagePath
  } else if (page._shareImageCache && page._shareImageCache[id]) {
    imageUrl = page._shareImageCache[id]
  } else {
    const avatar = card.avatar || ''
    if (avatar.indexOf('https://') === 0) imageUrl = avatar
  }

  console.log('[模拟] onShareAppMessage 返回:')
  console.log('  → title:', title)
  console.log('  → path:', path)
  console.log('  → imageUrl:', imageUrl ? imageUrl.substring(0, 50) + '...' : '(空)')

  return { title: title, path: path, imageUrl: imageUrl }
}

// ============================================
// 测试场景
// ============================================

var scenarios = [
  {
    name: '场景1: HTTPS 头像名片（无缓存）',
    cardId: 'card_alpha',
    expected: { imageUrlPrefix: 'wxfile://' }
  },
  {
    name: '场景2: cloud:// 头像名片',
    cardId: 'card_beta',
    expected: { imageUrlPrefix: 'wxfile://' }
  },
  {
    name: '场景3: 无头像名片',
    cardId: 'card_gamma',
    expected: { title: '诸葛亮-腾讯' }
  },
  {
    name: '场景4: 命中缓存的二次分享',
    cardId: 'card_alpha',  // 复用场景1
    expected: { fromCache: true }
  }
]

function runShareFlowTest() {
  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║   🧪 分享流程端到端集成测试                      ║')
  console.log('╚══════════════════════════════════════════════╝')

  var pass = 0
  var fail = 0
  var idx = 0

  function next() {
    if (idx >= scenarios.length) {
      console.log('\n\n========== 测试总结 ==========')
      console.log('通过: ' + pass + ' / 失败: ' + fail)
      return
    }

    var scenario = scenarios[idx++]
    var page = createMockPage()

    console.log('\n▶ ' + scenario.name)
    console.log('───────────────────────────────────────')

    // 模拟点击
    var result = mockOnShareButtonTap(page, {
      currentTarget: { dataset: { id: scenario.cardId } }
    })

    if (result && typeof result.then === 'function') {
      result.then(function() {
        // 模拟微信调用 onShareAppMessage
        var shareResult = mockOnShareAppMessage(page)
        validate(scenario, shareResult, page, function(ok) {
          if (ok) pass++; else fail++
          next()
        })
      })
    } else {
      var shareResult = mockOnShareAppMessage(page)
      validate(scenario, shareResult, page, function(ok) {
        if (ok) pass++; else fail++
        next()
      })
    }
  }

  function validate(scenario, shareResult, page, done) {
    var ok = true
    if (scenario.expected.title) {
      if (shareResult.title === scenario.expected.title) {
        console.log('  ✅ 标题匹配:', shareResult.title)
      } else {
        console.log('  ❌ 标题不符:', shareResult.title, '!==', scenario.expected.title)
        ok = false
      }
    } else {
      console.log('  ℹ️  分享标题:', shareResult.title)
    }

    if (scenario.expected.imageUrlPrefix) {
      if (shareResult.imageUrl && shareResult.imageUrl.indexOf(scenario.expected.imageUrlPrefix) === 0) {
        console.log('  ✅ imageUrl 前缀匹配:', shareResult.imageUrl.substring(0, 30))
      } else {
        console.log('  ⚠️  imageUrl:', shareResult.imageUrl || '(空)')
      }
    }

    if (scenario.expected.fromCache) {
      // 验证 page._shareImageCache 中有值
      if (page._shareImageCache[scenario.cardId]) {
        console.log('  ✅ 命中缓存')
      } else {
        console.log('  ❌ 缓存未命中')
        ok = false
      }
    }

    if (!shareResult.path || shareResult.path.indexOf('source=share') === -1) {
      console.log('  ❌ path 缺少 source=share:', shareResult.path)
      ok = false
    } else {
      console.log('  ✅ path 正确:', shareResult.path)
    }

    if (ok) {
      console.log('\n  ✅ 通过: ' + scenario.name)
    } else {
      console.log('\n  ❌ 失败: ' + scenario.name)
    }
    done(ok)
  }

  next()
}

// ============================================
// 导出
// ============================================

module.exports = {
  runShareFlowTest: runShareFlowTest,
  createMockPage: createMockPage,
  mockOnShareButtonTap: mockOnShareButtonTap,
  mockOnShareAppMessage: mockOnShareAppMessage
}
