const app = getApp()

Page({
  data: {
    ocrResult: null
  },

  onLoad() {
    console.log('[Scan] onLoad')
  },

  onShow() {
    console.log('[Scan] onShow')
  },

  chooseImage() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album']
        this.pickImage(sourceType)
      }
    })
  },

  pickImage(sourceType) {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType,
      success: (res) => {
        console.log('[Scan] 选择图片成功')
        wx.showToast({ title: '识别功能需要云开发', icon: 'none' })
      },
      fail: () => {}
    })
  },

  goToCardList() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
