const app = getApp()

Page({
  data: {
    id: '',
    isEdit: false,
    isLoading: true,
    isSaving: false,
    avatar: '',
    name: '',
    position: '',
    company: '',
    phone: '',
    email: '',
    address: '',
    personalIntro: '',
    businessIntro: '',
    experiences: [],
    attachments: [],
    wechatOfficial: { name: '', desc: '', url: '' },
    companyWebsite: { name: '', url: '', desc: '' },
    errors: {}
  },

  onLoad(options) {
    const id = options?.id || ''
    const isEdit = !!id
    this.setData({ id, isEdit, isLoading: isEdit })
    if (isEdit) {
      this.loadCard(id)
    }
  },

  loadCard(id) {
    if (!id || !wx.cloud) {
      this.setData({ isLoading: false })
      return
    }

    const timer = setTimeout(() => {
      this.setData({ isLoading: false })
      app.showError('加载超时，请重试')
    }, 10000)

    wx.cloud.database().collection('cards').doc(id).get()
      .then(res => {
        clearTimeout(timer)
        if (res.data) {
          const data = res.data
          this.setData({
            avatar: data.avatar || '',
            name: data.name || '',
            position: data.position || '',
            company: data.company || '',
            phone: data.phone || '',
            email: data.email || '',
            address: data.address || '',
            personalIntro: data.personalIntro || '',
            businessIntro: data.businessIntro || '',
            experiences: data.experiences || [],
            attachments: data.attachments || [],
            wechatOfficial: data.wechatOfficial || { name: '', desc: '', url: '' },
            companyWebsite: data.companyWebsite || { name: '', url: '', desc: '' },
            isLoading: false
          })
        } else {
          this.setData({ isLoading: false })
          app.showError('名片不存在')
          setTimeout(() => wx.navigateBack(), 1500)
        }
      })
      .catch(err => {
        clearTimeout(timer)
        this.setData({ isLoading: false })
        app.showError('加载失败，请重试')
      })
  },

  chooseAvatar() {
    this._openImagePicker()
  },

  _openImagePicker() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album']
        wx.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType,
          success: (res) => {
            const tempFilePath = res.tempFilePaths[0]
            if (!tempFilePath) return
            this.compressAndUpload(tempFilePath, 'avatar')
          },
          fail: (err) => {
            const errMsg = err.errMsg || ''
            if (errMsg.indexOf('cancel') > -1) return
            this._showPermissionGuide()
          }
        })
      }
    })
  },

  _showPermissionGuide() {
    wx.showModal({
      title: '权限提示',
      content: '使用相册和相机需要在微信设置中开启权限。请点击"去设置"开启相关权限。',
      confirmText: '去设置',
      confirmColor: '#3B82F6',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.openSetting({})
        }
      }
    })
  },

  compressAndUpload(filePath, type) {
    wx.getFileInfo({
      filePath,
      success: (res) => {
        let compressQuality = 80
        if (res.size > 5 * 1024 * 1024) {
          app.showError('图片过大，请选择小于5MB的图片')
          return
        }
        if (res.size > 2 * 1024 * 1024) compressQuality = 60
        else if (res.size > 1 * 1024 * 1024) compressQuality = 70

        wx.compressImage({
          src: filePath,
          quality: compressQuality,
          success: (compressRes) => {
            this.uploadFile(compressRes.tempFilePath, type)
          },
          fail: () => {
            this.uploadFile(filePath, type)
          }
        })
      },
      fail: () => {
        this.uploadFile(filePath, type)
      }
    })
  },

  uploadFile(filePath, type) {
    app.showLoading('上传中')

    const timestamp = Date.now()
    const cloudPath = type + '/' + timestamp + '.jpg'

    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => {
        if (type === 'avatar') {
          this.setData({ avatar: res.fileID })
        } else if (type === 'wechatQR') {
          this.setData({
            wechatOfficial: {
              ...this.data.wechatOfficial,
              qrUrl: res.fileID
            }
          })
        }
        app.hideLoading()
        app.showSuccess('上传成功')
      },
      fail: () => {
        app.hideLoading()
        app.showError('上传失败，请重试')
      }
    })
  },

  chooseAttachment() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0]
        const fileName = 'attachment_' + Date.now() + '.jpg'

        app.showLoading('上传中')

        wx.cloud.uploadFile({
          cloudPath: 'attachments/' + fileName,
          filePath: tempFilePath,
          success: (res) => {
            app.hideLoading()
            const attachments = [...this.data.attachments, {
              name: fileName,
              url: res.fileID,
              size: this.formatSize(res.statusCode === 200 ? 1024 : 0),
              time: this.formatTime(new Date())
            }]
            this.setData({ attachments })
            app.showSuccess('上传成功')
          },
          fail: () => {
            app.hideLoading()
            app.showError('上传失败')
          }
        })
      },
      fail: (err) => {
        const errMsg = err.errMsg || ''
        if (errMsg.indexOf('cancel') > -1) return
        this._showPermissionGuide()
      }
    })
  },

  formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  },

  formatTime(date) {
    const pad = (n) => n.toString().padStart(2, '0')
    return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  },

  onNameInput(e) {
    const value = e.detail.value.trim()
    this.setData({ name: value })
    this.clearError('name')
  },

  onPositionInput(e) {
    this.setData({ position: e.detail.value.trim() })
  },

  onCompanyInput(e) {
    const value = e.detail.value.trim()
    this.setData({ company: value })
    this.clearError('company')
  },

  onPhoneInput(e) {
    const value = e.detail.value.trim()
    this.setData({ phone: value })
    this.clearError('phone')
  },

  onEmailInput(e) {
    const value = e.detail.value.trim()
    this.setData({ email: value })
    this.clearError('email')
  },

  onAddressInput(e) {
    this.setData({ address: e.detail.value.trim() })
  },

  onPersonalIntroInput(e) {
    this.setData({ personalIntro: e.detail.value.trim() })
  },

  onBusinessIntroInput(e) {
    this.setData({ businessIntro: e.detail.value.trim() })
  },

  onExpInput(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const field = e.currentTarget.dataset.field
    const value = e.detail.value.trim()

    const experiences = [...this.data.experiences]
    if (!experiences[index]) experiences[index] = {}
    experiences[index][field] = value
    this.setData({ experiences })
  },

  addExperience() {
    const experiences = [...this.data.experiences, {}]
    this.setData({ experiences })
  },

  deleteExperience(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const experiences = this.data.experiences.filter((_, i) => i !== index)
    this.setData({ experiences })
  },

  onWechatInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value.trim()
    this.setData({
      wechatOfficial: {
        ...this.data.wechatOfficial,
        [field]: value
      }
    })
  },

  onWebsiteInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value.trim()
    this.setData({
      companyWebsite: {
        ...this.data.companyWebsite,
        [field]: value
      }
    })
  },

  deleteAttachment(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const attachments = this.data.attachments.filter((_, i) => i !== index)
    this.setData({ attachments })
  },

  clearError(field) {
    const errors = this.data.errors
    if (errors[field]) {
      delete errors[field]
      this.setData({ errors: { ...errors } })
    }
  },

  validateForm() {
    const errors = {}
    const { name, company, phone, email } = this.data

    if (!name) errors.name = '请输入姓名'
    if (!company) errors.company = '请输入公司名称'
    if (phone && !app.isValidPhone(phone)) errors.phone = '请输入正确的手机号'
    if (email && !app.isValidEmail(email)) errors.email = '请输入正确的邮箱地址'

    if (Object.keys(errors).length > 0) {
      this.setData({ errors })
      app.showError(Object.values(errors)[0])
      return false
    }
    return true
  },

  saveCard() {
    if (this.data.isSaving) return
    if (!this.validateForm()) return

    this.setData({ isSaving: true })

    const data = {
      name: this.data.name,
      position: this.data.position,
      company: this.data.company,
      phone: this.data.phone,
      email: this.data.email,
      address: this.data.address,
      avatar: this.data.avatar,
      personalIntro: this.data.personalIntro,
      businessIntro: this.data.businessIntro,
      experiences: this.data.experiences.filter(e => e.company || e.position),
      attachments: this.data.attachments,
      wechatOfficial: this.data.wechatOfficial,
      companyWebsite: this.data.companyWebsite,
      updateTime: new Date()
    }

    const db = wx.cloud.database().collection('cards')
    const action = this.data.isEdit ? db.doc(this.data.id).update({ data }) : db.add({ data: { ...data, createTime: new Date() } })

    action.then(() => {
      app.hideLoading()
      this.setData({ isSaving: false })
      app.showSuccess('保存成功')
      setTimeout(() => wx.navigateBack(), 1500)
    }).catch(() => {
      app.hideLoading()
      this.setData({ isSaving: false })
      app.showError('保存失败，请重试')
    })
  }
})
