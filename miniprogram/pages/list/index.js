Page({
  data: {
    cards: []
  },

  onLoad() {
    this.loadCards()
  },

  onShow() {
    this.loadCards()
  },

  loadCards() {
    wx.cloud.database().collection('cards')
      .get()
      .then(res => {
        this.setData({
          cards: res.data
        })
      })
      .catch(err => {
        console.error('获取名片失败:', err)
        wx.showToast({
          title: '获取失败',
          icon: 'none'
        })
      })
  },

  goToEdit(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/edit/index${id ? '?id=' + id : ''}`
    })
  }
})