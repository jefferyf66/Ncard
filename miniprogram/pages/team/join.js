const app = getApp()
const team = require('../../utils/team')
const storage = require('../../config/storage')

Page({
  data: {
    code: '',
    teamId: '',
    token: '',
    teamName: '',
    prefillTeam: null, // 兼容保留
    isCardInvite: false, // 是否为空名片邀请（成员需填空）
    cardSchema: [],      // 团队名片字段配置
    prefill: {},         // owner 预填值
    form: {},            // 成员填写值
    requiredMissing: [], // 校验未过的字段 key
    inviteInvalid: false, // 邀请已失效/已使用
    isJoining: false,
    // 个人名片身份字段（姓名必填 + 头像可选，始终显示，与团队字段配置无关）
    hasCard: false,
    memberName: '',
    avatarUrl: '',        // 展示用（已有名片=cloud://，新选=本地临时路径）
    newAvatarPath: '',    // 新选头像的本地临时路径（提交时上传）
    isAvatarUploading: false
  },

  onLoad(options) {
    const teamId = (options && options.teamId) || ''
    const token = (options && options.token) || ''
    this.setData({ teamId, token })
    app.ensureUser().then(() => {
      this._loadMyCard()
      if (token) {
        this._loadInviteMeta(token)
      }
    })
  },

  // 预拉取本人个人名片：用于预填姓名/头像（团队卡片的身份来源）
  _loadMyCard() {
    try {
      const db = wx.cloud.database()
      db.collection('cards').orderBy('createTime', 'desc').limit(1).get().then((res) => {
        const c = (res && res.data && res.data[0]) || null
        if (c) {
          this.setData({
            hasCard: true,
            memberName: c.name || '',
            avatarUrl: c.avatar || ''
          })
        } else {
          this.setData({ hasCard: false })
        }
      }).catch(() => { /* 忽略：不影响团队表单填写 */ })
    } catch (e) { /* 忽略 */ }
  },

  // 凭 token 拉取邀请元信息：区分普通邀请 / 空名片邀请，并初始化填空表单
  _loadInviteMeta(token) {
    team.callTeamManager('getInviteMeta', { token }).then((res) => {
      if (!res.success) {
        this.setData({ prefillTeam: null })
        if (res.error === 'INVITE_NOT_FOUND') app.showError('邀请已失效或不存在')
        return
      }
      const d = res.data
      const isCard = d.kind === 'card'
      // 失效 / 已使用：直接提示并阻止填空表单，而非等提交才报错
      if (d.expired || d.usedUp) {
        this.setData({ teamName: d.teamName || '', inviteInvalid: true })
        app.showError('该邀请已失效或已使用')
        return
      }
      const form = {}
      ;(d.cardSchema || []).forEach(f => {
        // 回显 owner 预填值（prefill），无预填则回退字段默认值（defaultValue），成员可改
        const v = (d.prefill && d.prefill[f.key]) || (f.defaultValue || '')
        form[f.key] = (v || '').toString().trim()
      })
      this.setData({
        teamId: d.teamId,
        teamName: d.teamName,
        isCardInvite: isCard,
        cardSchema: d.cardSchema || [],
        prefill: d.prefill || {},
        form
      })
    })
  },

  onCodeInput(e) {
    // 邀请码统一转大写，去除空格
    this.setData({ code: e.detail.value.replace(/\s/g, '').toUpperCase() })
  },

  onFieldInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['form.' + key]: e.detail.value, requiredMissing: [] })
  },

  onNameInput(e) {
    this.setData({ memberName: e.detail.value })
  },

  // 选择头像（可选）：上传前仅本地预览，提交时再上传云存储
  onAvatarChoose() {
    if (this.data.isAvatarUploading) return
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const temp = (res.tempFilePaths && res.tempFilePaths[0]) || ''
        if (!temp) return
        this.setData({ avatarUrl: temp, newAvatarPath: temp })
      }
    })
  },

  join() {
    if (this.data.isJoining) return
    const { isCardInvite, token, code } = this.data

    // 空名片邀请：前端先做必填校验，再提交成员填写的 managedFields + 身份字段
    if (isCardInvite) {
      const name = (this.data.memberName || '').trim()
      if (!name) {
        this.setData({ requiredMissing: ['name'] })
        app.showError('请填写姓名')
        return
      }
      const missing = (this.data.cardSchema || [])
        .filter(f => f.required && f.visible && !(this.data.form[f.key] || '').trim())
      if (missing.length) {
        this.setData({ requiredMissing: missing.map(f => f.key) })
        app.showError('请填写：' + missing.map(f => f.label).join('、'))
        return
      }
      this.setData({ isJoining: true })
      app.showLoading('提交中...')
      const self = this
      const doJoin = (cardAvatar) => {
        team.callTeamManager('joinByInvite', {
          token,
          managedFields: self.data.form,
          cardName: name,
          cardAvatar
        }).then((res) => {
          app.hideLoading()
          self.setData({ isJoining: false })
          self._handleJoinResult(res)
        })
      }
      // 新选头像：先上传云存储再提交；否则（已有名片未改）传 '' 由后端保留
      if (self.data.newAvatarPath) {
        const cloudPath = 'avatars/teamjoin_' + Date.now() + '.jpg'
        wx.cloud.uploadFile({
          cloudPath,
          filePath: self.data.newAvatarPath,
          success: (up) => doJoin(up.fileID),
          fail: () => {
            app.hideLoading()
            self.setData({ isJoining: false })
            app.showError('头像上传失败，请重试')
          }
        })
      } else {
        doJoin('')
      }
      return
    }

    // 普通邀请：凭 token 或邀请码加入
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
      this._handleJoinResult(res)
    })
  },

  _handleJoinResult(res) {
    if (res.success) {
      app.showSuccess('加入成功')
      const target = res.data.teamId || this.data.teamId
      wx.redirectTo({ url: '/pages/team/detail?teamId=' + target })
      return
    }
    if (res.error === 'MISSING_REQUIRED') {
      this.setData({ requiredMissing: res.fields || [] })
      app.showError('还有必填项未填写')
      return
    }
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
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/edit/index' })
  },

  stopPropagation() {}
})
