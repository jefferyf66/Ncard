const app = getApp()
const team = require('../../utils/team')
const storage = require('../../config/storage')
const TS = require('../../config/teamStyle')

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
    showCardInviteModal: false,
    // 团队分享卡（目录/邀请/填写）预生成 URL 缓存
    teamShareUrls: { directory: '', invite: '', card: '' },
    teamCanvasWidth: TS.TEAM_CARD.canvasWidth,
    teamCanvasHeight: TS.TEAM_CARD.canvasHeight
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

        // 进页预生成三种分享卡（目录/邀请/填写），分享时即可命中、不再截页面
        this._ensureTeamShareImages(t)

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
    const urls = this.data.teamShareUrls || {}
    // 整组分享：团队名片目录
    if (res && res.target && res.target.dataset && res.target.dataset.share === 'directory') {
      const name = (this.data.pubTeam && this.data.pubTeam.name) ||
        (this.data.team && this.data.team.name) || '团队'
      return {
        title: name + ' · 团队名片目录',
        path: 'pages/team/detail?id=' + this.data.shortId + '&public=1',
        imageUrl: this._cacheBust(urls.directory)
      }
    }
    // 空名片邀请（owner 转发给成员填写）：token 指向 join 页空名片表单
    if (res && res.target && res.target.dataset && res.target.dataset.share === 'card') {
      const t = this.data.team
      const name = (t && t.name) || '团队'
      return {
        title: name + ' · 邀请你填写团队名片',
        path: 'pages/team/join?teamId=' + this.data.teamId + '&token=' + this.data.cardShareToken,
        imageUrl: this._cacheBust(urls.card)
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
    return { title, path, imageUrl: this._cacheBust(urls.invite) }
  },

  // 缓存击穿：分享图 URL 挂样式版本，外观升级即视为新 URL，微信必重新抓取
  _cacheBust(url) {
    if (!url) return ''
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'imgv=' + TS.TEAM_SHARE_STYLE
  },

  // 进页预生成三张分享卡（目录/邀请/填写）；本地缓存命中直接取值，否则生成+上传+缓存
  _ensureTeamShareImages(teamObj) {
    const self = this
    const shortId = (teamObj && teamObj.shortId) || this.data.shortId
    if (!shortId) return
    const t = teamObj || this.data.team || {}
    const kinds = ['directory', 'invite', 'card']
    kinds.forEach((kind) => {
      const cacheKey = 'teamShare_' + shortId + '_' + kind + '_' + TS.TEAM_SHARE_STYLE
      let cached = ''
      try { cached = wx.getStorageSync(cacheKey) || '' } catch (e) { /* ignore */ }
      if (cached) {
        const u = Object.assign({}, self.data.teamShareUrls)
        u[kind] = cached
        self.setData({ teamShareUrls: u })
        return
      }
      self._generateTeamShareImage(t, kind).then((url) => {
        if (!url) return
        try { wx.setStorageSync(cacheKey, url) } catch (e) { /* ignore */ }
        const u = Object.assign({}, self.data.teamShareUrls)
        u[kind] = url
        self.setData({ teamShareUrls: u })
      })
    })
  },

  // 生成单张分享卡 → 上传云存储 → 回 HTTPS URL；失败/超时返回 ''
  _generateTeamShareImage(teamObj, kind) {
    const self = this
    return new Promise((resolve) => {
      const t = teamObj || {}
      const payload = {
        name: t.name || '团队',
        shortId: t.shortId || self.data.shortId,
        memberCount: t.memberCount || 1,
        logoUrl: t.logoUrl || '',
        prefillKeys: ['公司', '部门', '职位']
      }
      let shareCard
      try { shareCard = require('../../utils/teamShareCard') } catch (e) {
        console.warn('[TeamShare] require teamShareCard 失败:', e)
        resolve('')
        return
      }
      const settled = { done: false }
      const timer = setTimeout(() => {
        if (settled.done) return
        settled.done = true
        console.warn('[TeamShare] 生成超时(15s)，降级')
        resolve('')
      }, 15000)
      shareCard.generate('teamShareCanvas', payload, kind, { pageContext: self }).then((res) => {
        if (settled.done) return
        wx.cloud.uploadFile({
          cloudPath: 'sharecards/team_' + payload.shortId + '_' + kind + '_' + TS.TEAM_SHARE_STYLE + '.jpg',
          filePath: res.tempFilePath,
          success: (up) => {
            if (settled.done) return
            settled.done = true
            clearTimeout(timer)
            const url = storage.resolveCloudUrl(up.fileID)
            console.log('[TeamShare] 已生成并上传:', kind, url)
            resolve(url)
          },
          fail: (err) => {
            if (settled.done) return
            settled.done = true
            clearTimeout(timer)
            console.warn('[TeamShare] 上传失败:', err)
            resolve('')
          }
        })
      }).catch((err) => {
        if (settled.done) return
        settled.done = true
        clearTimeout(timer)
        console.warn('[TeamShare] 生成失败:', err && err.message)
        resolve('')
      })
    })
  },

  // ============ 团队名片字段配置 + 空名片邀请（owner）============

  // 打开配置弹层：深拷贝 cardConfigSchema → cardConfigDraft（避免直接改源数据）
  onConfigureCard() {
    const draft = (this.data.cardConfigSchema || []).map((f) => Object.assign({}, f))
    this.setData({ cardConfigDraft: draft, showCardConfig: true })
  },

  closeCardConfig() {
    this.setData({ showCardConfig: false })
  },

  toggleSchemaVisible(e) {
    const idx = e.currentTarget.dataset.index
    const draft = this.data.cardConfigDraft.slice()
    if (!draft[idx]) return
    draft[idx] = Object.assign({}, draft[idx], { visible: !draft[idx].visible })
    this.setData({ cardConfigDraft: draft })
  },

  toggleSchemaRequired(e) {
    const idx = e.currentTarget.dataset.index
    const draft = this.data.cardConfigDraft.slice()
    if (!draft[idx]) return
    draft[idx] = Object.assign({}, draft[idx], { required: !draft[idx].required })
    this.setData({ cardConfigDraft: draft })
  },

  onSchemaDefaultInput(e) {
    const idx = e.currentTarget.dataset.index
    const val = (e.detail && e.detail.value) || ''
    const draft = this.data.cardConfigDraft.slice()
    if (!draft[idx]) return
    draft[idx] = Object.assign({}, draft[idx], { defaultValue: val })
    this.setData({ cardConfigDraft: draft })
  },

  // 团队名片配置：上传公众号二维码（wechatOfficialQrcode），写回 defaultValue=cloud:// fileID
  onSchemaQRUpload(e) {
    const idx = e.currentTarget.dataset.index
    const draft = this.data.cardConfigDraft
    if (!draft[idx]) return
    wx.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const temp = (res.tempFilePaths && res.tempFilePaths[0]) || ''
        if (!temp) return
        app.showLoading('上传中')
        // 团队公共二维码：以 teamId 区分，Date.now() 命名（重传产生的旧文件由存储治理对账收口）
        const cloudPath = 'qrcodes/team_' + this.data.teamId + '_' + Date.now() + '.jpg'
        wx.cloud.uploadFile({
          cloudPath,
          filePath: temp,
          success: (up) => {
            app.hideLoading()
            const d2 = this.data.cardConfigDraft.slice()
            d2[idx] = Object.assign({}, d2[idx], { defaultValue: up.fileID })
            this.setData({ cardConfigDraft: d2 })
            app.showSuccess('二维码已上传')
          },
          fail: () => {
            app.hideLoading()
            app.showError('二维码上传失败，请重试')
          }
        })
      },
      fail: (err) => {
        const errMsg = (err && err.errMsg) || ''
        if (errMsg.indexOf('cancel') > -1) return
        if (app.showPrivacyError && app.showPrivacyError(err)) return
        app.showError('选择图片失败')
      }
    })
  },

  saveCardSchema() {
    const schema = this.data.cardConfigDraft
    app.showLoading('保存配置...')
    team.callTeamManager('saveTeamCardSchema', { teamId: this.data.teamId, cardSchema: schema }).then((res) => {
      app.hideLoading()
      if (res.success) {
        this.setData({
          cardConfigSchema: (res.data && res.data.cardSchema) || schema,
          showCardConfig: false
        })
        app.showSuccess('配置已保存')
      } else {
        team.showTeamError(res.error)
      }
    })
  },

  // 生成「空名片」邀请：调 createCardInvite 拿 token，弹出空名片分享窗
  onShareCard() {
    app.showLoading('生成邀请...')
    // 将 owner 在「团队名片配置」里设的「预填内容」(defaultValue) 打包进邀请，
    // 成员打开即见预填值（可改），必填项也不会再逼成员手填 owner 已填的内容
    const prefill = {}
    ;(this.data.cardConfigSchema || []).forEach(f => {
      if (f && f.defaultValue && f.defaultValue.toString().trim()) {
        prefill[f.key] = f.defaultValue.toString().trim()
      }
    })
    team.callTeamManager('createCardInvite', { teamId: this.data.teamId, prefill }).then((res) => {
      app.hideLoading()
      if (res.success) {
        this.setData({ cardShareToken: res.data.token, showCardInviteModal: true })
      } else {
        team.showTeamError(res.error)
      }
    })
  },

  closeCardInvite() {
    this.setData({ showCardInviteModal: false })
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
    wx.switchTab({ url: '/pages/team/list' })
  },

  stopPropagation() {}
})

function maskOpenId(id) {
  if (!id) return ''
  return '..' + id.slice(-6)
}
