const app = getApp()
var storage = require('../../config/storage')
const team = require('../../utils/team')
const { DEFAULT_FIELD_VISIBILITY } = require('../../config/cardVisibility')

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
    wechatOfficial: { name: '', qrcode: '' },
    companyWebsite: { name: '', url: '' },
    errors: {},
    dragStartIndex: -1,
    dragY: 0,
    // 团队托管字段（T12）：被团队管理的个人字段 → 锁定不可编辑
    managedFieldMap: {},
    hasManagedFields: false,
    inviteCode: '',
    isJoining: false,
    // 字段级可见性（P1）：敏感字段默认 authorized，其余默认 public
    fieldVisibility: { ...DEFAULT_FIELD_VISIBILITY },
    // 首次点选可见性图标时弹气泡提示（仅一次，wx.setStorageSync 标记）
    showVisibilityTip: false,
    // 可见性图标：SVG 矢量（base64 data-URI），真机/IDE 渲染零差异
    // 三档：public(蓝地球) / authorized(绿眼睛) / private(灰锁)
    visIcons: {
      public: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiMzQjgyRjYiLz48ZWxsaXBzZSBjeD0iMTIiIGN5PSIxMiIgcng9IjUiIHJ5PSIxMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjEuNSIvPjxsaW5lIHgxPSIyIiB5MT0iMTIiIHgyPSIyMiIgeTI9IjEyIiBzdHJva2U9IiNGRkZGRkYiIHN0cm9rZS13aWR0aD0iMS41Ii8+PGxpbmUgeDE9IjEyIiB5MT0iMiIgeDI9IjEyIiB5Mj0iMjIiIHN0cm9rZT0iI0ZGRkZGRiIgc3Ryb2tlLXdpZHRoPSIxLjUiLz48L3N2Zz4=',
      authorized: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTIgMTIgUTEyIDQgMjIgMTIgUTEyIDIwIDIgMTIgWiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTBCOTgxIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIzIiBmaWxsPSIjMTBCOTgxIi8+PC9zdmc+',
      private: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHJlY3QgeD0iNCIgeT0iMTAiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxMSIgcng9IjIiIGZpbGw9IiM2NDc0OEIiLz48cGF0aCBkPSJNOCAxMCBWNyBhNCA0IDAgMCAxIDggMCBWMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzY0NzQ4QiIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+'
    },
    // 可见性状态文案（气泡提示用）
    visLabels: {
      public: '公开 — 全员可见',
      authorized: '授权后 — 对方访问名片后可见',
      private: '仅自己 — 仅本人可见'
    }
  },

  onLoad(options) {
    const id = options?.id || ''
    const isEdit = !!id
    this.setData({ id, isEdit, isLoading: isEdit })
    if (isEdit) {
      this.loadCard(id)
    }
    // 团队页：确保用户存在后加载托管字段（幂等）
    app.ensureUser().then(() => this._loadTeamManagedFields())
  },

  onUnload() {
    if (this._loadTimer) {
      clearTimeout(this._loadTimer)
      this._loadTimer = null
    }
  },

  loadCard(id) {
    if (!id || !wx.cloud) {
      this.setData({ isLoading: false })
      return
    }

    this._loadTimer = setTimeout(() => {
      this.setData({ isLoading: false })
      app.showError('加载超时，请重试')
    }, 10000)

    wx.cloud.database().collection('cards').doc(id).get()
      .then(res => {
        clearTimeout(this._loadTimer)
        if (res.data) {
          const data = res.data
          // 兼容旧数据：把 publicSettings.showXxx=false 转 fieldVisibility.X='private'
          // 新数据：直接用 fieldVisibility（服务端 filterCardByVisibility 真源），不再写入 publicSettings
          const fv = { ...DEFAULT_FIELD_VISIBILITY, ...(data.fieldVisibility || {}) }
          const oldPS = data.publicSettings || {}
          if (oldPS.showPersonalIntro === false) fv.personalIntro = 'private'
          if (oldPS.showBusinessIntro === false) fv.businessIntro = 'private'
          if (oldPS.showExperiences === false) fv.experiences = 'private'
          if (oldPS.showWechatOfficial === false) fv.wechatOfficial = 'private'
          if (oldPS.showCompanyWebsite === false) fv.companyWebsite = 'private'
          if (oldPS.showAttachments === false) fv.attachments = 'private'
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
            wechatOfficial: data.wechatOfficial || { name: '', qrcode: '' },
            companyWebsite: data.companyWebsite || { name: '', url: '' },
            fieldVisibility: fv,
            isLoading: false
          })
          // 存储治理 A3：记录「已落库头像」基线，保存成功后据此清理旧文件
          this._savedAvatar = data.avatar || ''
        } else {
          this.setData({ isLoading: false })
          app.showError('名片不存在')
          setTimeout(() => wx.navigateBack(), 1500)
        }
      })
      .catch(err => {
        clearTimeout(this._loadTimer)
        this.setData({ isLoading: false })
        app.showError('加载失败，请重试')
      })
  },

  // 打开系统相册选择图片 → 跳转裁切页
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
        // 检查是否为隐私授权拒绝（官方弹窗模式）
        if (app.showPrivacyError(err)) return
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
    const cloudPath = 'avatars/' + Date.now() + '.jpg'
    wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath,
      success: (uploadRes) => {
        app.hideLoading()
        this.setData({ avatar: uploadRes.fileID })
        // 存储治理 A3：旧头像文件不在上传时立即删除（避免用户取消/保存失败导致
        // DB 悬空引用 + 半途孤儿）。改为 saveCard 写库成功后统一删除（见 _cleanupOldAvatar）
        app.showSuccess('头像更新成功')
      },
      fail: (err) => {
        app.hideLoading()
        console.error('[Edit] 头像上传失败:', JSON.stringify(err))
        app.showError('头像上传失败，请重试')
      }
    })
  },

  // 存储治理 A3：写库成功后删除「上一版已落库头像」，多选几次头像也只留最终一张
  _cleanupOldAvatar(currentAvatar) {
    var prev = this._savedAvatar || ''
    if (prev && prev !== currentAvatar && prev.indexOf('cloud://') === 0) {
      wx.cloud.deleteFile({ fileList: [prev] })
        .then(function () {})
        .catch(function () {})
    }
    this._savedAvatar = currentAvatar || ''
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
        // 检查是否为隐私授权拒绝（官方弹窗模式）
        if (app.showPrivacyError(err)) return
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
          // 清理成功，无需处理
        })
        .catch(function () {
          // 静默失败，不影响主流程
        })
    }
  },

  // 二次确认删除名片附件（防误触）
  confirmDeleteAttachment(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const att = this.data.attachments[index]
    if (!att) return
    const name = att.name || '此附件'
    wx.showModal({
      title: '删除这个附件？',
      content: `${name} 将从名片中移除，同时删除云端文件`,
      confirmText: '删除',
      confirmColor: '#EF4444',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.deleteAttachment(e)
        }
      }
    })
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

  // 二次确认删除过往经历（防误触）
  confirmDeleteExperience(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const exp = this.data.experiences[index]
    if (!exp) return
    const label = (exp.company || exp.position) ? `${exp.company || ''}${exp.position ? ' · ' + exp.position : ''}` : '这段经历'
    wx.showModal({
      title: '删除这段经历？',
      content: `${label} 删除后将无法恢复`,
      confirmText: '删除',
      confirmColor: '#EF4444',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.deleteExperience(e)
        }
      }
    })
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

  // 上传公众号二维码：存为 cloud:// fileID（微信原生渲染 + 长按识别关注）
  onChooseOfficialQR() {
    wx.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const temp = (res.tempFilePaths && res.tempFilePaths[0]) || ''
        if (!temp) return
        app.showLoading('上传中')
        const oldQR = this.data.wechatOfficial.qrcode
        const cloudPath = 'qrcodes/' + Date.now() + '.jpg'
        wx.cloud.uploadFile({
          cloudPath,
          filePath: temp,
          success: (up) => {
            app.hideLoading()
            this.setData({
              wechatOfficial: Object.assign({}, this.data.wechatOfficial, { qrcode: up.fileID })
            })
            if (oldQR && oldQR.indexOf('cloud://') === 0) {
              wx.cloud.deleteFile({ fileList: [oldQR] }).catch(function () {})
            }
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
        if (app.showPrivacyError(err)) return
        app.showError('选择图片失败')
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

  // P1 字段级可见性三态切换：public / authorized / private
  onVisibilityChange(e) {
    const field = e.currentTarget.dataset.field
    const value = e.currentTarget.dataset.value
    if (!field || !value) return
    this.setData({ [`fieldVisibility.${field}`]: value })
  },

  // 可见性图标点击：3 档循环切换（仅自己 → 授权后 → 公开 → 仅自己）
  // 弹出气泡显示当前态含义（用户已学会后可选关闭）
  onVisibilityIconTap(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    const current = this.data.fieldVisibility[field] || 'public'
    const next = current === 'private' ? 'authorized' : current === 'authorized' ? 'public' : 'private'
    this.setData({ [`fieldVisibility.${field}`]: next })
    this._showVisibilityTip(this.data.visLabels[next])
  },

  _showVisibilityTip(text) {
    if (this._visTipTimer) clearTimeout(this._visTipTimer)
    this.setData({ showVisibilityTip: text })
    this._visTipTimer = setTimeout(() => {
      this.setData({ showVisibilityTip: false })
      this._visTipTimer = null
    }, 1800)
  },

  clearError(field) {
    const errors = { ...this.data.errors }
    delete errors[field]
    this.setData({ errors })
  },

  validate() {
    const errors = {}
    // v1.5.4 必填项收敛：仅 姓名 / 电话 / 邮箱 必填（含格式校验）
    // 公司 / 职位 等组织字段改为选填 —— 部分团队用户并非公司职员
    if (!this.data.name.trim()) errors.name = '请输入姓名'
    if (!this.data.phone.trim()) {
      errors.phone = '请输入手机号码'
    } else if (!/^1[3-9]\d{9}$/.test(this.data.phone)) {
      errors.phone = '请输入正确的手机号码'
    }
    if (!this.data.email.trim()) {
      errors.email = '请输入邮箱地址'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.data.email)) {
      errors.email = '请输入正确的邮箱地址'
    }
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
      // v1.5.4 配置一致性收敛：服务端只认 fieldVisibility 物理过滤 cards；废弃 publicSettings
      fieldVisibility: this.data.fieldVisibility,
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
      .then((res) => {
        this.setData({ isSaving: false })
        app.showSuccess(this.data.isEdit ? '修改成功' : '创建成功')

        // 存储治理 A3：写库成功后再清理上一版已落库头像（消除「先删后存」竞态）
        this._cleanupOldAvatar(data.avatar)

        // 同步更新 visitor_profiles：创建/编辑名片后升级为 L3 卡片用户身份
        if (!this.data.isEdit) {
          this._syncVisitorProfile()
        }

        // 通知首页/预览页数据已变更，强制刷新
        app.setCache('lastCardUpdate', Date.now())
        app.setCache('cardsNeedRefresh', true)

        // 生成分享卡片图片：等待完成后再跳转（避免页面销毁导致 Canvas 中断）
        var cardId = this.data.id || (res && res._id)
        var cardData = Object.assign({}, data, { _id: cardId })
        return this._generateAndStoreShareImage(cardData).then(
          function () {
            // 分享图生成完成，跳转回首页
            setTimeout(function () { wx.navigateBack() }, 300)
          },
          function (err) {
            // 生成失败也不阻塞用户返回
            console.warn('[Edit] 分享图生成失败，跳过:', err && err.message)
            setTimeout(function () { wx.navigateBack() }, 300)
          }
        )
      })
      .catch(() => {
        this.setData({ isSaving: false })
        app.showError('保存失败，请重试')
      })
  },

  /**
   * 生成分享卡片图片 → 上传云存储 → 存入卡片 shareImageUrl
   * 返回 Promise：成功 resolve(cloudFileID)，失败 reject(error)
   * shareImageUrl 使用 cloud:// fileID 格式，微信自动做跨用户权限代理
   * 最长等待 15 秒，超时 reject 但不阻塞用户操作
   */
  _generateAndStoreShareImage(cardData) {
    var that = this
    var cardId = cardData._id
    var shareCard = require('../../utils/shareCard')
    var GEN_TIMEOUT = 15000  // 15 秒总超时（Canvas + 上传 + DB）

    return new Promise(function (resolve, reject) {
      var settled = false
      var timer = setTimeout(function () {
        if (settled) return
        settled = true
        console.warn('[Edit] 分享图生成超时')
        reject(new Error('timeout'))
      }, GEN_TIMEOUT)

      // 延迟等 Canvas 节点挂载（100ms 足够，之前 800ms 过度保守）
      setTimeout(function () {
        if (settled) return
        shareCard.generate('shareCanvas', cardData, {
          cardKey: cardId,
          pageContext: that
        }).then(function (res) {
          if (settled) return
          var cloudPath = 'sharecards/card_' + cardId + '.jpg'
          wx.cloud.uploadFile({
            cloudPath: cloudPath,
            filePath: res.tempFilePath,
            success: function (uploadRes) {
              if (settled) return
              // 使用 HTTPS CDN URL（存储为所有用户可读，跨设备可靠）
              // cloud:// 格式在 WeChat 2.8.1+ 声称支持但实测接收方不可见
              var cloudFileID = uploadRes.fileID
              var shareUrl = storage.resolveCloudUrl(cloudFileID)
              wx.cloud.database().collection('cards').doc(cardId).update({
                data: { shareImageUrl: shareUrl, shareImageFileID: cloudFileID }
              }).then(function () {
                if (settled) return
                settled = true
                clearTimeout(timer)
                resolve(shareUrl)
              }).catch(function (e) {
                if (settled) return
                settled = true
                clearTimeout(timer)
                console.warn('[Edit] shareImageUrl 更新失败:', e)
                reject(new Error('db_update_failed'))
              })
            },
            fail: function (e) {
              if (settled) return
              settled = true
              clearTimeout(timer)
              console.warn('[Edit] 分享图上传失败:', e)
              reject(new Error('upload_failed'))
            }
          })
        }).catch(function (err) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          console.warn('[Edit] 分享图 Canvas 生成失败:', err && err.message)
          reject(err || new Error('canvas_failed'))
        })
      }, 100)  // 短延迟，Canvas 节点已挂载
    })
  },

  /**
   * 同步更新 visitor_profiles：创建名片后将用户的真实姓名和头像写入
   * 之后他人查看此用户的名片时，initVisits 云函数将识别为 L3 卡片用户
   */
  _syncVisitorProfile() {
    if (!wx.cloud) return
    var that = this
    app.getOpenId().then(function (myOpenId) {
      if (!myOpenId) return
      var db = wx.cloud.database()
      var profileData = {
        nickname: that.data.name.trim(),
        avatarUrl: that.data.avatar || '',
        updatedAt: new Date()
      }
      // 先查是否存在 → upsert
      db.collection('visitor_profiles').where({ openid: myOpenId }).limit(1).get()
        .then(function (res) {
          if (res.data && res.data.length > 0) {
            return db.collection('visitor_profiles').doc(res.data[0]._id).update({ data: profileData })
          } else {
            return db.collection('visitor_profiles').add({
              data: Object.assign({ openid: myOpenId, createdAt: new Date() }, profileData)
            })
          }
        })
        .then(function () {
          // 同步成功
        })
        .catch(function (err) {
          console.warn('[Edit] visitor_profiles 同步失败:', err)
        })
    }).catch(function () {})
  },

  /**
   * 加载团队托管字段：判断哪些个人字段正被团队管理（锁定不可编辑）
   * 数据来源 getMyTeams（已含 managedFields），仅判定
   * company / position / companyWebsite 三类个人组织字段
   */
  _loadTeamManagedFields() {
    team.callTeamManager('getMyTeams').then((res) => {
      if (!res.success || !res.data.teams) return
      const map = {}
      res.data.teams.forEach((t) => {
        const mf = t.managedFields || {}
        // 仅个人名片存在的组织字段可被团队托管覆盖
        if (mf.company) map.company = t.name
        if (mf.position) map.position = t.name
        if (mf.website) map.companyWebsite = t.name
      })
      this.setData({
        managedFieldMap: map,
        hasManagedFields: Object.keys(map).length > 0
      })
    }).catch(function () {})
  },

  onInviteCodeInput(e) {
    this.setData({ inviteCode: e.detail.value.replace(/\s/g, '').toUpperCase() })
  },

  /**
   * 建卡时加入团队（路径 C）：粘贴邀请码 → joinByInvite
   * 云函数按 _openid 自动定位名片（防伪造），将此名片关联团队
   */
  joinTeam() {
    const code = (this.data.inviteCode || '').trim().toUpperCase()
    if (!code) {
      app.showError('请输入邀请码')
      return
    }
    if (this.data.isJoining) return
    this.setData({ isJoining: true })
    app.showLoading('加入中...')
    team.callTeamManager('joinByInvite', { code }).then((res) => {
      app.hideLoading()
      this.setData({ isJoining: false })
      if (res.success) {
        app.showSuccess('已加入团队')
        this.setData({ inviteCode: '' })
        this._loadTeamManagedFields()
      } else {
        if (res.error === 'NO_CARD') {
          wx.showModal({
            title: '需先保存名片',
            content: '请先保存当前名片，再粘贴邀请码加入团队。',
            showCancel: false,
            confirmText: '知道了'
          })
          return
        }
        team.showTeamError(res.error)
      }
    })
  }
})
