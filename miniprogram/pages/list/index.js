Page({
  data: {
    cards: [],
    isLoading: true,
    isEmpty: false
  },

  onLoad() {
    this.loadCards()
  },

  onShow() {
    this.loadCards()
  },

  loadCards() {
    if (!wx.cloud) {
      this.setData({ isLoading: false, isEmpty: true })
      wx.showToast({ title: '云开发未初始化', icon: 'none' })
      return
    }

    this.setData({ isLoading: true })

    wx.cloud.database().collection('cards')
      .orderBy('createTime', 'desc')
      .get()
      .then(res => {
        this.setData({
          cards: res.data || [],
          isLoading: false,
          isEmpty: (res.data || []).length === 0
        })
      })
      .catch(err => {
        console.error('获取名片失败:', err)
        this.setData({ isLoading: false })
        wx.showToast({ title: '获取失败，请下拉刷新', icon: 'none' })
      })
  },

  goToEdit(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/edit/index${id ? '?id=' + id : ''}`
    })
  },

  goToPreview(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/preview/index?id=${id}`
    })
  },

  onPullDownRefresh() {
    this.loadCards()
    wx.stopPullDownRefresh()
  }
})