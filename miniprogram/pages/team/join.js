const app = getApp()
const team = require('../../utils/team')

Page({
  data: {
    code: '',
    teamId: '',
    token: '',
    prefillTeam: null, // 通过分享卡片预填的团队信息
    isJoining: false
  },

  onLoad(options) {
    const teamId = (options && options.teamId) || ''
    const token = (options && options.token) || ''
    this.setData({ teamId, token })
    app.ensureUser().then(() => {
      if (teamId && token) {
        this._loadPrefillTeam(teamId)
      }
    })
  },

  _loadPrefillTeam(teamId) {
    team.callTeamManager('getTeam', { teamId }).then((res) => {
      if (res.success) {
        this.setData({ prefillTeam: res.data.team })
      }
    })
  },

  onCodeInput(e) {
    // 邀请码统一转大写，去除空格
    this.setData({ code: e.detail.value.replace(/\s/g, '').toUpperCase() })
  },

  join() {
    if (this.data.isJoining) return
    const token = this.data.token
    const code = this.data.code
    if (!token && !code) {
      app.showError('请输入邀请码')
      return
    }
    this.setData({ isJoining: true })
    app.showLoading('加入中...')
    const payload = token ? { token } : { code }
    team.callTeamManager('joinByInvite', payload).then((res) => {
      app.hideLoading()
      this.setData({ isJoining: false })
      if (res.success) {
        app.showSuccess('加入成功')
        const target = res.data.teamId || this.data.teamId
        wx.redirectTo({ url: '/pages/team/detail?teamId=' + target })
      } else {
        if (res.error === 'NO_CARD') {
          wx.showModal({
            title: '需要先创建名片',
            content: '加入团队需要一张个人名片，是否现在创建？',
            confirmText: '去创建',
            success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/edit/index' }) }
          })
          return
        }
        team.showTeamError(res.error)
      }
    })
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/edit/index' })
  },

  stopPropagation() {}
})
