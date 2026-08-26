const app = getApp()

Page({
  data: {
    profile: null,
    nickname: '',
    realName: '',
    avatarUrl: '',
    saving: false,
    // 注销
    deleting: false,
    deleteCheck: null,
    showDeleteModal: false
  },

  onShow() {
    this.loadProfile()
  },

  loadProfile() {
    const that = this
    if (!wx.cloud) { wx.showToast({ title: '未初始化云', icon: 'none' }); return }
    wx.cloud.callFunction({
      name: 'accountManager',
      data: { action: 'getMyProfile' },
      success: (res) => {
        const p = (res.result && res.result.success && res.result.data) || null
        if (p) {
          that.setData({ profile: p, nickname: p.nickname || '', realName: p.realName || '', avatarUrl: p.avatarUrl || '' })
        }
      },
      fail: () => { wx.showToast({ title: '加载失败', icon: 'none' }) }
    })
  },

  onNicknameInput(e) { this.setData({ nickname: e.detail.value }) },
  onRealNameInput(e) { this.setData({ realName: e.detail.value }) },

  onChooseAvatar(e) {
    const tempPath = (e.detail && e.detail.avatarUrl) || ''
    if (!tempPath) return
    // 立即回显临时头像，保证「选完即见」（不依赖上传是否成功）
    this.setData({ avatarUrl: tempPath })
    if (!wx.cloud) return
    const cloudPath = 'avatars/' + Date.now() + '.jpg'
    const that = this
    // 上传后存原始 cloud://（微信原生渲染，与编辑页头像一致），
    // 避免 https CDN 不确定性导致「选完不显示」
    this._pendingUpload = new Promise((resolve) => {
      wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: tempPath,
        success: (up) => {
          that.setData({ avatarUrl: up.fileID })
          resolve()
        },
        fail: () => {
          // 上传失败保留临时回显，不阻断
          resolve()
        }
      })
    })
  },

  saveProfile() {
    const that = this
    const doSave = () => {
      if (that.data.saving) return
      that.setData({ saving: true })
      app.showLoading('保存中...')
      wx.cloud.callFunction({
        name: 'accountManager',
        data: {
          action: 'updateMyProfile',
          nickname: that.data.nickname,
          realName: that.data.realName,
          avatarUrl: that.data.avatarUrl
        },
        success: (res) => {
          app.hideLoading()
          that.setData({ saving: false })
          if (res.result && res.result.success) {
            try {
              const u = wx.getStorageSync('user') || {}
              u.nickname = that.data.nickname
              u.realName = that.data.realName
              u.avatarUrl = that.data.avatarUrl
              wx.setStorageSync('user', u)
              if (app.globalData.user) {
                app.globalData.user.nickname = that.data.nickname
                app.globalData.user.realName = that.data.realName
                app.globalData.user.avatarUrl = that.data.avatarUrl
              }
              // 清掉 ensureUser 缓存，下次 ensureUser 重跑能拿到云端最新头像（避免启动快照陈旧）
              app._ensureUserPromise = null
            } catch (e) {}
            wx.showToast({ title: '已保存', icon: 'success' })
          } else {
            wx.showToast({ title: (res.result && res.result.error) || '保存失败', icon: 'none' })
          }
        },
        fail: () => {
          app.hideLoading()
          that.setData({ saving: false })
          wx.showToast({ title: '网络错误', icon: 'none' })
        }
      })
    }
    // 若头像上传仍在进行，先等其完成再保存，确保写入的是永久 HTTPS 而非旧值
    if (this._pendingUpload) {
      app.showLoading('上传头像中...')
      this._pendingUpload.then(() => { this._pendingUpload = null; doSave() })
    } else {
      doSave()
    }
  },

  exportData() {
    if (!wx.cloud) return
    app.showLoading('导出中...')
    wx.cloud.callFunction({
      name: 'accountManager',
      data: { action: 'exportMyData' },
      success: (res) => {
        app.hideLoading()
        if (res.result && res.result.success) {
          const d = res.result.data
          const summary = '我的数据导出\n昵称: ' + ((d.user && d.user.nickname) || '') +
            '\n真名: ' + ((d.user && d.user.realName) || '') +
            '\n名片数: ' + (d.cards ? d.cards.length : 0) +
            '\n收藏数: ' + (d.savedCards ? d.savedCards.length : 0) +
            '\n收到访客: ' + (d.visitsReceived ? d.visitsReceived.length : 0) +
            '\n\n（完整数据 JSON / CSV 已生成，可联系开发者导出）'
          wx.showModal({ title: '导出完成', content: summary, showCancel: false, confirmText: '知道了' })
        } else {
          wx.showToast({ title: '导出失败', icon: 'none' })
        }
      },
      fail: () => { app.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
    })
  },

  requestDelete() {
    const that = this
    if (!wx.cloud) return
    app.showLoading('校验中...')
    wx.cloud.callFunction({
      name: 'accountManager',
      data: { action: 'requestDeleteAccount' },
      success: (res) => {
        app.hideLoading()
        if (res.result && res.result.success) {
          that.setData({ deleteCheck: res.result, showDeleteModal: true })
        } else {
          wx.showToast({ title: '校验失败', icon: 'none' })
        }
      },
      fail: () => { app.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
    })
  },

  closeDeleteModal() { this.setData({ showDeleteModal: false }) },

  confirmDelete() {
    const that = this
    if (this.data.deleting) return
    if (this.data.deleteCheck && !this.data.deleteCheck.canDelete) {
      wx.showToast({ title: '请先转让或解散团队', icon: 'none' })
      return
    }
    this.setData({ deleting: true })
    app.showLoading('注销中...')
    wx.cloud.callFunction({
      name: 'accountManager',
      data: { action: 'confirmDeleteAccount' },
      success: (res) => {
        app.hideLoading()
        that.setData({ deleting: false, showDeleteModal: false })
        if (res.result && res.result.success) {
          try {
            const u = wx.getStorageSync('user') || {}
            u.status = 'deleted'
            wx.setStorageSync('user', u)
            app.globalData.user = u
          } catch (e) {}
          wx.showModal({
            title: '账号已注销',
            content: '您的账号已注销，关联收藏已清除。如需重新使用，将以新账号登记。',
            showCancel: false,
            confirmText: '知道了',
            success: () => { wx.navigateBack() }
          })
        } else {
          wx.showToast({ title: (res.result && res.result.error) || '注销失败', icon: 'none' })
        }
      },
      fail: () => { app.hideLoading(); that.setData({ deleting: false }); wx.showToast({ title: '网络错误', icon: 'none' }) }
    })
  },

  stopProp() {},
  goBack() { wx.navigateBack() }
})
