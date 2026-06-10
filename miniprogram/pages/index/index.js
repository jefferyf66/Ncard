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

    // 1. 名片总数（cards 集合 — 始终存在）
    wx.cloud.database().collection('cards').count()
      .then(res => {
        this.setData({ 'visitorStats.newCards': res.total || 0 })
      })
      .catch(() => {})

    // 2. 访客统计 — 优先用云函数，失败则静默
    this._loadVisitorStats()
  },

  _loadVisitorStats() {
    // 尝试云函数方式获取访客统计
    wx.cloud.callFunction({
      name: 'initVisits',
      data: { action: 'getMyVisitorStats', data: { cardOwnerId: '' } }
    }).then(res => {
      if (res.result && res.result.ok) {
        this.setData({
          'visitorStats.visitors': res.result.visitors || 0,
          'visitorStats.viewed': res.result.viewed || 0
        })
        // 加载最近访客
        this._loadRecentVisitors()
      }
    }).catch(() => {
      // 云函数未部署 → 尝试直接查 visits 集合
      this._loadVisitorStatsDirect()
    })
  },

  _loadVisitorStatsDirect() {
    const db = wx.cloud.database()
    const _ = db.command

    // visits 集合可能不存在
    const handleError = () => {
      this.setData({
        'visitorStats.visitors': 0,
        'visitorStats.viewed': 0
      })
    }

    db.collection('visits').count()
      .then(res => {
        this.setData({ 'visitorStats.visitors': res.total || 0 })
        return db.collection('visits')
          .where({ visitCount: _.gt(1) })
          .count()
      })
      .then(res => {
        this.setData({ 'visitorStats.viewed': res.total || 0 })
        this._loadRecentVisitors()
      })
      .catch(handleError)
  },

  _loadRecentVisitors() {
    const db = wx.cloud.database()
    db.collection('visits')
      .orderBy('visitTime', 'desc')
      .limit(5)
      .get()
      .then(res => {
        if (!res.data || res.data.length === 0) return
        const visitors = res.data.map(v => ({
          id: v._id,
          name: v.visitorName || '微信用户',
          position: v.visitorPosition || '',
          actions: v.actions || [],
          lastVisit: app.formatTime(v.visitTime),
          buttonText: v.visitorName ? '交换名片' : '请问是谁',
          buttonType: v.visitorName ? 'primary' : 'secondary'
        }))
        this.setData({ recentVisitors: visitors })
      })
      .catch(() => {})
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

    const currentPage = isRefresh ? 0 : this.data.currentPage
    const collection = wx.cloud.database().collection('cards')
    const query = collection
      .orderBy('createTime', 'desc')
      .skip(currentPage * this.data.pageSize)
      .limit(this.data.pageSize)

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
  }
})
