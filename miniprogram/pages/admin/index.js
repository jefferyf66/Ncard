const app = getApp()

Page({
  data: {
    role: 'user',
    hasAccess: false,
    stats: { total: 0, active7: 0, zombie30: 0, deleted: 0 },
    users: [],
    teams: [],
    loading: false,
    // 转让 root
    showTransfer: false,
    transferOpenid: ''
  },

  onShow() {
    const user = app.getUser()
    const role = (user && user.role) || 'user'
    this.setData({ role, hasAccess: role === 'root' || role === 'admin' })
    if (this.data.hasAccess) this.loadAll()
  },

  loadAll() {
    this.loadStats()
    this.loadUsers(0)
    this.loadTeams()
  },

  loadStats() {
    const that = this
    if (!wx.cloud) return
    wx.cloud.callFunction({
      name: 'adminManager',
      data: { action: 'getUserStats' },
      success: (res) => {
        if (res.result && res.result.success) that.setData({ stats: res.result.data })
      },
      fail: () => {}
    })
  },

  loadUsers(page) {
    const that = this
    if (!wx.cloud) return
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'adminManager',
      data: { action: 'listUsers', page: page || 0, pageSize: 20 },
      success: (res) => {
        that.setData({ loading: false })
        if (res.result && res.result.success) {
          that.setData({ users: res.result.data.list, page: res.result.data.page })
        }
      },
      fail: () => { that.setData({ loading: false }) }
    })
  },

  loadTeams() {
    const that = this
    if (!wx.cloud) return
    wx.cloud.callFunction({
      name: 'adminManager',
      data: { action: 'listTeams' },
      success: (res) => {
        if (res.result && res.result.success) that.setData({ teams: res.result.data.list })
      },
      fail: () => {}
    })
  },

  openTransfer() {
    if (this.data.role !== 'root') { wx.showToast({ title: '仅 root 可转让', icon: 'none' }); return }
    this.setData({ showTransfer: true, transferOpenid: '' })
  },
  closeTransfer() { this.setData({ showTransfer: false }) },
  onTransferInput(e) { this.setData({ transferOpenid: e.detail.value }) },

  confirmTransfer() {
    const that = this
    const openid = this.data.transferOpenid.trim()
    if (!openid) { wx.showToast({ title: '请输入目标用户 openid', icon: 'none' }); return }
    wx.showModal({
      title: '确认转让 root',
      content: '转让后您将降级为 admin，且无法再改角色 / 转 root。',
      success: (r) => {
        if (!r.confirm) return
        app.showLoading('处理中...')
        wx.cloud.callFunction({
          name: 'adminManager',
          data: { action: 'transferRoot', openid },
          success: (res) => {
            app.hideLoading()
            that.setData({ showTransfer: false })
            if (res.result && res.result.success) {
              wx.showToast({ title: '已转让', icon: 'success' })
              that.setData({ role: 'admin' })
              if (app.globalData.user) app.globalData.user.role = 'admin'
            } else {
              wx.showToast({ title: (res.result && res.result.error) || '失败', icon: 'none' })
            }
          },
          fail: () => { app.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
        })
      }
    })
  },

  disbandTeam(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const that = this
    wx.showModal({
      title: '解散团队',
      content: '确认解散「' + name + '」？成员与邀请将被清除。',
      success: (r) => {
        if (!r.confirm) return
        app.showLoading('处理中...')
        wx.cloud.callFunction({
          name: 'adminManager',
          data: { action: 'disbandTeam', teamId: id },
          success: (res) => {
            app.hideLoading()
            if (res.result && res.result.success) {
              wx.showToast({ title: '已解散', icon: 'success' })
              that.loadTeams()
            } else {
              wx.showToast({ title: (res.result && res.result.error) || '失败', icon: 'none' })
            }
          },
          fail: () => { app.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
        })
      }
    })
  },

  stopProp() {},
  goBack() { wx.navigateBack() }
})
