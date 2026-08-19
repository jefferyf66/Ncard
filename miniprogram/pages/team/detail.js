const app = getApp()
const team = require('../../utils/team')

Page({
  data: {
    // 原始 id（teamId 或 shortId，来自 onLoad 的 options.id）
    rawId: '',
    // 经 getTeam 解析后的真实 _id（toggleShare / 邀请 / 成员列表均用此）
    teamId: '',
    shortId: '',
    // 视图模式：manage（成员/owner）| public（公开目录）| whitelist（非成员未公开）
    viewMode: '',
    team: null,
    myRole: '',
    isOwner: false,
    members: [],
    // 公开目录数据（getTeamPublicDirectory）
    pubTeam: null,
    pubMembers: [],
    // 目录公开开关（owner）
    allowDirectoryShare: false,
    isLoading: true,
    showInviteModal: false,
    inviteCode: '',
    inviteToken: '',
    sharePath: '',
    // 团队名片字段配置（owner 配置 + 空名片分享）
    cardConfigSchema: [],
    showCardConfig: false,
    cardConfigDraft: [],
    cardShareToken: '',
    showCardInviteModal: false
  },

  onLoad(options) {
    // 兼容新规范（?id=）与既有跳转（?teamId=）
    const rawId = (options && (options.id || options.teamId)) || ''
    const isPublicParam = !!(options && options.public === '1')
    this.setData({ rawId, isPublicParam })
    app.ensureUser().then(() => this.loadDetail())
  },

  onShow() {
    // 成员/owner 切回前台时刷新成员列表（公开/白名单模式无需）
    if (this.data.viewMode === 'manage' && this.data.teamId && app.getUser()) {
      this.loadMembers()
    }
  },

  loadDetail() {
    this.setData({ isLoading: true })
    team.callTeamManager('getTeam', { teamId: this.data.rawId }).then((res) => {
      if (res.success) {
        const t = res.data.team || {}
        const myRole = res.data.myRole || ''
        const teamId = t._id || this.data.rawId
        const shortId = t.shortId || this.data.rawId
        const isOwner = myRole === 'owner'
        const allowDirectoryShare = !!t.allowDirectoryShare
        this.setData({
          team: t,
          teamId,
          shortId,
          myRole,
          isOwner,
          allowDirectoryShare,
          cardConfigSchema: (t && t.cardSchema) || [],
          isLoading: false
        })

        if (this.data.isPublicParam) {
          // 分享/公众号链接直达：一律走公开目录视图（内部判定 public / whitelist）
          this.loadPublicDirectory()
          return
        }
        if (myRole) {
          // 成员 / owner → 管理视图
          this.setData({ viewMode: 'manage' })
          this.loadMembers()
        } else {
          // 非成员 → 尝试公开目录，否则白名单视图
          this.loadPublicDirectory()
        }
      } else {
        this.setData({ isLoading: false })
        team.showTeamError(res.error)
        if (res.error === 'TEAM_NOT_FOUND') {
          setTimeout(() => wx.navigateBack(), 1500)
        }
      }
    })
  },

  // 公开团队目录（只读）：非成员/外部访问也走此接口
  loadPublicDirectory() {
    team.callTeamManager('getTeamPublicDirectory', { teamId: this.data.rawId }).then((res) => {
      if (res.success) {
        this.setData({
          viewMode: 'public',
          pubTeam: res.data.team,
          pubMembers: res.data.members
        })
      } else {
        // 未公开 / 不存在 → 白名单视图（提示用邀请码加入）
        this.setData({ viewMode: 'whitelist' })
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
        maskedId: maskOpenId(m.memberOpenId),
        cardId: m.cardId || ''
      }))
      this.setData({ members })
    })
  },

  // 查看成员名片：跳 preview 并把当前团队 id 带上，由 preview 自动展开「该团队下的托管名片」
  openMemberCard(e) {
    const cardId = e.currentTarget.dataset.id
    if (!cardId) return
    wx.navigateTo({
      url: '/pages/preview/index?id=' + cardId + '&teamId=' + this.data.teamId + '&fromTeam=1'
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

  // 切换目录公开开关（owner）：乐观更新，失败回滚
  toggleShare(e) {
    const checked = !!(e.detail && e.detail.value)
    if (checked === this.data.allowDirectoryShare) return
    this.setData({ allowDirectoryShare: checked })
    team.callTeamManager('setDirectoryShare', { teamId: this.data.teamId, allow: checked }).then((res) => {
      if (res.success) {
        this.setData({ allowDirectoryShare: !!res.data.allowDirectoryShare })
      } else {
        // 回滚开关状态
        this.setData({ allowDirectoryShare: !checked })
        team.showTeamError(res.error)
      }
    })
  },

  // 分享：整组目录 / 邀请成员（依据按钮 data-share 区分）
  onShareAppMessage(res) {
    // 整组分享：团队名片目录
    if (res && res.target && res.target.dataset && res.target.dataset.share === 'directory') {
      const name = (this.data.pubTeam && this.data.pubTeam.name) ||
        (this.data.team && this.data.team.name) || '团队'
      return {
        title: name + ' · 团队名片目录',
        path: 'pages/team/detail?id=' + this.data.shortId + '&public=1'
      }
    }
    // 默认：邀请成员（join 路径 / token）
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

  // 白名单视图：跳团队列表以输入邀请码加入
  goTeamList() {
    wx.navigateTo({ url: '/pages/team/list' })
  },

  stopPropagation() {}
})

function maskOpenId(id) {
  if (!id) return ''
  return '..' + id.slice(-6)
}
