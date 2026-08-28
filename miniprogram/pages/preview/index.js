const app = getApp()
const storage = require('../../config/storage')
const team = require('../../utils/team')
const { FIELD_LABELS } = require('../../config/cardVisibility')

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
    showAuthBanner: false,
    // P2/D5：服务端卡片视图返回的分级状态
    isAuthorized: false,
    lockedFields: [],
    fieldVisibility: {},
    fieldLabel: FIELD_LABELS,
    // 授权弹窗（微信原生 chooseAvatar + nickname）
    showAuthModal: false,
    authNickname: '',
    authAvatar: '',
    // 访客分析（按单卡维度，仅名片主人可见）
    visitorStats: { visitors: 0, viewed: 0 },
    recentVisitors: [],
    // 团队徽章（T12）：名片所属团队 + 托管字段覆盖层
    teamBadges: [],
    showTeamCard: false,
    teamCardView: null,
    teamCardName: '',
    // 公众号二维码弹窗（长按识别关注）
    showOfficialQR: false,
    officialQRUrl: ''
  },

  onLoad(options) {

    const id = options?.id || ''
    this._shareOptions = options  // 保存分享参数供 recordVisit 使用
    this._fromTeamId = options?.teamId || ''  // 从团队详情跳入时携带，用于自动展开「该团队下的托管名片」
    this.setData({ id, isLoading: !!id })

    if (id) {
      this.loadCard(id)
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
          // 授权引导改由 loadCard 的 getCardView 返回 isAuthorized 统一判定（P2/D5）
          // recordVisit 保持原有采集逻辑（P3 才收敛），此处不再触发 banner
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
    // 从编辑页返回时，名片数据可能已变更，总是重新加载
    if (this.data.id) {
      this.setData({ isError: false, isLoading: true })
      this.loadCard(this.data.id)
    }
  },

  onUnload() {
    if (this._loadTimer) {
      clearTimeout(this._loadTimer)
      this._loadTimer = null
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

    this._loadTimer = setTimeout(() => {
      console.warn('[Preview] 加载超时')
      this.setData({
        isLoading: false,
        isError: true,
        errorMsg: '加载超时，请重试'
      })
    }, 10000)

    var that = this
    // D5：访客读卡改走服务端云函数 getCardView，按 fieldVisibility 只下发可见字段
    wx.cloud.callFunction({
      name: 'initVisits',
      data: { action: 'getCardView', data: { cardId: id } },
      success: function (res) {
        clearTimeout(that._loadTimer)
        var r = res.result || {}
        if (!r.ok || !r.card) {
          that.setData({
            isLoading: false,
            isError: true,
            errorMsg: r.message || '名片不存在'
          })
          return
        }
        var card = Object.assign({}, r.card, {
          experiences: r.card.experiences || [],
          attachments: r.card.attachments || [],
          personalIntro: r.card.personalIntro || '',
          businessIntro: r.card.businessIntro || '',
          wechatOfficial: r.card.wechatOfficial || {},
          companyWebsite: r.card.companyWebsite || {},
          publicSettings: r.card.publicSettings || {}
        })

        that.setData({
          card: card,
          isOwner: r.isOwner,
          isAuthorized: r.isAuthorized,
          lockedFields: r.lockedFields || [],
          fieldVisibility: r.fieldVisibility || {},
          isLoading: false,
          isError: false
        })

        // 记录访问（在卡片数据就绪后调用，确保 cardOwnerId 正确）
        that.recordVisit(id, that._shareOptions || {})

        // 转换云文件 cloud:// ID 为临时 HTTPS URL（跨设备名片分享时头像可见性修复）
        that._resolveCardAvatar(card)

        // 判断名片所有权和保存状态
        that._checkCardOwnership(id)

        // 加载团队徽章（跨用户读，经 teamManager 云函数 admin 上下文）
        that._loadTeamBadges(id)

        // 若是「从团队详情点成员名片」跳入，自动展开该团队下的托管名片视图
        if (that._fromTeamId) that._autoOpenTeamCard(id)

        // 未授权访客 → 展示授权引导（替代原 visitorLevel<2 判定）
        if (!r.isAuthorized && !r.isOwner) {
          that._checkAuthBanner()
        }
      },
      fail: function (err) {
        clearTimeout(that._loadTimer)
        console.error('[Preview] getCardView 调用失败:', err)
        that.setData({
          isLoading: false,
          isError: true,
          errorMsg: '加载失败，请重试'
        })
      }
    })
  },

  /**
   * 将名片中的 cloud:// 头像 ID 转换为 HTTPS URL
   * 修复跨设备查看时头像不可见的问题
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
      } else {
        // 云函数未部署或无权限时，兜底为默认头像
        console.warn('[Preview] cloud:// 头像解析失败，使用默认头像')
        this.setData({ 'card.avatar': '/images/avatar.png' })
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
        this.loadVisitorAnalytics(cardId, cardOwnerId)
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
   * 加载本名片的访客分析（仅名片主人调用，按单卡维度聚合）
   * 调用 initVisits 的 getMyVisitorStats + getRecentVisitors，均带 cardId
   */
  loadVisitorAnalytics(cardId, cardOwnerId) {
    if (!wx.cloud || !cardOwnerId || !cardId) return
    var that = this
    wx.cloud.callFunction({
      name: 'initVisits',
      data: { action: 'getMyVisitorStats', data: { cardOwnerId: cardOwnerId, cardId: cardId } }
    }).then(function (statsRes) {
      if (statsRes.result && statsRes.result.ok) {
        that.setData({
          'visitorStats.visitors': statsRes.result.visitors || 0,
          'visitorStats.viewed': statsRes.result.viewed || 0
        })
      }
      return wx.cloud.callFunction({
        name: 'initVisits',
        data: { action: 'getRecentVisitors', data: { cardOwnerId: cardOwnerId, cardId: cardId, limit: 5 } }
      })
    }).then(function (res) {
      if (res.result && res.result.ok) {
        that._processRecentVisitors(res.result.list || [])
      } else {
        that.setData({ recentVisitors: [] })
      }
    }).catch(function () {
      that.setData({ recentVisitors: [] })
    })
  },

  _processRecentVisitors(list) {
    const visitors = (list || []).map((v) => ({
      id: v._id,
      visitorOpenId: v.visitorOpenId || '',
      name: v.visitorName || ('访客 #' + (v.visitorOpenId || '').slice(-4).toUpperCase()),
      avatar: storage.resolveCloudUrl(v.visitorAvatar),
      visitCount: v.visitCount || 1,
      visitorLevel: v.visitorLevel || 1,
      cardName: v.cardName || '',
      lastVisit: app.formatTime(v.visitTime)
    }))
    const merged = this._mergeVisitorsByOpenId(visitors)
    this.setData({ recentVisitors: merged })
  },

  _mergeVisitorsByOpenId(visitors) {
    const map = {}
    visitors.forEach((v) => {
      const key = v.visitorOpenId || ('anon_' + v.id)
      if (!map[key]) {
        map[key] = { ...v }
      } else {
        map[key].visitCount = (map[key].visitCount || 1) + (v.visitCount || 1)
      }
    })
    return Object.values(map)
  },

  /**
   * 从详情页跳转到访客页（带 cardId，按本名片筛选）
   */
  goToVisitorAnalytics() {
    const id = this.data.id
    if (!id) return
    wx.navigateTo({
      url: '/pages/visitors/index?cardId=' + id,
      fail: (err) => {
        console.error('[Preview] 跳转访客页失败:', err)
        app.showError('跳转失败')
      }
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
        // 获取 openId 后写入（收敛到 app 层，复用缓存与默认 action）
        return app.getOpenId()
      }.bind(this))
      .then((myOpenId) => {
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
            success: () => app.showSuccess('号码已复制'),
            fail: (err) => {
              if (!app.showPrivacyError(err)) app.showError('复制失败')
            }
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
      success: () => app.showSuccess('邮箱已复制'),
      fail: (err) => {
        if (!app.showPrivacyError(err)) app.showError('复制失败')
      }
    })
  },

  handleAddress() {
    const address = this.data.card.address
    if (!address) return
    
    wx.setClipboardData({
      data: address,
      success: () => app.showSuccess('地址已复制'),
      fail: (err) => {
        if (!app.showPrivacyError(err)) app.showError('复制失败')
      }
    })
  },

  openWechatOfficial() {
    const { wechatOfficial } = this.data.card
    if (!wechatOfficial || !wechatOfficial.qrcode) {
      app.showError('请上传公众号二维码')
      return
    }
    // 展示二维码：点击弹出，访客长按识别关注（合规路径）
    this.setData({ showOfficialQR: true, officialQRUrl: wechatOfficial.qrcode })
  },

  closeOfficialQR() {
    this.setData({ showOfficialQR: false, officialQRUrl: '' })
  },

  // 阻止冒泡：点击弹窗内部不关闭
  noop() {},

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
      fail: (err) => {
        if (!app.showPrivacyError(err)) app.showError('复制失败')
      }
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
              success: () => {},
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
      remark: card.position ? `${card.position}@${card.company || ''}` : card.company || '投贴儿',
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
    // 隐私协议拒绝（errCode 103/104）
    if (app.showPrivacyError(err)) return

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
      return
    }
    this.setData({ 'card.avatar': '/images/avatar.png' })
  },

  stopPropagation() {},

  /**
   * 检查是否需要展示匿名访客授权引导条
   * 非阻断式底部通知条，引导用户授权微信昵称/头像
   * 当天内拒绝后不再显示（冷却期：同一自然日）
   */
  _checkAuthBanner() {
    var that = this
    // 检查是否在冷却期内（当天拒绝过）
    try {
      var dismissedDate = wx.getStorageSync('auth_banner_dismissed_date')
      if (dismissedDate) {
        var today = new Date()
        var todayStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate()
        if (dismissedDate === todayStr) {
          return
        }
        // 非今日 → 清除旧记录
        wx.removeStorageSync('auth_banner_dismissed_date')
      }
    } catch (e) {}

    // 立即显示授权引导条（隐私同意后无需延迟）
    that.setData({ showAuthBanner: true })
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
          // 先获取 openid
          app.getOpenId().then(function (myOpenId) {
            // 查询是否有已有记录（使用 openid 字段）
            return db.collection('visitor_profiles').where({ openid: myOpenId }).limit(1).get()
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
                  // 新建记录（包含 openid 字段）
                  return db.collection('visitor_profiles').add({
                    data: {
                      openid: myOpenId,
                      nickname: nickname,
                      avatarUrl: avatarUrl,
                      createdAt: new Date(),
                      updatedAt: new Date()
                    }
                  })
                }
              })
          })
            .then(function () {
              wx.showToast({ title: '身份已更新，感谢授权', icon: 'success' })
              // 授权成功后，后续访问会自动使用 L2 身份
            })
            .catch(function (err) {
              console.warn('[Preview] visitor_profiles 写入失败:', err)
              wx.showToast({ title: '授权成功', icon: 'success' })
            })
        }
      },
      fail: function (err) {
        // 隐私协议拒绝 → 统一提示
        if (app.showPrivacyError(err)) return
        // 拒绝授权 → 记录当日冷却期
        try {
          var today = new Date()
          wx.setStorageSync('auth_banner_dismissed_date',
            today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate())
        } catch (e) {}
        wx.showToast({ title: '已跳过', icon: 'none' })
      }
    })
  },

  /**
   * 关闭授权引导条（暂不授权）
   * 记录当日日期，同一天内不重复展示
   */
  dismissAuthBanner() {
    this.setData({ showAuthBanner: false })
    try {
      var today = new Date()
      wx.setStorageSync('auth_banner_dismissed_date',
        today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate())
    } catch (e) {}
  },

  // P2/D1：打开微信原生授权弹窗
  showAuthModal() {
    this.setData({ showAuthModal: true })
  },

  closeAuthModal() {
    this.setData({ showAuthModal: false })
  },

  // 微信原生头像授权（button open-type="chooseAvatar"）
  onChooseAvatar(e) {
    this.setData({ authAvatar: (e.detail && e.detail.avatarUrl) || '' })
  },

  // 微信原生昵称输入（type="nickname" input）
  onNicknameInput(e) {
    var v = (e.detail && (e.detail.value !== undefined ? e.detail.value : e.detail.nickname)) || ''
    this.setData({ authNickname: v })
  },

  // 确认授权：调 authorizeVisit，成功后解锁授权字段
  confirmAuth() {
    var that = this
    var id = this.data.id
    if (!id) return
    wx.cloud.callFunction({
      name: 'initVisits',
      data: {
        action: 'authorizeVisit',
        data: {
          cardId: id,
          nickname: this.data.authNickname,
          avatarUrl: this.data.authAvatar
        }
      },
      success: function (res) {
        var r = res.result || {}
        if (r.ok) {
          that.setData({
            card: Object.assign({}, r.card, {
              experiences: r.card.experiences || [],
              attachments: r.card.attachments || [],
              personalIntro: r.card.personalIntro || '',
              businessIntro: r.card.businessIntro || '',
              wechatOfficial: r.card.wechatOfficial || {},
              companyWebsite: r.card.companyWebsite || {}
            }),
            isAuthorized: true,
            lockedFields: [],
            showAuthModal: false
          })
          wx.showToast({ title: '已解锁完整名片', icon: 'success' })
        } else {
          wx.showToast({ title: r.message || '授权失败', icon: 'none' })
        }
      },
      fail: function (err) {
        console.error('[Preview] authorizeVisit 调用失败:', err)
        wx.showToast({ title: '授权失败，请重试', icon: 'none' })
      }
    })
  },

  /**
   * 加载名片所属团队的徽章（跨用户读：经 teamManager 云函数 admin 上下文）
   * 用于姓名下方一排轻量徽章；点击徽章查看「团队名片视图」（card + managedFields 覆盖层合并）
   */
  _loadTeamBadges(cardId) {
    if (!cardId) return
    team.callTeamManager('getCardTeams', { cardId }).then((res) => {
      if (res.success && res.data.teams) {
        this.setData({ teamBadges: res.data.teams })
      }
    }).catch(function () {})
  },

  /**
   * 打开「团队名片视图」：个人 card 为真相源 + team_members.managedFields 覆盖层合并
   */
  openTeamCard(e) {
    const index = e.currentTarget.dataset.index
    const badge = this.data.teamBadges[index]
    if (!badge) return
    const merged = team.mergeCardWithTeam(this.data.card, badge.managedFields)
    this.setData({
      showTeamCard: true,
      teamCardView: merged,
      teamCardName: (badge.team && badge.team.name) || '团队'
    })
  },

  /**
   * 从名片页直达团队详情：取当前徽章所属 teamId（优先 dataset.teamId，回退 teamBadges[index].teamId）
   */
  goToTeamDetail(e) {
    const ds = e.currentTarget.dataset
    const id = ds.teamId || (this.data.teamBadges[ds.index] && this.data.teamBadges[ds.index].teamId)
    if (!id) return
    wx.navigateTo({
      url: '/pages/team/detail?id=' + id,
      fail: (err) => {
        console.error('[Preview] 跳转团队详情失败:', err)
        wx.showToast({ title: '跳转失败', icon: 'none' })
      }
    })
  },

  /**
   * 从团队详情点成员名片跳入时，按来源团队自动展开托管名片视图
   * 复用 openTeamCard 的弹层字段（showTeamCard / teamCardView / teamCardName）
   */
  _autoOpenTeamCard(cardId) {
    const teamId = this._fromTeamId
    if (!teamId) return
    team.callTeamManager('getCardTeams', { cardId }).then((res) => {
      if (res.success && res.data && res.data.teams) {
        const hit = res.data.teams.find(t => t.teamId === teamId)
        if (hit) {
          const merged = team.mergeCardWithTeam(this.data.card, hit.managedFields)
          this.setData({
            showTeamCard: true,
            teamCardView: merged,
            teamCardName: (hit.team && hit.team.name) || '团队'
          })
        }
      }
    }).catch(function () {})
  },

  closeTeamCard() {
    this.setData({ showTeamCard: false, teamCardView: null })
  }
})
