const app = getApp()
var shareUtil = require('../../utils/share')
var cardStyle = require('../../config/cardStyle')
var storage = require('../../config/storage')

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
    }
    // 分享卡片缓存自带版本号机制，卡片数据变化自动失效，无需手动清除
    this.loadVisitorData()
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
   * 添加到桌面
   * - Android: 调用 wx.showAddToDesktop() 一键添加（基础库 ≥ 2.10.3）
   * - iOS: 不支持 API，引导手动操作
   * - 低版本微信: 降级为文字引导
   */
  addToDesktop() {
    var self = this
    var deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : {}
    var appBaseInfo = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {}
    var platform = (deviceInfo.platform || deviceInfo.system || '').toLowerCase()
    var sdkVersion = appBaseInfo.SDKVersion || '0.0.0'

    // iOS 不支持 API
    if (platform.indexOf('ios') >= 0) {
      wx.showModal({
        title: '添加到桌面',
        content: 'iOS 暂不支持一键添加。请点击右上角「...」→「分享」→「添加到主屏幕」',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    // 检查基础库版本
    if (self._compareVersion(sdkVersion, '2.10.3') < 0) {
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
      success: function () {
        wx.showToast({ title: '已发起添加，请按提示完成', icon: 'none', duration: 2500 })
      },
      fail: function (err) {
        console.warn('[Index] 添加桌面失败:', err)
        var errMsg = (err && err.errMsg) || ''
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
   * 版本号比较: 返回 1(v1>v2) / 0(相等) / -1(v1<v2)
   */
  _compareVersion(v1, v2) {
    var a = v1.split('.')
    var b = v2.split('.')
    var len = Math.max(a.length, b.length)
    for (var i = 0; i < len; i++) {
      var n1 = parseInt(a[i] || '0', 10)
      var n2 = parseInt(b[i] || '0', 10)
      if (n1 > n2) return 1
      if (n1 < n2) return -1
    }
    return 0
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
