const app = getApp()
const team = require('../../utils/team')

Page({
  data: {
    name: '',
    description: '',
    errors: {},
    isSubmitting: false,
    // L2 实时软提示
    similarTeams: [],
    showSimilar: false,
    searchTimer: null
  },

  onLoad() {
    app.ensureUser().then(() => {})
  },

  onUnload() {
    if (this.data.searchTimer) {
      clearTimeout(this.data.searchTimer)
      this.data.searchTimer = null
    }
  },

  onNameInput(e) {
    const name = e.detail.value.trim()
    this.setData({ name })
    this.clearError('name')
    this._runDebouncedSearch(name)
  },

  // 防抖 300ms → searchTeam exact 软提示（L2）
  _runDebouncedSearch(name) {
    if (this.data.searchTimer) clearTimeout(this.data.searchTimer)
    if (!name) {
      this.setData({ similarTeams: [], showSimilar: false })
      return
    }
    const timer = setTimeout(() => {
      team.callTeamManager('searchTeam', { keyword: name, exact: true, limit: 5 }).then((res) => {
        if (res.success && res.data.teams && res.data.teams.length) {
          this.setData({ similarTeams: res.data.teams, showSimilar: true })
        } else {
          this.setData({ similarTeams: [], showSimilar: false })
        }
      })
    }, 300)
    this.setData({ searchTimer: timer })
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value.trim() })
  },

  clearError(field) {
    const errors = Object.assign({}, this.data.errors)
    delete errors[field]
    this.setData({ errors })
  },

  submit() {
    if (this.data.isSubmitting) return
    if (!this.data.name || !this.data.name.trim()) {
      this.setData({ errors: { name: '请输入团队名称' } })
      return
    }
    // L2 兜底：若已存在同名团队，二次确认
    if (this.data.showSimilar && this.data.similarTeams.length) {
      wx.showModal({
        title: '发现同名团队',
        content: '系统中已有名称相似的团队，确认仍要创建？',
        confirmText: '仍然创建',
        cancelText: '取消',
        success: (r) => { if (r.confirm) this._doCreate() }
      })
      return
    }
    this._doCreate()
  },

  _doCreate() {
    this.setData({ isSubmitting: true })
    app.showLoading('创建中...')
    team.callTeamManager('createTeam', {
      name: this.data.name.trim(),
      description: this.data.description
    }).then((res) => {
      app.hideLoading()
      this.setData({ isSubmitting: false })
      if (res.success) {
        const data = res.data || {}
        const goDetail = () => wx.redirectTo({ url: '/pages/team/detail?teamId=' + data.teamId })
        if (data.existingSimilar && data.existingSimilar.length) {
          wx.showModal({
            title: '创建成功',
            content: '已为你创建团队。系统中存在名称相似的团队，可在详情页核对是否需要合并。',
            showCancel: false,
            confirmText: '进入团队',
            success: goDetail
          })
        } else {
          app.showSuccess('创建成功')
          goDetail()
        }
      } else {
        team.showTeamError(res.error)
      }
    })
  },

  goJoin() {
    wx.navigateTo({ url: '/pages/team/join' })
  },

  stopPropagation() {}
})
