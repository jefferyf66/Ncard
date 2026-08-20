const app = getApp()
const team = require('../../utils/team')

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
    isJoining: false
  },

  onLoad(options) {
    const teamId = (options && options.teamId) || ''
    const token = (options && options.token) || ''
    this.setData({ teamId, token })
    app.ensureUser().then(() => {
      if (token) {
        this._loadInviteMeta(token)
      }
    })
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

  join() {
    if (this.data.isJoining) return
    const { isCardInvite, token, code } = this.data

    // 空名片邀请：前端先做必填校验，再提交成员填写的 managedFields
    if (isCardInvite) {
      const missing = (this.data.cardSchema || [])
        .filter(f => f.required && f.visible && !(this.data.form[f.key] || '').trim())
      if (missing.length) {
        this.setData({ requiredMissing: missing.map(f => f.key) })
        app.showError('请填写：' + missing.map(f => f.label).join('、'))
        return
      }
      this.setData({ isJoining: true })
      app.showLoading('提交中...')
      team.callTeamManager('joinByInvite', { token, managedFields: this.data.form }).then((res) => {
        app.hideLoading()
        this.setData({ isJoining: false })
        this._handleJoinResult(res)
      })
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
