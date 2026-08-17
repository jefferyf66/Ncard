const app = getApp()
const team = require('../../utils/team')

Page({
  data: {
    teamId: '',
    team: null,
    myRole: '',
    members: [],
    isLoading: true,
    isOwner: false,
    showInviteModal: false,
    inviteCode: '',
    inviteToken: '',
    sharePath: ''
  },

  onLoad(options) {
    const teamId = (options && options.teamId) || ''
    this.setData({ teamId })
    app.ensureUser().then(() => this.loadDetail())
  },

  onShow() {
    if (this.data.teamId && app.getUser()) this.loadMembers()
  },

  loadDetail() {
    this.setData({ isLoading: true })
    team.callTeamManager('getTeam', { teamId: this.data.teamId }).then((res) => {
      if (res.success) {
        const myRole = res.data.myRole || ''
        this.setData({
          team: res.data.team,
          myRole,
          isOwner: myRole === 'owner',
          isLoading: false
        })
        this.loadMembers()
      } else {
        this.setData({ isLoading: false })
        team.showTeamError(res.error)
        if (res.error === 'TEAM_NOT_FOUND') {
          setTimeout(() => wx.navigateBack(), 1500)
        }
      }
    })
  },

  loadMembers() {
    team.callTeamManager('listMembers', { teamId: this.data.teamId }).then((res) => {
      if (!res.success) return
      const me = app.getUser()
      const myOpenId = (me && me._openid) || ''
      const members = (res.data.members || []).map((m) => Object.assign({}, m, {
        isMe: m.memberOpenId === myOpenId,
        maskedId: maskOpenId(m.memberOpenId)
      }))
      this.setData({ members })
    })
  },

  // 邀请成员（owner）：生成邀请码 + token
  onInvite() {
    app.showLoading('生成邀请...')
    team.callTeamManager('createInvite', { teamId: this.data.teamId }).then((res) => {
      app.hideLoading()
      if (res.success) {
        const data = res.data
        const path = '/pages/team/join?teamId=' + this.data.teamId + '&token=' + data.token
        this.setData({
          showInviteModal: true,
          inviteCode: data.code,
          inviteToken: data.token,
          sharePath: path
        })
      } else {
        team.showTeamError(res.error)
      }
    })
  },

  closeInvite() {
    this.setData({ showInviteModal: false })
  },

  copyInviteCode() {
    if (!this.data.inviteCode) return
    wx.setClipboardData({
      data: this.data.inviteCode,
      success: () => app.showSuccess('邀请码已复制'),
      fail: (err) => { if (!app.showPrivacyError(err)) app.showError('复制失败') }
    })
  },

  // 分享邀请卡片（P1，携带 teamId+token）
  onShareAppMessage() {
    const t = this.data.team
    const title = '邀请你加入团队「' + (t && t.name || '我的团队') + '」'
    // 优先使用「邀请成员」弹窗生成的带 token 路径；胶囊菜单直接转发无 token 时降级到团队列表页（接收方仍可手输邀请码加入）
    const path = this.data.sharePath ||
      (this.data.inviteToken
        ? '/pages/team/join?teamId=' + this.data.teamId + '&token=' + this.data.inviteToken
        : '/pages/team/list')
    return { title, path }
  },

  // 编辑成员组织字段（owner）
  editMember(e) {
    const memberOpenId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: '/pages/team/member-edit?teamId=' + this.data.teamId + '&memberOpenId=' + encodeURIComponent(memberOpenId)
    })
  },

  // 移除成员（owner，不可移除自己）
  removeMember(e) {
    const memberOpenId = e.currentTarget.dataset.id
    const member = this.data.members.find((m) => m.memberOpenId === memberOpenId)
    const label = member ? (member.isMe ? '你自己' : member.maskedId) : '该成员'
    wx.showModal({
      title: '移除成员',
      content: '确认将 ' + label + ' 移出团队？',
      confirmText: '移除',
      confirmColor: '#F53F3F',
      success: (r) => { if (r.confirm) this._doRemove(memberOpenId) }
    })
  },

  _doRemove(memberOpenId) {
    app.showLoading('移除中...')
    team.callTeamManager('removeMember', { teamId: this.data.teamId, memberOpenId }).then((res) => {
      app.hideLoading()
      if (res.success) {
        app.showSuccess('已移除')
        this.loadMembers()
      } else {
        team.showTeamError(res.error)
      }
    })
  },

  // 退出团队（owner 受保护）
  onLeave() {
    wx.showModal({
      title: '退出团队',
      content: '确认退出该团队？退出后你的名片将不再关联此团队。',
      confirmText: '退出',
      confirmColor: '#F53F3F',
      success: (r) => { if (r.confirm) this._doLeave() }
    })
  },

  _doLeave() {
    app.showLoading('退出中...')
    team.callTeamManager('leaveTeam', { teamId: this.data.teamId }).then((res) => {
      app.hideLoading()
      if (res.success) {
        app.showSuccess('已退出')
        setTimeout(() => wx.navigateBack(), 800)
      } else {
        team.showTeamError(res.error)
      }
    })
  },

  // 解散团队（owner 专属，破坏性操作需二次确认）
  onDisband() {
    wx.showModal({
      title: '解散团队',
      content: '解散后团队所有成员、邀请码将立即失效，且不可恢复。确认解散？',
      confirmText: '解散',
      confirmColor: '#F53F3F',
      success: (r) => { if (r.confirm) this._doDisband() }
    })
  },

  _doDisband() {
    app.showLoading('解散中...')
    team.callTeamManager('disbandTeam', { teamId: this.data.teamId }).then((res) => {
      app.hideLoading()
      if (res.success) {
        app.showSuccess('团队已解散')
        setTimeout(() => wx.navigateBack(), 800)
      } else {
        team.showTeamError(res.error)
      }
    })
  },

  stopPropagation() {}
})

function maskOpenId(id) {
  if (!id) return ''
  return '..' + id.slice(-6)
}
