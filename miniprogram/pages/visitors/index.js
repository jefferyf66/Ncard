const app = getApp()

Page({
  data: {
    stats: {
      visitors: 0,
      viewed: 0,
      newCards: 0
    },
    visitors: [],
    isLoading: true,
    isEmpty: false,
    isError: false,
    errorMsg: ''
  },

  onLoad() {
    this.loadVisitors()
  },

  onShow() {
    // onShow 不再重复加载，避免 onLoad 加载成功后立刻再加载
    // 仅在没有数据时重新加载
    if (this.data.isEmpty && !this.data.isLoading) {
      this.loadVisitors()
    }
  },

  loadVisitors() {
    if (!wx.cloud) {
      this.setData({
        isLoading: false,
        isError: true,
        errorMsg: '微信版本过低，不支持云开发'
      })
      return
    }

    this.setData({ isLoading: true, isError: false })

    // 1. 先加载卡片总数（始终可用）
    wx.cloud.database().collection('cards').count()
      .then(res => {
        this.setData({ 'stats.newCards': res.total || 0 })
      })
      .catch(() => {})

    // 2. 尝试通过云函数加载访客数据
    wx.cloud.callFunction({
      name: 'initVisits',
      data: { action: 'getRecentVisitors', data: { cardOwnerId: '', limit: 50 } }
    }).then(res => {
      if (res.result && res.result.ok) {
        const list = res.result.list || []
        const visitors = list.map(v => ({
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

        // 统计
        const repeatCount = visitors.filter(v => v.visitCount > 1).length

        this.setData({
          visitors,
          'stats.visitors': visitors.length,
          'stats.viewed': repeatCount,
          isLoading: false,
          isEmpty: visitors.length === 0
        })
      } else {
        // 云函数返回失败，尝试直接查库
        this._loadVisitorsDirect()
      }
    }).catch(() => {
      // 云函数未部署 → 尝试直接查库
      this._loadVisitorsDirect()
    })
  },

  _loadVisitorsDirect() {
    const db = wx.cloud.database()
    const _ = db.command

    // 统计：访客总数
    db.collection('visits').count()
      .then(res => {
        this.setData({ 'stats.visitors': res.total || 0 })
        // 多次来访
        return db.collection('visits')
          .where({ visitCount: _.gt(1) })
          .count()
      })
      .then(res => {
        this.setData({ 'stats.viewed': res.total || 0 })
        // 加载列表
        return db.collection('visits')
          .orderBy('visitTime', 'desc')
          .limit(50)
          .get()
      })
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
        this.setData({
          visitors,
          isLoading: false,
          isEmpty: visitors.length === 0
        })
      })
      .catch(err => {
        console.warn('[Visitors] visits 集合不存在或查询失败:', err)
        // visits 集合不存在 → 显示空状态
        this.setData({
          visitors: [],
          'stats.visitors': 0,
          'stats.viewed': 0,
          isLoading: false,
          isEmpty: true
        })
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
