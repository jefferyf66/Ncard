const app = getApp()

Page({
  data: {
    card: {},
    id: ''
  },

  onLoad(options) {
    console.log('[Detail] onLoad:', options)
    if (options && options.id) {
      this.setData({ id: options.id })
      this.loadCard(options.id)
    }
  },

  loadCard(id) {
    if (!id || !wx.cloud) return
    wx.cloud.database().collection('cards').doc(id).get()
      .then(res => {
        if (res.data) {
          this.setData({ card: res.data })
        }
      })
      .catch(err => console.warn('[Detail] loadCard error:', err))
  },

  goToEdit() {
    if (this.data.id) {
      wx.navigateTo({ url: `/pages/edit/index?id=${this.data.id}` })
    }
  },

  deleteCard() {
    if (!this.data.id) return
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除吗？',
      success: (res) => {
        if (res.confirm) {
          wx.cloud.database().collection('cards').doc(this.data.id).remove()
            .then(() => {
              wx.showToast({ title: '删除成功', icon: 'success' })
              setTimeout(() => wx.navigateBack(), 1500)
            })
            .catch(() => wx.showToast({ title: '删除失败', icon: 'none' }))
        }
      }
    })
  }
})
