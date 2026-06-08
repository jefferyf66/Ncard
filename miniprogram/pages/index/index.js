const app = getApp()

Page({
  data: {
    cards: [],
    isLoading: false,
    isEmpty: true,
    isError: false
  },

  onLoad() {
    this.loadCards()
  },

  onShow() {
    this.loadCards()
  },

  onPullDownRefresh() {
    this.loadCards().then(() => wx.stopPullDownRefresh())
  },

  loadCards() {
    this.setData({ isLoading: true, isError: false })
    return new Promise((resolve) => {
      wx.cloud.database().collection("cards").limit(50).get()
        .then(res => {
          const cards = res.data || []
          this.setData({
            cards: cards,
            isLoading: false,
            isEmpty: cards.length === 0,
            isError: false,
            lastLoadTime: Date.now()
          })
          resolve()
        })
        .catch(err => {
          console.error("[Index] load failed", err)
          this.setData({ isLoading: false, isError: true, isEmpty: true })
          resolve()
        })
    })
  },

  goToEdit() {
    wx.navigateTo({ url: "/pages/edit/index" })
  },

  goToPreview(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: "/pages/preview/index?id=" + id })
  },

  goToVisitors() {
    wx.navigateTo({ url: "/pages/visitors/index" })
  },

  openPrivacyPolicy() {
    wx.navigateTo({ url: "/pages/agreement/index?type=privacy" })
  },

  openServiceAgreement() {
    wx.navigateTo({ url: "/pages/agreement/index?type=service" })
  }
})