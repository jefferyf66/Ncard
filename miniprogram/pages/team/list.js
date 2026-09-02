const app = getApp()
const team = require('../../utils/team')

Page({
  data: {
    teamList: [],
    isLoading: true,
    isEmpty: false
  },

  onLoad() {
    // 团队页：先确保用户存在再首调（幂等、缓存 Promise）
    app.ensureUser().then(() => this.loadTeams())
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    // F21 修复：onLoad 已触发首次加载（ensureUser 后），首次 onShow 跳过，避免双重 loadTeams
    if (!this._shownOnce) {
      this._shownOnce = true
      return
    }
    // 返回页面时刷新（创建/加入后）
    if (app.getUser()) this.loadTeams()
  },

  loadTeams() {
    this.setData({ isLoading: true })
    team.callTeamManager('getMyTeams').then((res) => {
      if (res.success) {
        const teams = res.data.teams || []
        this.setData({
          teamList: teams,
          isLoading: false,
          isEmpty: teams.length === 0
        })
      } else {
        this.setData({ isLoading: false, isEmpty: true })
        team.showTeamError(res.error)
      }
    })
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/team/create' })
  },

  goJoin() {
    wx.navigateTo({ url: '/pages/team/join' })
  },

  goDetail(e) {
    const teamId = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/team/detail?teamId=' + teamId })
  },

  stopPropagation() {}
})
