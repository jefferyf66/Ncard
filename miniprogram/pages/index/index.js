const app = getApp()
var shareCard = require('../../utils/shareCard')
var shareUtil = require('../../utils/share')
var cardStyle = require('../../config/cardStyle')

Page({
  data: {
    cards: [],
    isLoading: true,
    isEmpty: false,
    isError: false,
    errorMsg: '',
    hasMore: true,
    pageSize: 10,
    currentPage: 0,
    // Canvas 尺寸（5:4 比例 = 微信分享图显示规范，含横幅，经气泡适配）
    canvasWidth: (function() {
      var cw = cardStyle.CARD.cardWidth
      var ch = cardStyle.calcCardHeight(cw, 3) + cardStyle.rpxToCanvas(cardStyle.CARD.bannerHeight, cw)
      var fitted = cardStyle.fitToBubbleSize(cw, ch)
      return fitted.width
    })(),
    canvasHeight: (function() {
      var cw = cardStyle.CARD.cardWidth
      var ch = cardStyle.calcCardHeight(cw, 3) + cardStyle.rpxToCanvas(cardStyle.CARD.bannerHeight, cw)
      var fitted = cardStyle.fitToBubbleSize(cw, ch)
      return Math.round(fitted.width * 4 / 5)  // 5:4 比例 = 600 × 0.8 = 480
    })(),
    visitorStats: {
      visitors: 0,
      viewed: 0,
      newCards: 0
    },
    recentVisitors: [],
    // 分享相关状态
    shareCardId: '',
    shareCardData: null
  },

  onLoad() {
    console.log('[Index] onLoad')
    // 官方隐私弹窗模式：无需手动检查隐私授权状态
    // 当调用隐私 API（如云开发）时，微信自动弹出官方隐私弹窗
    this.loadCards(true)
    this.initShareMenu()
  },

  /**
   * 静默注册访客身份：确保当前用户的 openid 存在于 visitor_profiles 集合
   * 在 onShow 中调用（idempotent：已存在则跳过）
   * 后续可通过创建名片(L3)或授权弹窗(L2)补充真实身份信息
   */
  _registerVisitorProfile() {
    if (!wx.cloud) return
    var that = this
    app.getOpenId().then(function (myOpenId) {
      if (!myOpenId) return
      var db = wx.cloud.database()
      db.collection('visitor_profiles').where({ openid: myOpenId }).count()
        .then(function (res) {
          if (res.total > 0) {
            console.log('[Index] visitor_profiles 已存在，跳过注册')
            return
          }
          return db.collection('visitor_profiles').add({
            data: {
              openid: myOpenId,
              nickname: '',
              avatarUrl: '',
              createdAt: new Date(),
              updatedAt: new Date()
            }
          })
        })
        .then(function () {
          console.log('[Index] visitor_profiles 注册成功')
        })
        .catch(function (err) {
          console.warn('[Index] visitor_profiles 静默注册失败:', err)
        })
    }).catch(function () {})
  },

  openPrivacyPolicy() {
    // 官方弹窗模式：使用微信内置隐私协议页替代自定义 agreement 页面
    if (wx.openPrivacyContract) {
      wx.openPrivacyContract({
        success: () => console.log('[Index] 打开隐私协议页成功'),
        fail: (err) => {
          console.error('[Index] 打开隐私协议页失败:', err)
          // 降级：跳转到自定义协议页
          wx.navigateTo({ url: '/pages/agreement/index?tab=privacy' })
        }
      })
    } else {
      // 低版本微信降级
      wx.navigateTo({ url: '/pages/agreement/index?tab=privacy' })
    }
  },

  openServiceAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index?tab=service' })
  },

  onShow() {
    console.log('[Index] onShow')
    
    // 静默注册访客身份（idempotent：已存在则跳过）
    this._registerVisitorProfile()
    
    var needsRefresh = app.getCache('cardsNeedRefresh')
    if (needsRefresh) {
      // 编辑页设置了刷新标志 → 强制重新加载卡片
      app.setCache('cardsNeedRefresh', false)
      console.log('[Index] 检测到卡片变更，强制刷新')
      this.loadCards(true)
      this.loadVisitorData()
      return
    }
    
    const lastUpdate = app.getCache('lastCardUpdate')
    const now = Date.now()
    
    if (!lastUpdate || now - lastUpdate > 300000) {
      this.loadCards(true)
    } else {
      // 清除分享图片缓存：卡片可能在编辑页被修改
      // 防止转发时使用过时数据
      this._clearShareImageCache()
    }
    this.loadVisitorData()
  },

  /**
   * 清除分享图片缓存（页面级 + shareCard 模块级）
   */
  _clearShareImageCache() {
    if (this._shareImageCache) {
      this._shareImageCache = {}
      console.log('[Index] 分享图片缓存已清除')
    }
    this._shareImagePath = ''
    this._shareImageCardId = ''
  },

  loadVisitorData() {
    if (!wx.cloud) return

    var that = this
    // 先获取 openId，确保名片数和访客统计都按当前用户过滤
    app.getOpenId().then(function (myOpenId) {
      that._myOpenId = that._myOpenId || myOpenId

      // 1. 名片数（统计 user_save_cards，与名片夹数据源一致；_openid 由云权限自动过滤）
      wx.cloud.database().collection('user_save_cards').count()
        .then(function (res) {
          that.setData({ 'visitorStats.newCards': res.total || 0 })
        })
        .catch(function () {})

      // 2. 访客统计 — 优先用云函数，失败则静默
      that._loadVisitorStats()
    }).catch(function () {
      // 无法获取 openId → 降级：user_save_cards 云权限自动过滤
      wx.cloud.database().collection('user_save_cards').count()
        .then(function (res) {
          that.setData({ 'visitorStats.newCards': res.total || 0 })
        })
        .catch(function () {})
      that._loadVisitorStats()
    })
  },

  _loadVisitorStats() {
    // 获取当前用户 openId 以按名片所有者过滤访客统计
    app.getOpenId().then((myOpenId) => {
      if (!myOpenId) {
        this._loadVisitorStatsDirect()
        return
      }
      this._myOpenId = this._myOpenId || myOpenId

      // 合并调用：一次云函数获取统计 + 最近访客
      wx.cloud.callFunction({
        name: 'initVisits',
        data: { action: 'getMyVisitorDashboard', data: { cardOwnerId: myOpenId } }
      }).then(res => {
        if (res.result && res.result.ok) {
          this.setData({
            'visitorStats.visitors': res.result.visitors || 0,
            'visitorStats.viewed': res.result.viewed || 0
          })
          // 客户端聚合最近访客
          if (res.result.recentVisitors && res.result.recentVisitors.length > 0) {
            this._processRecentVisitors(res.result.recentVisitors)
          }
        }
      }).catch(() => {
        this._loadVisitorStatsDirect()
      })
    }).catch(() => {
      this._loadVisitorStatsDirect()
    })
  },

  _loadVisitorStatsDirect() {
    var db = wx.cloud.database()
    var _ = db.command
    var myOpenId = this._myOpenId || ''
    var that = this

    var handleError = function () {
      that.setData({
        'visitorStats.visitors': 0,
        'visitorStats.viewed': 0
      })
    }

    var baseWhere = myOpenId ? { cardOwnerId: myOpenId } : {}
    var query = db.collection('visits')
    if (myOpenId) query = query.where(baseWhere)

    query.count()
      .then(function (res) {
        that.setData({ 'visitorStats.visitors': res.total || 0 })
        var repeatWhere = myOpenId
          ? { cardOwnerId: myOpenId, visitCount: _.gt(1) }
          : { visitCount: _.gt(1) }
        return db.collection('visits').where(repeatWhere).count()
      })
      .then(function (res) {
        that.setData({ 'visitorStats.viewed': res.total || 0 })
        // 降级路径：直接查 visits 获取最近访客
        return db.collection('visits')
          .where(myOpenId ? { cardOwnerId: myOpenId } : {})
          .orderBy('visitTime', 'desc')
          .limit(20)
          .get()
      })
      .then(function (res) {
        if (res && res.data && res.data.length > 0) {
          that._processRecentVisitors(res.data)
        }
      })
      .catch(handleError)
  },

  /**
   * 处理最近访客数据（云函数和降级路径共用）
   * 客户端聚合去重 → 取 Top5 → 格式化展示
   * @param {Array} rawVisits - 原始 visits 记录
   */
  _processRecentVisitors(rawVisits) {
    if (!rawVisits || rawVisits.length === 0) return
    var merged = this._aggregateVisitors(rawVisits)
    var top5 = merged.slice(0, 5)
    var that = this
    var visitors = top5.map(function (v) {
      return that._formatVisitorItem(v)
    })
    this.setData({ recentVisitors: visitors })
  },

  /**
   * 客户端聚合：按 visitorOpenId 去重合并
   * @param {Array} visits - 原始 visits 记录
   * @returns {Array} 去重后的访客列表，按最近访问时间排序
   */
  _aggregateVisitors(visits) {
    var map = {}
    visits.forEach(function (v) {
      var key = v.visitorOpenId || ('anon_' + v._id)
      if (map[key]) {
        // 合并：取最新时间、累加访问次数
        if (new Date(v.visitTime) > new Date(map[key].visitTime)) {
          map[key].visitTime = v.visitTime
        }
        map[key].visitCount = (map[key].visitCount || 1) + (v.visitCount || 1)
      } else {
        map[key] = {
          _id: v._id,
          visitorOpenId: v.visitorOpenId,
          visitorName: v.visitorName || '',
          visitorAvatar: v.visitorAvatar || '',
          visitorPosition: v.visitorPosition || '',
          visitorCompany: v.visitorCompany || '',
          visitorLevel: v.visitorLevel || (v.visitorName ? 2 : 1),
          visitTime: v.visitTime,
          visitCount: v.visitCount || 1,
          actions: v.actions || [],
          source: v.source || 'direct'
        }
      }
    })

    // 按最近访问时间降序排列
    var list = Object.values(map)
    list.sort(function (a, b) {
      return new Date(b.visitTime) - new Date(a.visitTime)
    })
    return list
  },

  /**
   * 格式化单个访客项为展示数据
   * L3（卡片用户）：真名 + 头像
   * L2（已授权）：微信昵称 + 头像
   * L1（匿名）："访客 #XXXX" + 默认图标
   */
  _formatVisitorItem(v) {
    var level = v.visitorLevel || 1
    var displayName = v.visitorName || ''
    var displayAvatar = v.visitorAvatar || ''
    var isAnonymous = false

    if (level >= 3) {
      // L3: 卡片用户 — 已有真名和头像
      displayName = v.visitorName
      displayAvatar = v.visitorAvatar
    } else if (level === 2 && v.visitorName) {
      // L2: 已授权微信昵称
      displayName = v.visitorName
      displayAvatar = v.visitorAvatar
    } else {
      // L1: 匿名访客 — 生成匿名标识
      var openId = v.visitorOpenId || ''
      displayName = '访客 #' + openId.slice(-4).toUpperCase()
      displayAvatar = ''  // 使用默认图标
      isAnonymous = true
    }

    return {
      id: v._id,
      name: displayName,
      avatar: displayAvatar,
      position: v.visitorPosition || '',
      visitCount: v.visitCount || 1,
      visitorLevel: level,
      isAnonymous: isAnonymous,
      actions: v.actions || [],
      lastVisit: app.formatTime(v.visitTime),
      buttonText: level >= 2 ? '交换名片' : '请问是谁',
      buttonType: level >= 2 ? 'primary' : 'secondary'
    }
  },

  onPullDownRefresh() {
    console.log('[Index] 下拉刷新')
    this.loadCards(true, () => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.isLoading) {
      console.log('[Index] 加载更多')
      this.loadCards(false)
    }
  },

  loadCards(isRefresh = false, callback) {
    console.log('[Index] loadCards, isRefresh:', isRefresh)

    if (!wx.cloud) {
      this.setData({
        isLoading: false,
        isError: true,
        errorMsg: '微信版本过低，不支持云开发',
        isEmpty: true
      })
      if (callback) callback()
      return
    }

    this.setData({ isLoading: true, isError: false })

    // 先获取用户 openId，用于过滤只显示自己的名片
    app.getOpenId().then((myOpenId) => {
      if (!myOpenId) {
        // 无法获取 openId 时降级为不过滤
        console.warn('[Index] 未获取到 openId，不进行过滤')
        this._doLoadCards(isRefresh, callback, null)
        return
      }
      this._myOpenId = myOpenId
      this._doLoadCards(isRefresh, callback, myOpenId)
    }).catch(() => {
      console.warn('[Index] getOpenId 失败，降级加载')
      this._doLoadCards(isRefresh, callback, null)
    })
  },

  _doLoadCards(isRefresh, callback, myOpenId) {
    const currentPage = isRefresh ? 0 : this.data.currentPage
    const collection = wx.cloud.database().collection('cards')
    var query = collection
      .orderBy('createTime', 'desc')
      .skip(currentPage * this.data.pageSize)
      .limit(this.data.pageSize)

    // 仅显示当前用户自己创建的名片
    if (myOpenId) {
      query = query.where({ _openid: myOpenId })
    }

    const timer = setTimeout(() => {
      console.warn('[Index] 加载超时，尝试使用缓存')
      this.tryLoadCache()
      if (callback) callback()
    }, 10000)

    query.get()
      .then(res => {
        clearTimeout(timer)
        console.log('[Index] 获取成功，数量:', res.data.length)

        const newCards = res.data || []
        const cards = isRefresh ? newCards : [...this.data.cards, ...newCards]
        const hasMore = newCards.length >= this.data.pageSize
        const isEmpty = isRefresh && newCards.length === 0

        this.setData({
          cards,
          isLoading: false,
          isEmpty,
          isError: false,
          hasMore,
          currentPage: currentPage + 1
        })

        app.setCache('cardsCache', cards, 600000)
        app.setCache('lastCardUpdate', Date.now())

        if (callback) callback()

        // 【新增】后台预生成分享卡片（避免用户点击分享时图片未就绪）
        // 先清除旧的页面级缓存，确保使用最新数据
        this._clearShareImageCache()
        this._preGenerateVisibleCards(cards)
      })
      .catch(err => {
        clearTimeout(timer)
        console.error('[Index] 加载失败:', err)
        this.tryLoadCache()
        this.setData({
          isError: true,
          errorMsg: '网络错误，请检查网络后重试'
        })
        if (callback) callback()
      })
  },

  tryLoadCache() {
    const cache = app.getCache('cardsCache')
    if (cache && cache.value && cache.value.length > 0) {
      console.log('[Index] 使用缓存数据')
      this.setData({
        cards: cache.value,
        isLoading: false,
        isEmpty: cache.value.length === 0
      })
    }
  },

  retryLoad() {
    this.setData({ isError: false })
    this.loadCards(true)
  },

  goToEdit() {
    console.log('[Index] 跳转到编辑页')
    wx.navigateTo({
      url: '/pages/edit/index',
      fail: (err) => {
        console.error('[Index] 跳转失败:', err)
        app.showError('跳转失败')
      }
    })
  },

  onShareButtonTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return

    const card = this.data.cards.find(c => c._id === id)
    if (!card) return

    // 初始化缓存对象
    if (!this._shareImageCache) {
      this._shareImageCache = {}
    }

    // 【修复】清除过时缓存：卡片可能已被修改，强制重新生成
    delete this._shareImageCache[id]

    // 清除旧的分享图片引用
    this._shareImagePath = ''
    this._shareImageCardId = ''

    this.setData({
      shareCardId: id,
      shareCardData: card
    })

    this._preGenerateShareCardWithKey(card, id)
  },

  _preGenerateShareCardWithKey(card, cardId, retryCount) {
    // 按卡片 ID 独立锁定，避免全局锁阻塞不同卡片的并行生成
    if (!this._generatingCards) {
      this._generatingCards = {}
    }
    if (this._generatingCards[cardId]) {
      console.log('[Index] 该卡片正在生成中，跳过重复请求:', cardId)
      return
    }

    retryCount = retryCount || 0
    var MAX_RETRIES = 3
    var RETRY_DELAYS = [100, 300, 600]  // 退避延迟 (ms)
    var that = this

    this._generatingCards[cardId] = true
    console.log('[Index] 开始生成分享卡片, id:', cardId, 'retry:', retryCount, 'name:', card.name)

    // 【修复】清除过时缓存：卡片数据可能已被编辑，强制重新生成
    if (that._shareImageCache) {
      delete that._shareImageCache[cardId]
    }

    shareCard.generate('#shareCanvas', card, {
      cardKey: cardId,
      pageContext: this  // 【修复】传入页面作用域，确保真机 type="2d" canvas 可查询
    }).then(function (res) {
      console.log('[Index] 分享卡片生成成功:', res.tempFilePath)
      that._shareImagePath = res.tempFilePath
      that._shareImageCardId = cardId

      if (!that._shareImageCache) {
        that._shareImageCache = {}
      }
      that._shareImageCache[cardId] = res.tempFilePath

      that._generatingCards[cardId] = false
      console.log('[Index] 分享卡片已生成并缓存:', res.tempFilePath)
    }).catch(function (err) {
      var msg = (err && err.message) || ''

      // Canvas 节点未就绪 → 退避重试
      if (msg.indexOf('Canvas 节点未找到') >= 0 && retryCount < MAX_RETRIES) {
        var delay = RETRY_DELAYS[retryCount] || 600
        console.log('[Index] Canvas 节点未就绪，', delay + 'ms 后重试 (',
          (retryCount + 1) + '/' + MAX_RETRIES + '), id:', cardId)
        that._generatingCards[cardId] = false
        setTimeout(function () {
          that._preGenerateShareCardWithKey(card, cardId, retryCount + 1)
        }, delay)
        return
      }

      // 已达最大重试次数或其它错误 → 放弃
      that._generatingCards[cardId] = false
      console.error('[Index] 分享卡片生成失败 (' + retryCount + ' retries):', msg)
    })
  },

  /**
   * 后台预生成分享卡片（加载完成后调用，避免用户首次分享时图片未就绪）
   * @param {Array} cards - 当前页面的名片列表
   */
  _preGenerateVisibleCards(cards) {
    if (!cards || cards.length === 0) return
    var that = this

    // 延迟 600ms 等页面渲染完成，Canvas 节点挂载后再生成
    setTimeout(function () {
      var count = Math.min(cards.length, 2)
      console.log('[Index] 后台预生成分享卡片, 数量:', count)

      for (var i = 0; i < count; i++) {
        var card = cards[i]
        var cardId = card._id
        if (!cardId) continue

        if (that._shareImageCache && that._shareImageCache[cardId]) continue

        // 延迟错开避免并发 canvas 操作冲突
        ;(function (c, cId, delay) {
          setTimeout(function () {
            that._preGenerateShareCardWithKey(c, cId)
          }, delay)
        })(card, cardId, i * 400)
      }
    }, 600)
  },

  stopPropagation() {
    // 阻止事件冒泡
  },

  initShareMenu() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
      success: () => console.log('[Index] 分享菜单初始化成功'),
      fail: (err) => console.warn('[Index] 分享菜单初始化失败:', err)
    })
  },

  onShareAppMessage() {
    const card = this.data.shareCardData || {}
    const id = this.data.shareCardId || ''
    const path = id ? `/pages/preview/index?id=${id}&source=share` : '/pages/index/index'

    // 【重构】使用公共模块生成标题
    const title = shareUtil.buildShareTitle(card)

    // 【修复 Bug #2】Canvas 生成是异步的，onShareAppMessage 触发时图片很可能尚未就绪
    // → 返回 Promise，微信框架会显示加载指示器等待 resolve
    var that = this

    // 快速路径：缓存已命中 → 直接返回（同步 Object）
    if (this._shareImageCache && this._shareImageCache[id]) {
      console.log('[Index] 分享图片缓存命中, 直接返回:', id)
      return {
        title: title,
        path: path,
        imageUrl: this._shareImageCache[id]
      }
    }

    // 慢速路径：等待 Canvas 异步生成完成
    // 微信基础库 2.11.3+ 支持 onShareAppMessage 返回 Promise
    console.log('[Index] 分享图片未就绪，启动异步等待, cardId:', id)

    // 兜底：如果还未触发预生成（例如用户通过右上角菜单分享），主动触发
    if (id && card._id && !(that._generatingCards && that._generatingCards[id])) {
      console.log('[Index] 异步等待: 触发预生成, cardId:', id)
      that._preGenerateShareCardWithKey(card, id)
    }

    return new Promise(function (resolve) {
      var startTime = Date.now()
      var MAX_WAIT = 8000   // 最多等待 8 秒

      function tryResolve() {
        // 优先：当前卡片专属缓存
        var imageUrl = ''
        if (that._shareImageCache && that._shareImageCache[id]) {
          imageUrl = that._shareImageCache[id]
          console.log('[Index] 异步等待命中缓存:', id)
        }

        if (!imageUrl && that._shareImagePath && that._shareImageCardId === id) {
          imageUrl = that._shareImagePath
          console.log('[Index] 异步等待命中最新图片:', id)
        }

        if (imageUrl) {
          resolve({ title: title, path: path, imageUrl: imageUrl })
          return true
        }
        return false
      }

      function poll() {
        if (tryResolve()) return

        if (Date.now() - startTime > MAX_WAIT) {
          // 超时 → 降级到头像，避免微信截取页面截图
          console.warn('[Index] 分享图片生成超时，降级使用头像')
          var avatar = card.avatar || ''
          var fallbackUrl = avatar.indexOf('https://') === 0 ? avatar : ''
          resolve({ title: title, path: path, imageUrl: fallbackUrl })
          return
        }

        setTimeout(poll, 150)
      }

      poll()
    })
  },

  onShareTimeline() {
    const card = this.data.shareCardData || {}
    const id = this.data.shareCardId || ''

    // 生成标题：姓名-公司名称，限制20个字符
    var name = card.name || ''
    var company = card.company || ''
    var title = name
    if (company) {
      title = name + '-' + company
    }
    if (title.length > 20) {
      title = title.substring(0, 17) + '...'
    }

    var that = this

    // 快速路径：缓存命中
    if (this._shareImageCache && this._shareImageCache[id]) {
      return {
        title: title,
        query: id ? 'id=' + id : '',
        imageUrl: this._shareImageCache[id]
      }
    }

    // 兜底：触发预生成
    if (id && card._id && !(that._generatingCards && that._generatingCards[id])) {
      that._preGenerateShareCardWithKey(card, id)
    }

    // 慢速路径：Promise 等待
    return new Promise(function (resolve) {
      var startTime = Date.now()
      var MAX_WAIT = 8000

      function tryResolve() {
        var imageUrl = ''
        if (that._shareImageCache && that._shareImageCache[id]) {
          imageUrl = that._shareImageCache[id]
        }
        if (!imageUrl && that._shareImagePath && that._shareImageCardId === id) {
          imageUrl = that._shareImagePath
        }
        if (imageUrl) {
          resolve({ title: title, query: id ? 'id=' + id : '', imageUrl: imageUrl })
          return true
        }
        return false
      }

      function poll() {
        if (tryResolve()) return
        if (Date.now() - startTime > MAX_WAIT) {
          var avatar = card.avatar || ''
          var fallbackUrl = avatar.indexOf('https://') === 0 ? avatar : ''
          resolve({ title: title, query: id ? 'id=' + id : '', imageUrl: fallbackUrl })
          return
        }
        setTimeout(poll, 150)
      }

      poll()
    })
  },

  goToPreview(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      app.showError('参数错误')
      return
    }

    console.log('[Index] 跳转到预览页, id:', id)
    wx.navigateTo({
      url: `/pages/preview/index?id=${id}`,
      fail: (err) => {
        console.error('[Index] 跳转失败:', err)
        app.showError('跳转失败')
      }
    })
  },

  goToVisitors() {
    console.log('[Index] 跳转到访客页')
    wx.navigateTo({
      url: '/pages/visitors/index',
      fail: (err) => {
        console.error('[Index] 跳转失败:', err)
        app.showError('跳转失败')
      }
    })
  },

  goToCardList() {
    console.log('[Index] 跳转到名片列表')
    wx.navigateTo({
      url: '/pages/list/index',
      fail: (err) => {
        console.error('[Index] 跳转失败:', err)
        app.showError('跳转失败')
      }
    })
  },

  goToVisitorDetail(e) {
    const item = e.currentTarget.dataset.item
    console.log('[Index] 查看访客详情:', item.name)
    wx.showToast({ title: `查看 ${item.name} 的信息`, icon: 'none' })
  },

  /**
   * 添加到桌面指引
   */
  addToDesktop() {
    wx.showModal({
      title: '添加到桌面',
      content: '请点击右上角 "..." 按钮，选择"添加到桌面"即可将科博名片添加到手机桌面',
      showCancel: false,
      confirmText: '我知道了'
    })
  },

  /**
   * 头像加载失败降级：替换为默认头像
   */
  onAvatarError(e) {
    var index = e.currentTarget.dataset.index
    if (index === undefined || index === null) return
    var key = 'cards[' + index + '].avatar'
    var data = {}
    data[key] = '/images/avatar.png'
    this.setData(data)
  },

  /**
   * 访客头像加载失败降级：清空 avatar 让 WXML 走 else 分支显示默认图标
   */
  onVisitorAvatarError(e) {
    var index = e.currentTarget.dataset.index
    if (index === undefined || index === null) return
    var key = 'recentVisitors[' + index + '].avatar'
    var data = {}
    data[key] = ''
    this.setData(data)
  }
})
