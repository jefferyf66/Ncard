const app = getApp()

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
    showPrivacyPopup: false,
    visitorStats: {
      visitors: 0,
      viewed: 0,
      newCards: 0
    },
    recentVisitors: []
  },

  onLoad() {
    console.log('[Index] onLoad')
    this.checkPrivacySetting()
  },

  checkPrivacySetting() {
    if (wx.getPrivacySetting) {
      wx.getPrivacySetting({
        success: (res) => {
          console.log('[Index] 隐私授权状态:', res.needAuthorization)
          if (res.needAuthorization) {
            this.setData({ showPrivacyPopup: true })
          } else {
            this.loadCards(true)
          }
        },
        fail: () => {
          // 接口不可用时直接加载
          this.loadCards(true)
        }
      })
    } else {
      this.loadCards(true)
    }
  },

  handlePrivacyAgree() {
    console.log('[Index] 用户同意隐私协议')
    this.setData({ showPrivacyPopup: false })
    this.loadCards(true)
  },

  handlePrivacyDecline() {
    console.log('[Index] 用户拒绝隐私协议')
    this.setData({ showPrivacyPopup: false })
    wx.showModal({
      title: '提示',
      content: '您需要同意隐私政策才能使用科博名片服务',
      showCancel: false,
      confirmText: '我知道了'
    })
  },

  openPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/agreement/index?tab=privacy' })
  },

  openServiceAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index?tab=service' })
  },

  preventTouchMove() {
    // 阻止弹窗背后的页面滚动
  },

  onShow() {
    console.log('[Index] onShow')
    const lastUpdate = app.getCache('lastCardUpdate')
    const now = Date.now()
    
    if (!lastUpdate || now - lastUpdate > 300000) {
      this.loadCards(true)
    }
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
        // 无法获取 openId → 降级为不过滤
        this._loadVisitorStatsDirect()
        return
      }
      this._myOpenId = this._myOpenId || myOpenId

      // 尝试云函数方式获取访客统计（传入 cardOwnerId）
      wx.cloud.callFunction({
        name: 'initVisits',
        data: { action: 'getMyVisitorStats', data: { cardOwnerId: myOpenId } }
      }).then(res => {
        if (res.result && res.result.ok) {
          this.setData({
            'visitorStats.visitors': res.result.visitors || 0,
            'visitorStats.viewed': res.result.viewed || 0
          })
          // 加载最近访客（也按 cardOwnerId 过滤）
          this._loadRecentVisitors(myOpenId)
        }
      }).catch(() => {
        // 云函数未部署 → 尝试直接查 visits 集合
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

    // visits 集合可能不存在
    var handleError = function () {
      that.setData({
        'visitorStats.visitors': 0,
        'visitorStats.viewed': 0
      })
    }

    // 构建过滤条件：按 cardOwnerId 过滤（修复 P1：之前全量 count 无过滤）
    var baseWhere = myOpenId ? { cardOwnerId: myOpenId } : {}
    var query = db.collection('visits')
    if (myOpenId) query = query.where(baseWhere)

    query.count()
      .then(function (res) {
        that.setData({ 'visitorStats.visitors': res.total || 0 })
        // 多次来访（回访访客数）
        var repeatWhere = myOpenId
          ? { cardOwnerId: myOpenId, visitCount: _.gt(1) }
          : { visitCount: _.gt(1) }
        return db.collection('visits').where(repeatWhere).count()
      })
      .then(function (res) {
        that.setData({ 'visitorStats.viewed': res.total || 0 })
        that._loadRecentVisitors(myOpenId || undefined)
      })
      .catch(handleError)
  },

  /**
   * 加载最近访客并聚合去重（客户端聚合：按 visitorOpenId 归并）
   * 展示结构：L3 卡片用户 → 真名+头像 / L2 已授权 → 昵称+头像 / L1 匿名 → "访客 #XXXX"
   */
  _loadRecentVisitors(cardOwnerId) {
    var db = wx.cloud.database()
    var that = this
    var query = db.collection('visits')
    if (cardOwnerId) {
      query = query.where({ cardOwnerId: cardOwnerId })
    }
    // 取 20 条用于客户端聚合（云开发基础版无 aggregate 管道）
    query
      .orderBy('visitTime', 'desc')
      .limit(20)
      .get()
      .then(function (res) {
        if (!res.data || res.data.length === 0) return

        var rawVisits = res.data
        // 客户端聚合：同一 visitorOpenId 合并为一条，保留最近访问时间
        var merged = that._aggregateVisitors(rawVisits)

        // 取前 5 展示在首页
        var top5 = merged.slice(0, 5)

        // 转换为展示数据（三层匿名级别）
        var visitors = top5.map(function (v) {
          return that._formatVisitorItem(v)
        })

        that.setData({ recentVisitors: visitors })
      })
      .catch(function () {})
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

  stopPropagation() {
    // 阻止事件冒泡
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

  handleVisitorAction(e) {
    const item = e.currentTarget.dataset.item
    const buttonText = item.buttonText

    if (buttonText === '交换名片') {
      wx.showToast({ title: '已发送交换请求', icon: 'success' })
    } else if (buttonText === '请问是谁') {
      wx.showToast({ title: '已发送询问', icon: 'none' })
    }
  },

  addToDesktop() {
    if (wx.addFavorite) {
      wx.addFavorite({
        title: '科博名片',
        imgUrl: '',
        success: () => {
          app.showSuccess('已添加收藏')
        },
        fail: () => {
          wx.showModal({
            title: '添加到桌面',
            content: '请点击右上角 "..." 按钮，选择"添加到桌面"即可将科博名片添加到手机桌面',
            showCancel: false,
            confirmText: '我知道了'
          })
        }
      })
    } else {
      wx.showModal({
        title: '添加到桌面',
        content: '请点击右上角 "..." 按钮，选择"添加到桌面"即可将科博名片添加到手机桌面',
        showCancel: false,
        confirmText: '我知道了'
      })
    }
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
