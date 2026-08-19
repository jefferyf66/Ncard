const app = getApp()

Page({
  data: {
    userInfo: null,
    openid: '',
    openidMask: '',
    version: '',
    cardCount: 0,
    currentTheme: '#3B82F6',
    defaultCardName: '',
    showThemePicker: false,
    showCardPicker: false,
    selectedCardId: '',
    cardList: [],
    visitorCount: 0,
    themeList: [
      { id: 1, name: '品牌蓝', color: '#3B82F6' },
      { id: 2, name: '活力橙', color: '#FF6A00' },
      { id: 3, name: '清新绿', color: '#00B42A' },
      { id: 4, name: '玫瑰红', color: '#F53F3F' },
      { id: 5, name: '香槟金', color: '#D9A94C' },
      { id: 6, name: '神秘紫', color: '#722ED1' }
    ]
  },

  onLoad() {
    console.log('[Profile] onLoad')
  },

  onShow() {
    console.log('[Profile] onShow')
    this.loadUserData()
    // 首装竞态兜底：ensureUser 尚未回写 globalData.user 时，主动等一次再刷新（P2-1）
    if (!app.getUser()) {
      app.ensureUser().then(() => this.loadUserData())
    }
    this._loadSettings()
  },

  loadUserData() {
    const user = app.getUser()
    const openid = (user && user._openid) || ''
    const openidMask = openid ? '..' + openid.slice(-6) : ''
    this.setData({
      userInfo: user,
      openid,
      openidMask,
      version: (app.globalData && app.globalData.version) || '1.1.4'
    })
  },

  /**
   * 从云端加载用户设置（主题色、默认名片）
   * 云端数据优先，本地 Storage 作为降级
   */
  _loadSettings() {
    if (!wx.cloud) return
    var that = this

    app.getOpenId().then(function (myOpenId) {
      if (!myOpenId) return

      var db = wx.cloud.database()

      // 并行查询：visitor_profiles(主题色) + cards(isDefault)
      var themePromise = db.collection('visitor_profiles')
        .where({ openid: myOpenId })
        .limit(1)
        .get()

      var defaultCardPromise = db.collection('cards')
        .where({ _openid: myOpenId, isDefault: true })
        .limit(1)
        .get()

      Promise.all([themePromise, defaultCardPromise]).then(function (results) {
        var themeRes = results[0]
        var defaultRes = results[1]

        // 主题色：云端 > 本地缓存 > 默认
        var cloudTheme = (themeRes.data && themeRes.data[0] && themeRes.data[0].themeColor) || ''
        var localTheme = ''
        try { localTheme = wx.getStorageSync('themeColor') } catch (e) {}
        var theme = cloudTheme || localTheme || '#3B82F6'

        // 默认名片
        var defaultCard = (defaultRes.data && defaultRes.data[0]) || null

        that.setData({
          currentTheme: theme,
          selectedCardId: defaultCard ? defaultCard._id : '',
          defaultCardName: defaultCard ? defaultCard.name : ''
        })

        // 同步本地缓存
        try { wx.setStorageSync('themeColor', theme) } catch (e) {}
      }).catch(function (err) {
        console.warn('[Profile] 加载设置失败，使用本地缓存:', err)
        // 降级：从本地缓存读取
        var localTheme = ''
        try { localTheme = wx.getStorageSync('themeColor') } catch (e) {}
        if (localTheme) {
          that.setData({ currentTheme: localTheme })
        }
      })
    })
  },

  goToCardList() {
    wx.navigateTo({ url: '/pages/list/index' })
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
    var version = (app.globalData && app.globalData.version) || '1.1.4'
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
    wx.navigateTo({ url: '/pages/team/list' })
  },

  showThemePicker() {
    this.setData({ showThemePicker: true })
  },

  closeThemePicker() {
    this.setData({ showThemePicker: false })
  },

  /**
   * 选择主题色：本地 + 云端双写
   */
  selectTheme(e) {
    var theme = e.currentTarget.dataset.theme
    this.setData({ currentTheme: theme, showThemePicker: false })

    // 本地持久化
    try { wx.setStorageSync('themeColor', theme) } catch (e) {}

    // 云端持久化：写入 visitor_profiles.themeColor
    this._syncThemeToCloud(theme)

    wx.showToast({ title: '主题已更新', icon: 'success' })
  },

  /**
   * 将主题色同步到 visitor_profiles 集合
   */
  _syncThemeToCloud(theme) {
    if (!wx.cloud) return
    var that = this

    app.getOpenId().then(function (myOpenId) {
      if (!myOpenId) return

      var db = wx.cloud.database()
      db.collection('visitor_profiles')
        .where({ openid: myOpenId })
        .limit(1)
        .get()
        .then(function (res) {
          if (res.data && res.data.length > 0) {
            return db.collection('visitor_profiles')
              .doc(res.data[0]._id)
              .update({ data: { themeColor: theme, updatedAt: new Date() } })
          } else {
            // visitor_profiles 不存在时创建
            return db.collection('visitor_profiles').add({
              data: {
                openid: myOpenId,
                nickname: '',
                avatarUrl: '',
                themeColor: theme,
                createdAt: new Date(),
                updatedAt: new Date()
              }
            })
          }
        })
        .then(function () {
          console.log('[Profile] 主题色已同步到云端')
        })
        .catch(function (err) {
          console.warn('[Profile] 主题色云端同步失败:', err)
        })
    })
  },

  showDefaultCardPicker() {
    this.setData({ showCardPicker: true })
    this.loadCardList()
  },

  closeCardPicker() {
    this.setData({ showCardPicker: false })
  },

  /**
   * 加载自己的名片列表（显式 _openid 过滤）
   */
  loadCardList() {
    if (!wx.cloud) return
    var that = this

    app.getOpenId().then(function (myOpenId) {
      if (!myOpenId) return

      wx.cloud.database().collection('cards')
        .where({ _openid: myOpenId })
        .get()
        .then(function (res) {
          that.setData({ cardList: res.data || [] })
        })
        .catch(function () {})
    })
  },

  /**
   * 选择默认名片：云端持久化（cards 集合 isDefault 字段）
   */
  selectDefaultCard(e) {
    var that = this
    var cardId = e.currentTarget.dataset.id
    var cardName = e.currentTarget.dataset.name

    if (!cardId || !wx.cloud) return

    app.showLoading('设置中...')

    app.getOpenId().then(function (myOpenId) {
      if (!myOpenId) {
        app.hideLoading()
        return
      }

      var db = wx.cloud.database()

      // Step 1: 清除旧默认名片
      return db.collection('cards')
        .where({ _openid: myOpenId, isDefault: true })
        .get()
        .then(function (res) {
          var clearPromises = (res.data || []).map(function (doc) {
            return db.collection('cards').doc(doc._id).update({
              data: { isDefault: false }
            })
          })
          return Promise.all(clearPromises)
        })
        // Step 2: 设置新默认名片
        .then(function () {
          return db.collection('cards').doc(cardId).update({
            data: { isDefault: true }
          })
        })
    }).then(function () {
      app.hideLoading()
      that.setData({ selectedCardId: cardId, defaultCardName: cardName })
      // 本地缓存也同步
      try { wx.setStorageSync('defaultCardId', cardId) } catch (e) {}
      try { wx.setStorageSync('defaultCardName', cardName) } catch (e) {}
      wx.showToast({ title: '已设置默认名片', icon: 'success' })
      setTimeout(function () { that.setData({ showCardPicker: false }) }, 800)
    }).catch(function (err) {
      app.hideLoading()
      console.error('[Profile] 设置默认名片失败:', err)
      wx.showToast({ title: '设置失败，请重试', icon: 'none' })
    })
  },

  /**
   * 清除默认名片
   */
  clearDefaultCard() {
    var that = this

    if (!wx.cloud) {
      that.setData({ selectedCardId: '', defaultCardName: '' })
      return
    }

    var currentId = this.data.selectedCardId
    if (!currentId) {
      that.setData({ selectedCardId: '', defaultCardName: '', showCardPicker: false })
      return
    }

    app.showLoading('清除中...')

    wx.cloud.database().collection('cards').doc(currentId).update({
      data: { isDefault: false }
    }).then(function () {
      app.hideLoading()
      that.setData({ selectedCardId: '', defaultCardName: '' })
      try { wx.removeStorageSync('defaultCardId') } catch (e) {}
      try { wx.removeStorageSync('defaultCardName') } catch (e) {}
      wx.showToast({ title: '已清除默认名片', icon: 'success' })
      setTimeout(function () { that.setData({ showCardPicker: false }) }, 800)
    }).catch(function (err) {
      app.hideLoading()
      console.error('[Profile] 清除默认名片失败:', err)
      wx.showToast({ title: '清除失败，请重试', icon: 'none' })
    })
  },

  stopPropagation() {}
})
