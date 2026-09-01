const app = getApp()
var shareUtil = require('../../utils/share')
var teamUtil = require('../../utils/team')
var cardStyle = require('../../config/cardStyle')
var storage = require('../../config/storage')

Page({
  data: {
    cards: [],
    isLoading: true,
    isEmpty: false,
    isError: false,
    errorMsg: '',
    teamCount: 0,
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
    // 分享相关状态
    shareCardId: '',
    shareCardData: null,
    // 拖拽排序状态（首页名片顺序调整）
    dragStartIndex: -1,
    dragStartY: 0,
    isDragging: false
  },

  onLoad() {
    // 官方隐私弹窗模式：无需手动检查隐私授权状态
    // 当调用隐私 API（如云开发）时，微信自动弹出官方隐私弹窗
    this.loadCards(true)
    this.initShareMenu()
    // 缓存设备平台，供「添加到桌面」等场景复用（避免每次点击重复取）
    const deviceInfoCache = wx.getDeviceInfo ? wx.getDeviceInfo() : {}
    this._devicePlatform = (deviceInfoCache.platform || deviceInfoCache.system || '').toLowerCase()
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
          // 注册成功
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
        success: () => {},
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
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    // 静默注册访客身份（idempotent：已存在则跳过）
    this._registerVisitorProfile()

    // 实时拉取「我的团队」数量（5 分钟缓存，见 loadTeamCount）
    this.loadTeamCount()
    
    var needsRefresh = app.getCache('cardsNeedRefresh')
    if (needsRefresh) {
      // 编辑页设置了刷新标志 → 强制重新加载卡片
      app.setCache('cardsNeedRefresh', false)
      this.loadCards(true)
      return
    }
    
    const lastUpdate = app.getCache('lastCardUpdate')
    const now = Date.now()
    
    if (!lastUpdate || now - lastUpdate > 300000) {
      this.loadCards(true)
    }
  },

  onPullDownRefresh() {
    this.loadCards(true, () => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.isLoading) {
      this.loadCards(false)
    }
  },

  onUnload() {
    if (this._loadTimer) {
      clearTimeout(this._loadTimer)
      this._loadTimer = null
    }
  },

  loadCards(isRefresh = false, callback) {
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

    this._loadTimer = setTimeout(() => {
      console.warn('[Index] 加载超时，尝试使用缓存')
      this.tryLoadCache()
      if (callback) callback()
    }, 10000)

    query.get()
      .then(res => {
        clearTimeout(this._loadTimer)

        const newCards = res.data || []
        const rawCards = isRefresh ? newCards : [...this.data.cards, ...newCards]
        const cards = this._sortCards(rawCards)
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
      })
      .catch(err => {
        clearTimeout(this._loadTimer)
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
      this.setData({
        cards: this._sortCards(cache.value),
        isLoading: false,
        isEmpty: cache.value.length === 0
      })
    }
  },

  /**
   * 客户端排序：有 order 的卡片按 order 升序（手动排序优先），
   * 无 order 的卡片（含新创建未排过序的）排在后面，彼此按 createTime 降序（最新在前）。
   * 这样：
   *  - 用户从未手动排序时，等同于原来的 createTime desc（最新名片在最上）
   *  - 一旦手动拖拽，所有已加载卡片获得显式 order，保持手动顺序
   *  - 之后新建的名片（无 order）自然追加到末尾
   */
  _sortCards(cards) {
    if (!cards || !cards.length) return cards || []
    const arr = cards.slice()
    arr.sort((a, b) => {
      const oa = (typeof a.order === 'number') ? a.order : Infinity
      const ob = (typeof b.order === 'number') ? b.order : Infinity
      if (oa !== ob) return oa - ob
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0
      return tb - ta
    })
    return arr
  },

  /**
   * 拖拽排序 —— 句柄 touchstart
   * 记录起点索引与手指 Y，并测量卡片实际高度（用于计算跨过几张卡）
   */
  onCardTouchStart(e) {
    if (e.touches.length !== 1) return
    const index = parseInt(e.currentTarget.dataset.index)
    if (isNaN(index) || index < 0 || index >= this.data.cards.length) return

    const that = this
    wx.createSelectorQuery().in(this).select('.card-item').boundingClientRect(function (rect) {
      if (rect && rect.height) that._cardItemH = rect.height
    }).exec()

    this.setData({
      dragStartIndex: index,
      dragStartY: e.touches[0].clientY,
      isDragging: true
    })
  },

  /**
   * 拖拽中 —— 仅让被拖卡片跟手（translateY），列表在松手时一次性重排，
   * 避免在 move 中频繁 splice 引起的抖动。句柄用 catchtouchmove 不冒泡，
   * 不会触发卡片内其他按钮。
   */
  onCardTouchMove(e) {
    if (this.data.dragStartIndex === -1 || !this.data.isDragging) return
    if (e.touches.length !== 1) return
    const deltaY = e.touches[0].clientY - this.data.dragStartY
    const idx = this.data.dragStartIndex
    this.setData({
      ['cards[' + idx + ']._dragOffset']: deltaY
    })
  },

  /**
   * 松手 —— 依据累计位移计算目标位置，splice 重排后回写 order:0..n-1，再批量持久化
   */
  onCardTouchEnd(e) {
    if (this.data.dragStartIndex === -1) return
    const startIndex = this.data.dragStartIndex
    const cards = this.data.cards.slice()
    const step = this._cardItemH || 300
    const endY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : this.data.dragStartY
    const deltaY = endY - this.data.dragStartY

    let moveIndex = startIndex + Math.round(deltaY / step)
    moveIndex = Math.max(0, Math.min(cards.length - 1, moveIndex))

    if (moveIndex !== startIndex) {
      const [dragged] = cards.splice(startIndex, 1)
      delete dragged._dragOffset
      delete dragged._dragging
      cards.splice(moveIndex, 0, dragged)
    } else {
      delete cards[startIndex]._dragOffset
      delete cards[startIndex]._dragging
    }

    // 清掉所有拖拽瞬态字段，并写入显式顺序
    cards.forEach((c, i) => {
      delete c._dragOffset
      delete c._dragging
      c.order = i
    })

    this.setData({
      cards,
      dragStartIndex: -1,
      dragStartY: 0,
      isDragging: false
    })

    this._persistCardOrder(cards)
  },

  /**
   * 批量持久化顺序：每张卡直连 update order（仅写 order，保留其余字段）。
   * 首页只展示自己的卡，集合权限「仅创建者可读写」保证只有本人能改自己的卡。
   */
  _persistCardOrder(cards) {
    if (!wx.cloud) return
    const db = wx.cloud.database()
    const updates = cards.map(function (c) {
      return db.collection('cards').doc(c._id).update({ data: { order: c.order } })
    })
    Promise.all(updates).then(function () {
      console.log('[Index] 名片顺序已持久化，共', cards.length, '张')
    }).catch(function (err) {
      console.warn('[Index] 名片顺序持久化失败:', err)
    })
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
    console.log('[Share] onShareButtonTap, id:', id, 'hasShareImage:', !!card.shareImageUrl)
    this._activeShare = { id: id, card: card }
    this.setData({ shareCardId: id, shareCardData: card })
  },

  stopPropagation() {
    // 阻止事件冒泡
  },

  initShareMenu() {
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline'],
      success: () => console.log('[Index] 分享菜单初始化成功'),
      fail: (err) => console.warn('[Index] 分享菜单初始化失败:', err)
    })
  },

  /**
   * 解析分享图片 URL（cloud:// / https:// / 空）— 纯同步，不返回 Promise
   * 微信基础库 2.8.1+ 原生支持 cloud:// 作为 imageUrl
   * 用作 onShareAppMessage 的同步降级路径
   */
  _resolveAvatarUrl(avatar) {
    if (!avatar) return ''
    if (avatar.indexOf('cloud://') === 0) return avatar
    if (avatar.indexOf('https://') === 0) return avatar
    return ''
  },

  /**
   * onShareAppMessage — 微信分享入口
   *
   * 【关键约束】
   * - 基础库 < 2.12.0 不支持返回 Promise，必须同步 return
   * - 基础库 ≥ 2.12.0 支持 return Promise，但同步返回更可靠
   * - 策略：优先同步路径（预存图 / 头像降级），仅实时 Canvas 生成走异步
   *
   * options 参数（基础库 2.12.0+）：
   *   options.from === 'button' → open-type="share" 按钮触发
   *   options.target.dataset.id → data-id="{{item._id}}" 值
   */
  onShareAppMessage(options) {
    var id, card, path, title
    var self = this

    try {

    // ================================================================
    // 1. 解析卡片 ID（四级优先级，确保任意版本都能拿到）
    // ================================================================
    // (a) options.target.dataset — 基础库 2.12.0+
    if (options && options.from === 'button' && options.target && options.target.dataset) {
      id = options.target.dataset.id
    }
    // (b) bindtap → onShareButtonTap 预设的 _activeShare
    if (!id) {
      var active = self._activeShare || {}
      id = active.id || ''
    }
    // (c) this.data.shareCardId（setData 同步写入）
    if (!id) {
      id = self.data.shareCardId || ''
    }

    // ================================================================
    // 2. 根据 ID 查找完整卡片数据
    // ================================================================
    if (id && self.data.cards && self.data.cards.length > 0) {
      card = self.data.cards.find(function (c) { return c._id === id })
    }
    if (!card || !card.name) {
      card = (self._activeShare && self._activeShare.card) || self.data.shareCardData || {}
    }

    // ================================================================
    // 3. 构建分享参数
    // ================================================================
    path = id ? '/pages/preview/index?id=' + id + '&source=share' : '/pages/index/index'
    title = shareUtil.buildShareTitle(card)

    console.log('[Share] onShareAppMessage',
      'from:', options && options.from,
      'id:', id,
      'hasName:', !!(card && card.name),
      'hasShareImage:', !!(card && card.shareImageUrl),
      'shareImageUrl:', (card && card.shareImageUrl) ? (card.shareImageUrl.substring(0, 80) + '...') : '(empty)',
      'title:', title,
      'path:', path,
      'cardsCount:', self.data.cards.length,
      'shareCardId:', self.data.shareCardId
    )

    // 清理共享状态
    self._activeShare = null

    // ================================================================
    // 4. 分享图获取（同步优先，异步兜底）
    // ================================================================

    // 4a. 已有预存分享图 → 同步返回 ✅
    if (card.shareImageUrl) {
      var imageUrl = card.shareImageUrl
      // cloud:// → HTTPS 转换
      if (imageUrl.indexOf('cloud://') === 0) {
        imageUrl = storage.resolveCloudUrl(imageUrl) + '?ts=' + Date.now()
      }
      console.log('[Share] 4a 返回, finalUrl:', imageUrl)
      return { title: title, path: path, imageUrl: imageUrl }
    }

    // 4b. 无预存但有有效名片 → 同步返回头像，后台异步 Canvas 生成
    if (card && card.name && id) {
      var fallbackUrl = self._resolveAvatarUrl(card.avatar)

      // 启动异步 Canvas 生成（fire-and-forget，不阻塞本次分享）
      try {
        var shareCard = require('../../utils/shareCard')
        shareCard.generate('shareCanvas', card, {
          cardKey: id,
          pageContext: self
        }).then(function (res) {
          var cloudPath = 'sharecards/card_' + id + '.jpg'
          wx.cloud.uploadFile({
            cloudPath: cloudPath,
            filePath: res.tempFilePath,
          success: function (uploadRes) {
            var cloudFileID = uploadRes.fileID
            // 存 HTTPS URL（跨设备可靠），而非 cloud://
            var shareUrl = storage.resolveCloudUrl(cloudFileID)
            console.log('[Share] 后台已生成分享图:', shareUrl)
            wx.cloud.database().collection('cards').doc(id).update({
              data: { shareImageUrl: shareUrl }
              }).then(function () {
                console.log('[Share] shareImageUrl 已回写，下次分享直接用')
              }).catch(function () {})
            },
            fail: function (err) {
              console.warn('[Share] 后台上传失败:', err)
            }
          })
        }).catch(function (err) {
          console.warn('[Share] 后台生成失败:', err && err.message)
        })
      } catch (e) {
        console.warn('[Share] require shareCard 失败:', e)
      }

      // 立即同步返回头像 URL（本次分享用头像，下次分享用 cloud:// 分享图）
      console.log('[Share] 路径 4b — 同步返回, fallbackUrl:', fallbackUrl)
      return { title: title, path: path, imageUrl: fallbackUrl }
    }

    // 4c. 无有效名片数据 → 同步返回
    console.log('[Share] 路径 4c — 无有效名片, title:', title)
    return { title: title, path: path, imageUrl: self._resolveAvatarUrl(card && card.avatar) }

    } catch (e) {
      console.error('[Share] onShareAppMessage 异常:', e)
      return { title: title || '名片', path: path || '/pages/index/index', imageUrl: '' }
    }
  },

  onShareTimeline() {
    var active = this._activeShare || {}
    var card = active.card || this.data.shareCardData || {}
    var id = active.id || this.data.shareCardId || ''
    var query = id ? 'id=' + id : ''

    // 用预存分享图优先
    if (card.shareImageUrl) {
      return { title: shareUtil.buildShareTitle(card), query: query, imageUrl: card.shareImageUrl }
    }
    // 无分享图时：朋友圈不支持 cloud:// 实时生成，直接不传 imageUrl
    return { title: shareUtil.buildShareTitle(card), query: query, imageUrl: '' }
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

  goToCardList() {
    console.log('[Index] 切换到名片夹')
    wx.switchTab({
      url: '/pages/list/index',
      fail: (err) => {
        console.error('[Index] 切换失败:', err)
        app.showError('切换失败')
      }
    })
  },

  /**
   * 拉取「我的团队」数量，显示在首页底部团队按钮（我的团队 · N）
   * 带 5 分钟缓存，避免每次 onShow 都打云函数
   */
  loadTeamCount() {
    if (!wx.cloud) return
    var that = this
    var cached = app.getCache('teamCountCache')
    if (cached && Date.now() - cached.t < 300000) {
      that.setData({ teamCount: cached.count || 0 })
      return
    }
    teamUtil.callTeamManager('getMyTeams').then(function (res) {
      if (res.success && res.data && res.data.teams) {
        var count = (res.data.teams || []).length
        that.setData({ teamCount: count })
        app.setCache('teamCountCache', { count: count, t: Date.now() })
      }
    }).catch(function () {
      // 静默失败，保留上一值
    })
  },

  goTeamList() {
    console.log('[Index] 切换到我的团队列表')
    wx.switchTab({
      url: '/pages/team/list',
      fail: (err) => {
        console.error('[Index] 切换失败:', err)
        app.showError('切换失败')
      }
    })
  },

  /**
   * 添加到桌面
   * - Android: 调用 wx.showAddToDesktop() 一键添加（能力由 wx.canIUse 判定，免手写版本号）
   * - iOS: 不支持 API，引导手动操作
   * - 开发者工具: 不支持，提示真机预览
   * - 低版本微信: 降级为文字引导
   */
  addToDesktop() {
    let platform = this._devicePlatform || ''
    if (!platform) {
      const di = wx.getDeviceInfo ? wx.getDeviceInfo() : {}
      platform = (di.platform || di.system || '').toLowerCase()
    }

    // 开发者工具 / 模拟器不支持该 API，避免误导为权限问题
    if (platform === 'devtools') {
      wx.showModal({
        title: '添加到桌面',
        content: '开发者工具暂不支持「添加到桌面」，请在真机预览中体验',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    // iOS 不支持 API
    if (platform.indexOf('ios') >= 0) {
      wx.showModal({
        title: '添加到桌面',
        content: 'iOS 暂不支持一键添加。请点击右上角「...」→「添加到桌面」，或经 Safari「添加到主屏幕」',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    // 用官方能力判定替代手写版本比较（canIUse 始终与实际 API 对齐）
    if (typeof wx.canIUse === 'function' && !wx.canIUse('showAddToDesktop')) {
      wx.showModal({
        title: '添加到桌面',
        content: '当前微信版本较低，请点击右上角「...」→「添加到桌面」',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    // Android: 调用官方 API
    wx.showAddToDesktop({
      success: () => {
        wx.showToast({ title: '已发起添加，请按提示完成', icon: 'none', duration: 2500 })
      },
      fail: (err) => {
        console.warn('[Index] 添加桌面失败:', err)
        const errMsg = (err && err.errMsg) || ''
        if (errMsg.indexOf('cancel') >= 0 || errMsg.indexOf('canceled') >= 0) {
          // 用户取消，不提示
          return
        }
        wx.showModal({
          title: '添加失败',
          content: '请确认微信「桌面快捷方式」权限已开启（设置→应用→微信→权限），且小程序已正式上线',
          showCancel: false,
          confirmText: '知道了'
        })
      }
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
  }
})
