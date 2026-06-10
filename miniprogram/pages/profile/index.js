const app = getApp()

Page({
  data: {
    userInfo: null,
    openid: '',
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
    // 暂不加载其他数据，避免超时
  },

  loadUserData() {
    const userInfo = app.globalData.userInfo
    const openid = app.globalData.openid
    this.setData({
      userInfo,
      openid
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
    wx.showModal({
      title: '关于科博名片',
      content: '科博名片 v1.0.0\n\n一款专业的电子名片管理工具\n\n© 2024 科博名片',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  getUserInfo() {
    wx.getUserInfo({
      desc: '用于展示用户信息',
      success: (res) => {
        app.globalData.userInfo = res.userInfo
        this.setData({ userInfo: res.userInfo })
      },
      fail: () => {
        wx.showToast({ title: '授权已取消', icon: 'none' })
      }
    })
  },

  goToVisitors() {
    wx.navigateTo({ url: '/pages/visitors/index' })
  },

  showThemePicker() {
    this.setData({ showThemePicker: true })
  },

  closeThemePicker() {
    this.setData({ showThemePicker: false })
  },

  selectTheme(e) {
    const theme = e.currentTarget.dataset.theme
    this.setData({ currentTheme: theme, showThemePicker: false })
    wx.setStorageSync('themeColor', theme)
    wx.showToast({ title: '主题已更新', icon: 'success' })
  },

  showDefaultCardPicker() {
    this.setData({ showCardPicker: true })
    this.loadCardList()
  },

  closeCardPicker() {
    this.setData({ showCardPicker: false })
  },

  loadCardList() {
    if (!wx.cloud) return
    wx.cloud.database().collection('cards')
      .get()
      .then(res => {
        this.setData({ cardList: res.data || [] })
      })
      .catch(() => {})
  },

  selectDefaultCard(e) {
    const { id, name } = e.currentTarget.dataset
    this.setData({ selectedCardId: id, defaultCardName: name })
    wx.showToast({ title: '已设置默认名片', icon: 'success' })
    setTimeout(() => this.setData({ showCardPicker: false }), 800)
  },

  clearDefaultCard() {
    this.setData({ selectedCardId: '', defaultCardName: '' })
    wx.showToast({ title: '已清除默认名片', icon: 'success' })
    setTimeout(() => this.setData({ showCardPicker: false }), 800)
  },

  stopPropagation() {}
})
