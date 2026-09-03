Component({
  data: {
    selected: 0
  },
  methods: {
    onIconError(e) {
      console.error('[TAB ICON ERROR] 加载失败:', e.currentTarget.dataset.name, e.detail)
    },
    switchTab(e) {
      const path = e.currentTarget.dataset.path
      wx.switchTab({ url: path })
    },
    onPlusTap() {
      wx.showActionSheet({
        itemList: ['创建名片', '创建团队', '加入团队'],
        success: (res) => {
          if (res.tapIndex === 0) {
            wx.navigateTo({ url: '/pages/edit/index' })
          } else if (res.tapIndex === 1) {
            wx.navigateTo({ url: '/pages/team/create' })
          } else if (res.tapIndex === 2) {
            wx.navigateTo({ url: '/pages/team/join' })
          }
        }
      })
    }
  }
})
