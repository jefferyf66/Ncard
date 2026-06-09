const app = getApp()

Page({
  data: {
    stats: {
      visitors: 0,
      viewed: 0,
      newCards: 0
    },
    visitors: [],
    isLoading: false
  },

  onLoad() {
    this.loadVisitors()
  },

  onShow() {
    this.loadVisitors()
  },

  loadVisitors() {
    if (!wx.cloud) {
      this.setData({ isLoading: false })
      return
    }

    this.setData({ isLoading: true })
    const db = wx.cloud.database()

    // 加载统计
    db.collection('visits').count()
      .then(res => {
        this.setData({ 'stats.visitors': res.total || 0 })
      })
      .catch(err => {
        console.warn('[Visitors] 统计加载失败:', err)
      })

    // 加载访客列表
    db.collection('visits')
      .orderBy('visitTime', 'desc')
      .limit(50)
      .get()
      .then(res => {
        const visitors = (res.data || []).map(v => ({
          id: v._id,
          name: v.visitorName || '微信用户',
          phone: v.visitorPhone || '',
          position: v.visitorPosition || '',
          company: v.visitorCompany || '',
          avatar: v.visitorAvatar || '',
          visitCount: v.visitCount || 1,
          actions: v.actions || [],
          lastVisit: app.formatTime(v.visitTime),
          description: v.source ? `通过"${v.source}"查看了您` : '',
          buttonText: v.visitorName ? '交换名片' : '请问是谁',
          buttonType: v.visitorName ? 'primary' : 'secondary'
        }))
        this.setData({ visitors, isLoading: false })
      })
      .catch(err => {
        console.warn('[Visitors] 访客列表加载失败:', err)
        this.setData({ isLoading: false })
      })
  },

  goToViewAll() {
    wx.showToast({ title: '查看全部', icon: 'none' })
  },

  handleAction(e) {
    const item = e.currentTarget.dataset.item
    const buttonText = item.buttonText
    
    if (buttonText === '交换名片') {
      wx.showToast({ title: '已发送交换请求', icon: 'success' })
    } else if (buttonText === '请问是谁') {
      wx.showToast({ title: '已发送询问', icon: 'none' })
    }
  },

  goToProfile(e) {
    const item = e.currentTarget.dataset.item
    wx.showToast({ title: `查看 ${item.name} 的名片`, icon: 'none' })
  }
})
