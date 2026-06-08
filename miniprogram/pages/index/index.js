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
          console.log('[Index] 隐私授权状�?', res.needAuthorization)
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
      content: '您需要同意隐私政策才能使用科博名片服�?,
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
    // 阻止弹窗背后的页面滚�?  },

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

    const db = wx.cloud.database()

    // 加载访客统计
    db.collection('visits').count()
      .then(res => {
        this.setData({ 'visitorStats.visitors': res.total || 0 })
      })
      .catch(() => {})

    // 加载最近访�?    db.collection('visits')
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
        errorMsg: '微信版本过低，不支持云开�?,
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
      console.warn('[Index] 加载超时，尝试使用缓�?)
      this.tryLoadCache()
      if (callback) callback()
    }, 10000)

    query.get()
      .then(res => {
        clearTimeout(timer)
        console.log('[Index] 获取成功，数�?', res.data.length)

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

  goToVisitorDetail(e) {
    const item = e.currentTarget.dataset.item
    console.log('[Index] 查看访客详情:', item.name)
    wx.showToast({ title: `查看 ${item.name} 的信息`, icon: 'none' })
  },

  handleVisitorAction(e) {
    const item = e.currentTarget.dataset.item
    const buttonText = item.buttonText

    if (buttonText === '交换名片') {
      wx.showToast({ title: '已发送交换请�?, icon: 'success' })
    } else if (buttonText === '请问是谁') {
      wx.showToast({ title: '已发送询�?, icon: 'none' })
    }
  },

  addToDesktop() {
    if (wx.addFavorite) {
      wx.addFavorite({
        title: '科博名片',
        imgUrl: '',
        success: () => {
          app.showSuccess('已添加收�?)
        },
        fail: () => {
          wx.showModal({
            title: '添加到桌�?,
            content: '请点击右上角 "..." 按钮，选择"添加到桌�?即可将科博名片添加到手机桌面',
            showCancel: false,
            confirmText: '我知道了'
          })
        }
      })
    } else {
      wx.showModal({
        title: '添加到桌�?,
        content: '请点击右上角 "..." 按钮，选择"添加到桌�?即可将科博名片添加到手机桌面',
        showCancel: false,
        confirmText: '我知道了'
      })
    }
  }
})
