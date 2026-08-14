const app = getApp()
const team = require('../../utils/team')

// 仅 D2 七个组织字段可编辑（个人字段永不被团队覆盖）
const FIELDS = [
  { key: 'company', label: '公司', placeholder: '公司名称' },
  { key: 'department', label: '部门', placeholder: '所在部门' },
  { key: 'position', label: '职位', placeholder: '职位名称' },
  { key: 'companyPhone', label: '公司电话', placeholder: '公司座机 / 总机' },
  { key: 'companyAddress', label: '公司地址', placeholder: '公司地址' },
  { key: 'companyWebsite', label: '公司网站', placeholder: 'https://...' },
  { key: 'workEmail', label: '工作邮箱', placeholder: '工作邮箱' }
]

Page({
  data: {
    teamId: '',
    memberOpenId: '',
    teamName: '',
    fields: FIELDS,
    maskedMember: '',
    form: {},
    isSaving: false
  },

  onLoad(options) {
    const teamId = (options && options.teamId) || ''
    const memberOpenId = decodeURIComponent((options && options.memberOpenId) || '')
    this.setData({
      teamId,
      memberOpenId,
      maskedMember: '..' + memberOpenId.slice(-6)
    })
    app.ensureUser().then(() => this.loadData())
  },

  loadData() {
    app.showLoading('加载中...')
    // 校验 owner 权限
    team.callTeamManager('getTeam', { teamId: this.data.teamId }).then((res) => {
      if (!res.success || res.data.myRole !== 'owner') {
        app.hideLoading()
        app.showError('无权编辑成员')
        setTimeout(() => wx.navigateBack(), 1200)
        return
      }
      this.setData({ teamName: (res.data.team && res.data.team.name) || '' })
      this._loadMemberFields()
    })
  },

  _loadMemberFields() {
    team.callTeamManager('listMembers', { teamId: this.data.teamId }).then((res) => {
      app.hideLoading()
      if (!res.success) {
        team.showTeamError(res.error)
        return
      }
      const member = (res.data.members || []).find((m) => m.memberOpenId === this.data.memberOpenId)
      const mf = (member && member.managedFields) || {}
      const form = {}
      this.data.fields.forEach((f) => { form[f.key] = mf[f.key] || '' })
      this.setData({ form })
    })
  },

  onFieldInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['form.' + key]: e.detail.value })
  },

  save() {
    if (this.data.isSaving) return
    this.setData({ isSaving: true })
    app.showLoading('保存中...')
    const form = this.data.form
    const managedFields = {}
    this.data.fields.forEach((f) => { managedFields[f.key] = (form[f.key] || '').trim() })
    team.callTeamManager('updateMemberFields', {
      teamId: this.data.teamId,
      memberOpenId: this.data.memberOpenId,
      managedFields
    }).then((res) => {
      app.hideLoading()
      this.setData({ isSaving: false })
      if (res.success) {
        app.showSuccess('已保存')
        setTimeout(() => wx.navigateBack(), 800)
      } else {
        team.showTeamError(res.error)
      }
    })
  },

  stopPropagation() {}
})
