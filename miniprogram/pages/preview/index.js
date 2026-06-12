const app = getApp()

// 【优化】导入分享卡片生成工具模块
var shareCard = require('../../utils/shareCard')

Page({
  data: {
    card: {},
    id: '',
    isLoading: true,
    isError: false,
    errorMsg: '',
    showDeleteConfirm: false,
    isOwner: false,
    isSaved: false,
    showAuthBanner: false
  },

  onLoad(options) {
    console.log('[Preview] onLoad, options:', options)
    
    const id = options?.id || ''
    this._shareOptions = options  // 保存分享参数供 loadCard 回调使用
    this._shareImagePath = ''     // 【优化】分享卡片图片缓存路径
    this._isGeneratingShare = false
    this.setData({ id, isLoading: !!id })
    
    if (id) {
      this.loadCard(id)
      this.initShareMenu()
    }
  },

  // 记录访问（用于访客统计）+ 匿名访客身份识别
  recordVisit(cardId, options) {
    if (!wx.cloud) return

    var cardData = this.data.card
    var that = this

    // 使用 app.getOpenId()（带缓存，解析路径正确）
    app.getOpenId().then(function (visitorOpenId) {
      if (!visitorOpenId) return

      // 不记录自己访问自己的名片
      var cardOwnerId = cardData._openid || ''
      if (visitorOpenId === cardOwnerId) {
        console.log('[Preview] 跳过自有名片访问记录')
        return
      }

      // 调用 initVisits 云函数记录访问（云函数端会做三级身份 enrichment）
      wx.cloud.callFunction({
        name: 'initVisits',
        data: {
          action: 'recordVisit',
          data: {
            cardId: cardId,
            visitorOpenId: visitorOpenId,
            cardOwnerId: cardOwnerId,
            source: options && options.source || 'direct'
          }
        },
        success: function (result) {
          console.log('[Preview] 访问记录成功:', result)
          // 云函数返回 visitorLevel，用于决定是否展示授权引导
          var res = result.result || {}
          if (res.visitorLevel && res.visitorLevel < 2) {
            that._checkAuthBanner()
          }
        },
        fail: function (err) {
          // 云函数未部署时静默忽略
          console.warn('[Preview] 访问记录失败（云函数未部署）:', err)
        }
      })
    }).catch(function (err) {
      console.warn('[Preview] 获取 openId 失败:', err)
    })
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
    var card = this.data.card
    var path = '/pages/preview/index?id=' + this.data.id + '&source=share'

    // 【P0修复】imageUrl 优先级:
    //   1. Canvas 生成的分享卡片 (wxfile:// 本地路径，微信可识别)
    //   2. 已解析的 HTTPS 头像 (resolveCloudUrls 转换后)
    //   3. 空值 (让微信生成默认灰色卡片)
    //   ❌ cloud:// 格式绝不能传入——微信分享 API 无法识别
    var imageUrl = this._shareImagePath || ''
    if (!imageUrl) {
      var avatar = card.avatar || ''
      // 只使用 HTTPS 头像，过滤掉 cloud:// 和本地路径
      if (avatar.indexOf('https://') === 0) {
        imageUrl = avatar
      }
    }

    return {
      title: (card.name || '名片') + ' - ' + (card.company || ''),
      path: path,
      imageUrl: imageUrl
    }
  },

  onShareTimeline() {
    var card = this.data.card
    var imageUrl = this._shareImagePath || ''
    if (!imageUrl) {
      var avatar = card.avatar || ''
      if (avatar.indexOf('https://') === 0) {
        imageUrl = avatar
      }
    }

    return {
      title: (card.name || '名片') + ' - ' + (card.company || ''),
      query: 'id=' + this.data.id,
      imageUrl: imageUrl
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
          var card = {
            ...res.data,
            experiences: res.data.experiences || [],
            attachments: res.data.attachments || [],
            personalIntro: res.data.personalIntro || '',
            businessIntro: res.data.businessIntro || '',
            wechatOfficial: res.data.wechatOfficial || {},
            companyWebsite: res.data.companyWebsite || {},
            publicSettings: res.data.publicSettings || {}
          }

          this.setData({
            card: card,
            isLoading: false,
            isError: false
          })

          // 记录访问（在卡片数据就绪后调用，确保 cardOwnerId 正确）
          this.recordVisit(id, this._shareOptions || {})

          // 转换云文件 cloud:// ID 为临时 HTTPS URL（跨设备名片分享时头像可见性修复）
          this._resolveCardAvatar(card)

          // 【P2修复】并行启动分享卡片 Canvas 生成
          // shareCard.js 内部已独立处理 cloud:// → HTTPS 转换，
          // 无需等待 _resolveCardAvatar 完成，缩短分享按钮空窗期
          this._generateShareCard()

          // 判断名片所有权和保存状态
          this._checkCardOwnership(id)
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

  /**
   * 将名片中的 cloud:// 头像 ID 转换为 HTTPS URL
   * 修复跨设备分享时头像不可见的问题
   * 【P2修复】_generateShareCard 已移至 loadCard 并行触发，此处仅负责页面头像解析
   */
  _resolveCardAvatar(card) {
    var avatar = card.avatar
    if (!avatar || avatar.indexOf('cloud://') !== 0) {
      // 非 cloud:// 头像，无需解析
      return
    }

    app.resolveCloudFileIDs([avatar]).then(function (urlMap) {
      var resolvedUrl = urlMap[avatar]
      if (resolvedUrl) {
        this.setData({ 'card.avatar': resolvedUrl })
      }
    }.bind(this))
  },

  /**
   * 检查名片所有权和保存状态
   */
  _checkCardOwnership(cardId) {
    app.getOpenId().then((myOpenId) => {
      var cardOwnerId = this.data.card._openid || ''
      var isOwner = cardOwnerId === myOpenId

      if (isOwner) {
        this.setData({ isOwner: true, isSaved: false })
        return
      }

      // 不是自己的名片 → 检查是否已保存过
      this._checkSaveStatus(cardId)
    }).catch(() => {
      // 无法获取 openId 时默认为非自有名片，未保存
      this.setData({ isOwner: false, isSaved: false })
      this._checkSaveStatus(cardId)
    })
  },

  /**
   * 检查 user_save_cards 中是否存在保存记录
   */
  _checkSaveStatus(cardId) {
    if (!wx.cloud) {
      this.setData({ isOwner: false, isSaved: false })
      return
    }

    var db = wx.cloud.database()
    db.collection('user_save_cards')
      .where({ cardId: cardId })
      .limit(1)
      .get()
      .then((res) => {
        this.setData({ isSaved: res.data && res.data.length > 0 })
      })
      .catch(() => {
        this.setData({ isSaved: false })
      })
  },

  /**
   * 保存他人名片到自己的名片夹
   */
  saveCard() {
    var card = this.data.card
    var cardId = this.data.id
    if (!cardId || !wx.cloud) return
    if (this.data.isSaved) return

    app.showLoading('保存中...')

    var db = wx.cloud.database()

    // 防重复：先检查是否已保存过
    db.collection('user_save_cards').where({ cardId: cardId }).count()
      .then(function (res) {
        if (res.total > 0) {
          app.hideLoading()
          this.setData({ isSaved: true })
          app.showSuccess('已保存过此名片')
          return Promise.reject('duplicate')
        }
        // 获取 openId 后写入
        return wx.cloud.callFunction({ name: 'getOpenId', data: {} })
      }.bind(this))
      .then((res) => {
        var myOpenId = (res.result && res.result.data && res.result.data.openid) || ''
        if (!myOpenId) {
          app.hideLoading()
          app.showError('保存失败，请重试')
          return Promise.reject('no_openid')
        }
        return db.collection('user_save_cards').add({
          data: {
            cardId: cardId,
            cardOwnerOpenId: card._openid || '',
            savedAt: new Date()
          }
        })
      })
      .then(() => {
        app.hideLoading()
        this.setData({ isSaved: true })
        app.showSuccess('已保存到名片夹')
      })
      .catch((err) => {
        app.hideLoading()
        if (err === 'duplicate') return
        console.error('[Preview] 保存名片失败:', err)
        app.showError('保存失败，请重试')
      })
  },

  /**
   * 从名片夹中移除已保存的名片
   */
  unsaveCard() {
    var cardId = this.data.id
    if (!cardId || !wx.cloud) return

    app.showLoading('移除中...')

    var db = wx.cloud.database()
    db.collection('user_save_cards')
      .where({ cardId: cardId })
      .get()
      .then((res) => {
        if (!res.data || res.data.length === 0) {
          app.hideLoading()
          this.setData({ isSaved: false })
          return Promise.reject('not_found')
        }
        // 删除所有匹配的记录（理论上只有一条）
        var deletePromises = res.data.map((doc) => {
          return db.collection('user_save_cards').doc(doc._id).remove()
        })
        return Promise.all(deletePromises)
      })
      .then(() => {
        app.hideLoading()
        this.setData({ isSaved: false })
        app.showSuccess('已从名片夹移除')
      })
      .catch((err) => {
        app.hideLoading()
        if (err === 'not_found') return
        console.error('[Preview] 移除名片失败:', err)
        app.showError('移除失败，请重试')
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

  /**
   * 级联删除名片：通过云函数清理 cards + user_save_cards + visits + 云存储文件
   */
  deleteCard() {
    if (!this.data.id) return

    this.setData({ showDeleteConfirm: false })
    app.showLoading('删除中...')

    wx.cloud.callFunction({
      name: 'deleteCard',
      data: { cardId: this.data.id }
    }).then((res) => {
      app.hideLoading()
      var result = res.result || {}
      if (result.ok) {
        app.showSuccess('删除成功')
      } else if (result.allSettled && result.failedCount > 0) {
        // 部分失败 → 仍算基本成功（数据库记录已删）
        app.showSuccess('名片已删除')
        console.warn('[Preview] 部分关联数据清理失败:', result.results)
      } else {
        app.showError(result.message || '删除失败，请重试')
        return
      }
      setTimeout(() => wx.navigateBack(), 1500)
    }).catch((err) => {
      app.hideLoading()
      console.error('[Preview] deleteCard 云函数调用失败:', err)

      // 降级：云函数未部署时直接删 cards 文档
      wx.cloud.database().collection('cards').doc(this.data.id).remove()
        .then(() => {
          app.showSuccess('删除成功（云函数未部署，关联数据未清理）')
          setTimeout(() => wx.navigateBack(), 1500)
        })
        .catch((fallbackErr) => {
          console.error('[Preview] 降级删除也失败:', fallbackErr)
          app.showError('删除失败，请重试')
        })
    })
  },

  retryLoad() {
    const id = this.data.id
    if (!id) return
    this.setData({ isError: false, isLoading: true })
    this.loadCard(id)
  },

  /**
   * 头像加载失败时的降级处理：替换为默认头像
   * 【P1修复】防护异步竞争: 如果 _resolveCardAvatar 已将 cloud://
   * 成功解析为 HTTPS URL，则 onAvatarError 不应覆盖它。
   * <image> 在 src 切换后旧请求可能延迟触发 error 回调。
   */
  onAvatarError() {
    var currentAvatar = this.data.card.avatar || ''
    // _resolveCardAvatar 已成功解析 → 不做降级（当前 HTTPS URL 有效，旧 cloud:// 失败是预期的）
    if (currentAvatar.indexOf('https://') === 0) {
      console.log('[Preview] 头像 URL 已解析为 HTTPS，忽略旧 cloud:// 的 error 回调')
      return
    }
    this.setData({ 'card.avatar': '/images/avatar.png' })
  },

  stopPropagation() {},

  // =========================================================================
  // 【新增】分享卡片生成
  // =========================================================================

  /**
   * 在 Canvas 上生成方案A「经典商务风」分享卡片图片
   * 【优化】异步非阻塞——生成过程中不影响正常交互
   * 生成结果缓存到 this._shareImagePath，供分享回调使用
   */
  _generateShareCard() {
    if (this._isGeneratingShare) return
    this._isGeneratingShare = true

    var that = this
    var card = this.data.card

    shareCard.generate('#shareCanvas', card, {
      cardKey: card._id || ('share_' + this.data.id)
    }).then(function (res) {
      that._shareImagePath = res.tempFilePath
      that._isGeneratingShare = false
      console.log('[Preview] 分享卡片已生成:', res.tempFilePath)
    }).catch(function (err) {
      that._isGeneratingShare = false
      console.warn('[Preview] 分享卡片生成失败（降级使用头像）:', err && err.message)
      // 失败不阻断，分享回调会自动回退到空（微信生成默认卡片）
    })
  },

  /**
   * 检查是否需要展示匿名访客授权引导条
   * 非阻断式底部通知条，引导用户授权微信昵称/头像
   * 拒绝后 7 天内不再显示（冷却期）
   */
  _checkAuthBanner() {
    var that = this
    // 检查是否在冷却期内
    try {
      var dismissed = wx.getStorageSync('auth_banner_dismissed_at')
      if (dismissed) {
        var now = Date.now()
        var cooldownMs = 7 * 24 * 60 * 60 * 1000  // 7天冷却期
        if (now - dismissed < cooldownMs) {
          console.log('[Preview] 授权引导条处于冷却期，跳过')
          return
        }
        // 冷却期已过，清除记录
        wx.removeStorageSync('auth_banner_dismissed_at')
      }
    } catch (e) {}

    // 弹授权引导条前等待 3 秒，避免与页面渲染争抢
    setTimeout(function () {
      that.setData({ showAuthBanner: true })
    }, 3000)
  },

  /**
   * 用户点击「授权」→ 获取微信用户信息并写入 visitor_profiles 集合
   */
  onAuthUserInfo() {
    var that = this
    this.setData({ showAuthBanner: false })

    wx.getUserProfile({
      desc: '用于在您查看名片时展示您的微信昵称',
      success: function (res) {
        var userInfo = res.userInfo || {}
        var nickname = userInfo.nickName || ''
        var avatarUrl = userInfo.avatarUrl || ''

        if (!nickname) {
          wx.showToast({ title: '授权成功', icon: 'success' })
          return
        }

        // 写入 visitor_profiles 集合
        if (wx.cloud) {
          var db = wx.cloud.database()
          // 先查是否有已有记录
          db.collection('visitor_profiles').limit(1).get()
            .then(function (profileRes) {
              if (profileRes.data && profileRes.data.length > 0) {
                // 更新已有记录
                return db.collection('visitor_profiles')
                  .doc(profileRes.data[0]._id)
                  .update({
                    data: {
                      nickname: nickname,
                      avatarUrl: avatarUrl,
                      updatedAt: new Date()
                    }
                  })
              } else {
                // 新建记录
                return db.collection('visitor_profiles').add({
                  data: {
                    nickname: nickname,
                    avatarUrl: avatarUrl,
                    createdAt: new Date(),
                    updatedAt: new Date()
                  }
                })
              }
            })
            .then(function () {
              wx.showToast({ title: '身份已更新，感谢授权', icon: 'success' })
              // 授权成功后，后续访问会自动使用 L2 身份
              console.log('[Preview] visitor_profiles 已更新')
            })
            .catch(function (err) {
              console.warn('[Preview] visitor_profiles 写入失败:', err)
              wx.showToast({ title: '授权成功', icon: 'success' })
            })
        }
      },
      fail: function (err) {
        console.log('[Preview] 用户拒绝授权:', err)
        // 拒绝授权也记录冷却期
        try {
          wx.setStorageSync('auth_banner_dismissed_at', Date.now())
        } catch (e) {}
        wx.showToast({ title: '已跳过', icon: 'none' })
      }
    })
  },

  /**
   * 关闭授权引导条（暂不授权）
   * 记录冷却期时间戳，7 天内不重复展示
   */
  dismissAuthBanner() {
    this.setData({ showAuthBanner: false })
    try {
      wx.setStorageSync('auth_banner_dismissed_at', Date.now())
    } catch (e) {}
  }
})
