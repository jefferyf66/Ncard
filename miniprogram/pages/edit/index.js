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
    publicSettings: {
      showPersonalIntro: true,
      showBusinessIntro: true,
      showExperiences: true,
      showWechatOfficial: true,
      showCompanyWebsite: true,
      showAttachments: true
    },
    errors: {},
    dragStartIndex: -1,
    dragY: 0
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
            publicSettings: data.publicSettings || {
              showPersonalIntro: true,
              showBusinessIntro: true,
              showExperiences: true,
              showWechatOfficial: true,
              showCompanyWebsite: true,
              showAttachments: true
            },
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

  // 直接打开系统相册选择图片 → 跳裁切页
  chooseAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album'],
      success: (res) => {
        var tempFilePath = res.tempFilePaths && res.tempFilePaths[0]
        if (!tempFilePath) return
        app.globalData.cropImageSrc = tempFilePath
        wx.navigateTo({
          url: '/pages/crop/index'
        })
      },
      fail: function(err) {
        var errMsg = (err && err.errMsg) || ''
        if (errMsg.indexOf('cancel') > -1) return
        if (errMsg.indexOf('auth deny') > -1 || errMsg.indexOf('auth denied') > -1) {
          wx.showModal({
            title: '相册权限未开启',
            content: '请在手机设置 → 微信中开启「照片」权限后重试。',
            showCancel: false,
            confirmText: '知道了'
          })
          return
        }
        app.showError('打开相册失败，请重试')
      }
    })
  },

  // 裁切页返回的结果回调
  onCropResult(tempFilePath) {
    if (!tempFilePath) return
    this._uploadAvatar(tempFilePath)
  },

  _uploadAvatar(tempFilePath) {
    app.showLoading('上传中')
    var oldAvatarFileID = this.data.avatar
    const cloudPath = 'avatars/' + Date.now() + '.jpg'
    wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath,
      success: (uploadRes) => {
        app.hideLoading()
        this.setData({ avatar: uploadRes.fileID })
        // 删除旧头像文件，避免云存储冗余
        if (oldAvatarFileID && oldAvatarFileID.indexOf('cloud://') === 0) {
          wx.cloud.deleteFile({ fileList: [oldAvatarFileID] })
            .then(function () {
              console.log('[Edit] 旧头像文件已清理')
            })
            .catch(function () {
              // 静默失败，不影响主流程
            })
        }
        app.showSuccess('头像更新成功')
      },
      fail: (err) => {
        app.hideLoading()
        console.error('[Edit] 头像上传失败:', JSON.stringify(err))
        app.showError('头像上传失败，请重试')
      }
    })
  },

  chooseAttachment() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album'],
      success: (res) => {
        const tempFilePath = res.tempFilePaths && res.tempFilePaths[0]
        if (!tempFilePath) return
        const fileName = 'attachment_' + Date.now() + '.jpg'

        app.showLoading('上传中')

        wx.cloud.uploadFile({
          cloudPath: 'attachments/' + fileName,
          filePath: tempFilePath,
          success: (uploadRes) => {
            app.hideLoading()
            const attachments = [...this.data.attachments, {
              name: fileName,
              url: uploadRes.fileID,
              size: '',
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
      }
    })
  },

  formatTime(date) {
    const pad = (n) => n.toString().padStart(2, '0')
    return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  },

  deleteAttachment(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const attachments = [...this.data.attachments]
    var removed = attachments.splice(index, 1)[0]
    this.setData({ attachments })
    // 删除云存储中的附件文件，避免冗余
    if (removed && removed.url && removed.url.indexOf('cloud://') === 0) {
      wx.cloud.deleteFile({ fileList: [removed.url] })
        .then(function () {
          console.log('[Edit] 附件文件已清理')
        })
        .catch(function () {
          // 静默失败，不影响主流程
        })
    }
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

  onExpTouchStart(e) {
    if (e.touches.length !== 1) return
    const index = parseInt(e.currentTarget.dataset.index)
    this.setData({
      dragStartIndex: index,
      dragY: e.touches[0].clientY
    })
  },

  onExpTouchMove(e) {
    if (this.data.dragStartIndex === -1) return
    if (e.touches.length !== 1) return

    const deltaY = e.touches[0].clientY - this.data.dragY
    const experiences = [...this.data.experiences]
    const startIndex = this.data.dragStartIndex
    const itemHeight = 200
    const moveIndex = Math.max(0, Math.min(experiences.length - 1, startIndex + Math.round(deltaY / itemHeight)))

    if (moveIndex !== startIndex) {
      const [removed] = experiences.splice(startIndex, 1)
      experiences.splice(moveIndex, 0, removed)
      this.setData({ experiences, dragStartIndex: moveIndex, dragY: e.touches[0].clientY })
    }
  },

  onExpTouchEnd() {
    this.setData({ dragStartIndex: -1 })
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

  togglePublic(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({
      publicSettings: {
        ...this.data.publicSettings,
        [field]: !this.data.publicSettings[field]
      }
    })
  },

  clearError(field) {
    const errors = { ...this.data.errors }
    delete errors[field]
    this.setData({ errors })
  },

  validate() {
    const errors = {}
    if (!this.data.name.trim()) errors.name = '请输入姓名'
    if (!this.data.company.trim()) errors.company = '请输入公司名称'
    if (this.data.phone && !/^1[3-9]\d{9}$/.test(this.data.phone)) errors.phone = '请输入正确的手机号码'
    if (this.data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.data.email)) errors.email = '请输入正确的邮箱地址'
    this.setData({ errors })
    return Object.keys(errors).length === 0
  },

  saveCard() {
    if (!this.validate()) return
    if (this.data.isSaving) return

    this.setData({ isSaving: true })

    const data = {
      name: this.data.name.trim(),
      position: this.data.position.trim(),
      company: this.data.company.trim(),
      phone: this.data.phone.trim(),
      email: this.data.email.trim(),
      address: this.data.address.trim(),
      avatar: this.data.avatar,
      personalIntro: this.data.personalIntro.trim(),
      businessIntro: this.data.businessIntro.trim(),
      experiences: this.data.experiences.filter(e => e.company || e.position),
      attachments: this.data.attachments,
      wechatOfficial: this.data.wechatOfficial,
      companyWebsite: this.data.companyWebsite,
      publicSettings: this.data.publicSettings,
      updateTime: new Date()
    }

    if (!this.data.id) {
      data.createTime = new Date()
    }

    const db = wx.cloud.database()
    const promise = this.data.id
      ? db.collection('cards').doc(this.data.id).update({ data })
      : db.collection('cards').add({ data })

    promise
      .then(() => {
        this.setData({ isSaving: false })
        app.showSuccess(this.data.isEdit ? '修改成功' : '创建成功')
        setTimeout(() => wx.navigateBack(), 1500)
      })
      .catch(() => {
        this.setData({ isSaving: false })
        app.showError('保存失败，请重试')
      })
  }
})
