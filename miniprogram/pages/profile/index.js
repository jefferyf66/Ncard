const app = getApp()

Page({
  data: {
    userInfo: null,
    avatarUrl: '',
    openid: '',
    userRole: '',
    isAdmin: false,
    cardCount: 0,
    visitorCount: 0,
    version: ''
  },

  onLoad() {
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    this.loadUserData()
    // 首装竞态兜底：ensureUser 尚未回写 globalData.user 时，主动等一次再刷新（P2-1）
    if (!app.getUser()) {
      app.ensureUser().then(() => this.loadUserData())
    }
    this._loadStats()
  },

  loadUserData() {
    const user = app.getUser()
    const openid = (user && user._openid) || ''
    const role = (user && user.role) || 'user'
    this.setData({
      userInfo: user,
      openid: openid,
      userRole: role,
      isAdmin: role === 'root' || role === 'admin',
      version: (app.globalData && app.globalData.version) || '',
      avatarUrl: (user && user.avatarUrl) || ''
    })
  },

  /**
   * 指标卡取数（与业务页同口径）
   * - 我的名片：cards 集合中我创建的名片数（首页"我的名片"同源）
   * - 访客：initVisits 云函数 getMyVisitorStats（与访客页 stats.visitors 同口径）
   */
  _loadStats() {
    if (!wx.cloud) return
    var that = this

    app.getOpenId().then(function (myOpenId) {
      if (!myOpenId) return

      // 我的名片数
      wx.cloud.database().collection('cards')
        .where({ _openid: myOpenId })
        .count()
        .then(function (res) {
          that.setData({ cardCount: (res && res.total) || 0 })
        })
        .catch(function () {})

      // 访客数（含多卡汇总，与访客页一致）
      wx.cloud.callFunction({
        name: 'initVisits',
        data: { action: 'getMyVisitorStats', data: { cardOwnerId: myOpenId } }
      }).then(function (res) {
        if (res.result && res.result.ok) {
          that.setData({ visitorCount: res.result.visitors || 0 })
        }
      }).catch(function () {})
    })
  },

  // 指标卡「我的名片」→ 首页（我的名片展示页）
  goToMyCards() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // 菜单「我的名片夹」→ 名片夹 tab（保存的名片）
  goToCardList() {
    wx.switchTab({ url: '/pages/list/index' })
  },

  clearCache() {
    wx.showModal({
      title: '确认清空',
      content: '确定要清空本地缓存吗？',
      success: (res) => {
        if (res.confirm) {
          try {
            wx.clearStorageSync()
            wx.showToast({ title: '缓存已清空', icon: 'success' })
          } catch (e) {
            wx.showToast({ title: '清空失败', icon: 'none' })
          }
        }
      }
    })
  },

  showAbout() {
    var version = (app.globalData && app.globalData.version) || ''
    wx.showModal({
      title: '关于投贴儿',
      content: '投贴儿 v' + version + '\n\n一款专业的电子名片管理工具\n\n© 2024-2026 投贴儿',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  goToVisitors() {
    wx.navigateTo({ url: '/pages/visitors/index' })
  },

  goToTeam() {
    wx.switchTab({ url: '/pages/team/list' })
  },

  goToAccount() {
    wx.navigateTo({ url: '/pages/account/index' })
  },

  goToAdmin() {
    const role = this.data.userRole
    if (role !== 'root' && role !== 'admin') {
      wx.showToast({ title: '无访问权限', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/admin/index' })
  }
})
