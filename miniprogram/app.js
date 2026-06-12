App({
  globalData: {
    userInfo: null,
    systemInfo: null
  },

  onLaunch() {
    this.getSystemInfo()
    this.initCloud()
    this.initPrivacy()
  },

  initPrivacy() {
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve, event) => {
        console.log('[App] onNeedPrivacyAuthorization', event)
        wx.showModal({
          title: '隐私授权',
          content: '使用此功能需要您同意隐私政策',
          confirmText: '同意',
          cancelText: '不同意',
          success: (res) => {
            if (res.confirm) {
              resolve({ event: 'agree', button: 'agree' })
            } else {
              resolve({ event: 'disagree' })
            }
          },
          fail: () => resolve({ event: 'disagree' })
        })
      })
    }
  },

  getSystemInfo() {
    try {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : {}
      const deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : {}
      const appBaseInfo = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {}
      this.globalData.systemInfo = {
        ...windowInfo,
        ...deviceInfo,
        ...appBaseInfo
      }
    } catch (e) {
      console.error('[App] 获取系统信息失败:', e)
    }
  },

  initCloud() {
    if (!wx.cloud) {
      console.warn('[App] 微信版本过低，不支持云开发')
      return
    }
    try {
      wx.cloud.init({
        traceUser: true,
        env: wx.cloud.DYNAMIC_CURRENT_ENV
      })
      console.log('[App] 云开发初始化成功')
    } catch (e) {
      console.error('[App] 云开发初始化失败:', e)
    }
  },

  showLoading(title = '加载中...') {
    wx.showLoading({ title, mask: true })
  },

  hideLoading() {
    wx.hideLoading()
  },

  showError(title = '操作失败', duration = 2000) {
    wx.showToast({ title, icon: 'none', duration })
  },

  showSuccess(title = '操作成功', duration = 1500) {
    wx.showToast({ title, icon: 'success', duration })
  },

  getCache(key) {
    try {
      return wx.getStorageSync(key)
    } catch (e) {
      return null
    }
  },

  setCache(key, value, expire = 300000) {
    try {
      const data = {
        value,
        timestamp: Date.now() + expire
      }
      wx.setStorageSync(key, data)
    } catch (e) {
      console.error('[App] 设置缓存失败:', e)
    }
  },

  formatTime(date) {
    if (!date) return ''
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  /**
   * 获取当前用户的 openId（带缓存）
   * @returns {Promise<string>}
   */
  getOpenId() {
    return new Promise((resolve) => {
      if (this.globalData._openId) {
        resolve(this.globalData._openId)
        return
      }
      if (!wx.cloud) {
        resolve('')
        return
      }
      wx.cloud.callFunction({
        name: 'getOpenId',
        data: {},
        success: (res) => {
          var openId = (res.result && res.result.data && res.result.data.openid) || ''
          this.globalData._openId = openId
          resolve(openId)
        },
        fail: () => {
          console.warn('[App] getOpenId 云函数调用失败')
          resolve('')
        }
      })
    })
  },

  /**
   * 批量将云文件 cloud:// ID 转换为临时 HTTPS URL
   * 通过云函数代理调用 getTempFileURL，以管理员身份绕过存储权限限制
   * 云存储可设为「仅创建者可读写」，无需担心被分享者无法查看头像
   * @param {string[]} fileIDs - cloud:// 格式的文件 ID 列表
   * @returns {Promise<Object>} { originalID: 'https://...' } 的映射
   */
  resolveCloudFileIDs(fileIDs) {
    return new Promise((resolve) => {
      if (!fileIDs || fileIDs.length === 0 || !wx.cloud) {
        resolve({})
        return
      }

      // 过滤出 cloud:// 格式的 ID
      var cloudIDs = fileIDs.filter(function (id) {
        return id && typeof id === 'string' && id.indexOf('cloud://') === 0
      })

      if (cloudIDs.length === 0) {
        resolve({})
        return
      }

      wx.cloud.callFunction({
        name: 'resolveCloudUrls',
        data: { fileIDs: cloudIDs },
        success: function (res) {
          resolve((res.result && res.result.urls) || {})
        },
        fail: function (err) {
          console.error('[App] resolveCloudUrls 云函数调用失败:', err)
          resolve({})
        }
      })
    })
  }
})
