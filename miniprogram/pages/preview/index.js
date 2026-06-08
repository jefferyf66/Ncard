const app = getApp()

Page({
  data: {
    card: {},
    id: '',
    isLoading: true,
    isError: false,
    errorMsg: '',
    showDeleteConfirm: false
  },

  onLoad(options) {
    console.log('[Preview] onLoad, options:', options)
    
    const id = options?.id || ''
    this.setData({ id, isLoading: !!id })
    
    if (id) {
      this.loadCard(id)
      this.initShareMenu()
    }
  },

  onShow() {
    if (this.data.id && this.data.isError) {
      this.setData({ isError: false, isLoading: true })
      this.loadCard(this.data.id)
    }
  },

  initShareMenu() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
      success: () => console.log('[Preview] 分享菜单初始化成功'),
      fail: (err) => console.warn('[Preview] 分享菜单初始化失败:', err)
    })
  },

  onShareAppMessage() {
    const { card } = this.data
    return {
      title: `${card.name || '名片'} - ${card.company || ''}`,
      path: `/pages/preview/index?id=${this.data.id}`,
      imageUrl: card.avatar || ''
    }
  },

  onShareTimeline() {
    const { card } = this.data
    return {
      title: `${card.name || '名片'} - ${card.company || ''}`,
      query: `id=${this.data.id}`,
      imageUrl: card.avatar || ''
    }
  },

  loadCard(id) {
    if (!id || !wx.cloud) {
      this.setData({
        isLoading: false,
        isError: true,
        errorMsg: '参数错误'
      })
      return
    }

    const timer = setTimeout(() => {
      console.warn('[Preview] 加载超时')
      this.setData({
        isLoading: false,
        isError: true,
        errorMsg: '加载超时，请重试'
      })
    }, 10000)

    wx.cloud.database().collection('cards').doc(id).get()
      .then(res => {
        clearTimeout(timer)
        if (res.data) {
          this.setData({
            card: {
              ...res.data,
              experiences: res.data.experiences || [],
              attachments: res.data.attachments || [],
              personalIntro: res.data.personalIntro || '',
              businessIntro: res.data.businessIntro || '',
              wechatOfficial: res.data.wechatOfficial || {},
              companyWebsite: res.data.companyWebsite || {}
            },
            isLoading: false,
            isError: false
          })
        } else {
          this.setData({
            isLoading: false,
            isError: true,
            errorMsg: '名片不存在'
          })
        }
      })
      .catch(err => {
        clearTimeout(timer)
        console.error('[Preview] 加载失败:', err)
        this.setData({
          isLoading: false,
          isError: true,
          errorMsg: '加载失败，请重试'
        })
      })
  },

  handlePhone() {
    const phone = this.data.card.phone
    if (!phone) return
    
    wx.showActionSheet({
      itemList: ['拨打电话', '复制号码'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.makePhoneCall({ phoneNumber: phone })
        } else {
          wx.setClipboardData({
            data: phone,
            success: () => app.showSuccess('号码已复制')
          })
        }
      }
    })
  },

  handleEmail() {
    const email = this.data.card.email
    if (!email) return
    
    wx.setClipboardData({
      data: email,
      success: () => app.showSuccess('邮箱已复制')
    })
  },

  handleAddress() {
    const address = this.data.card.address
    if (!address) return
    
    wx.setClipboardData({
      data: address,
      success: () => app.showSuccess('地址已复制')
    })
  },

  openWechatOfficial() {
    const { wechatOfficial } = this.data.card
    if (!wechatOfficial?.url) {
      app.showError('暂无公众号链接')
      return
    }
    
    wx.setClipboardData({
      data: wechatOfficial.url,
      success: () => {
        app.showSuccess('链接已复制，请在微信中打开')
      },
      fail: () => app.showError('复制失败')
    })
  },

  openCompanyWebsite() {
    const { companyWebsite } = this.data.card
    if (!companyWebsite?.url) {
      app.showError('暂无公司主页链接')
      return
    }

    wx.setClipboardData({
      data: companyWebsite.url,
      success: () => {
        wx.showModal({
          title: '链接已复制',
          content: '请在浏览器中粘贴并打开该公司主页',
          showCancel: false,
          confirmText: '好的'
        })
      },
      fail: () => app.showError('复制失败')
    })
  },

  downloadAttachment(e) {
    const url = e.currentTarget.dataset.url
    const name = e.currentTarget.dataset.name
    
    if (!url) {
      app.showError('文件不存在')
      return
    }
    
    app.showLoading('下载中...')
    
    wx.cloud.downloadFile({
      fileID: url,
      success: (res) => {
        app.hideLoading()
        app.showSuccess('下载成功')
        
        wx.showActionSheet({
          itemList: ['查看文件'],
          success: () => {
            wx.openDocument({
              filePath: res.tempFilePath,
              fileName: name,
              success: () => console.log('[Preview] 打开文件成功'),
              fail: () => app.showError('无法打开文件')
            })
          }
        })
      },
      fail: () => {
        app.hideLoading()
        app.showError('下载失败，请重试')
      }
    })
  },

  shareCard() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage']
    })
  },

  saveToContact() {
    const { card } = this.data
    
    if (!card.phone) {
      app.showError('请先填写电话号码')
      return
    }

    if (!card.name) {
      app.showError('请先填写姓名')
      return
    }

    app.showLoading('保存中...')

    wx.addPhoneContact({
      photoFilePath: card.avatar || '',
      nickName: card.name,
      firstName: card.name,
      lastName: '',
      remark: card.position ? `${card.position}@${card.company || ''}` : card.company || '科博名片',
      mobilePhoneNumber: card.phone,
      weChatNumber: '',
      email: card.email || '',
      addressState: '',
      addressCity: '',
      addressStreet: card.address || '',
      organization: card.company || '',
      title: card.position || '',
      workPhone: '',
      homePhone: '',
      faxNumber: '',
      url: '',
      success: () => {
        app.hideLoading()
        app.showSuccess('保存成功')
      },
      fail: (err) => {
        app.hideLoading()
        this.handleContactSaveError(err)
      }
    })
  },

  handleContactSaveError(err) {
    console.error('[Preview] 保存通讯录失败:', err)
    const errMsg = err.errMsg || ''
    
    if (errMsg.includes('cancel')) {
      app.showError('已取消')
    } else if (errMsg.includes('auth deny') || errMsg.includes('permission')) {
      wx.showModal({
        title: '权限不足',
        content: '需要授权访问通讯录权限才能保存，请在设置中开启权限',
        showCancel: false
      })
    } else {
      app.showError('保存失败，请重试')
    }
  },

  goToEdit() {
    if (!this.data.id) return
    wx.navigateTo({
      url: `/pages/edit/index?id=${this.data.id}`,
      fail: () => app.showError('跳转失败')
    })
  },

  confirmDelete() {
    this.setData({ showDeleteConfirm: true })
  },

  cancelDelete() {
    this.setData({ showDeleteConfirm: false })
  },

  deleteCard() {
    if (!this.data.id) return

    this.setData({ showDeleteConfirm: false })
    app.showLoading('删除中...')

    wx.cloud.database().collection('cards').doc(this.data.id).remove()
      .then(() => {
        app.hideLoading()
        app.showSuccess('删除成功')
        setTimeout(() => wx.navigateBack(), 1500)
      })
      .catch(err => {
        app.hideLoading()
        console.error('[Preview] 删除失败:', err)
        app.showError('删除失败，请重试')
      })
  }
})
