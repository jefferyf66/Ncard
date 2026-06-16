App({
  globalData: {
    userInfo: null,
    systemInfo: null
  },

  onLaunch() {
    this.getSystemInfo()
    this.initCloud()
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
   * 隐私错误处理：识别官方弹窗拒绝后的错误码
   * 官方弹窗模式下，用户拒绝隐私授权后调用隐私 API 会返回 errCode 103/104
   * @param {Object} err - API 调用失败返回的错误对象
   * @returns {boolean} 是否为隐私相关错误（已弹提示）
   */
  showPrivacyError(err) {
    var errMsg = (err && err.errMsg) || ''
    // errCode 103: 用户拒绝隐私授权（耦合接口）
    // errCode 104: 用户拒绝隐私授权（直接接口）
    if (errMsg.indexOf('privacy') > -1 || errMsg.indexOf('103') > -1 || errMsg.indexOf('104') > -1) {
      wx.showToast({ title: '需要同意隐私协议后才能使用此功能', icon: 'none', duration: 2500 })
      return true
    }
    return false
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
          console.warn('[App] resolveCloudUrls 云函数未部署，降级使用 getTempFileURL')
          // Fallback: 直接调用客户端 API（仅对当前用户有权限的云文件有效）
          // 云存储设为「仅创建者可读写」时，跨用户头像可能无法解析
          // 此时返回空映射，由调用方兜底为默认头像
          wx.cloud.getTempFileURL({
            fileList: cloudIDs,
            success: function (res) {
              var urlMap = {}
              ;(res.fileList || []).forEach(function (item) {
                if (item.tempFileURL) {
                  urlMap[item.fileID] = item.tempFileURL
                }
              })
              console.log('[App] getTempFileURL 降级解析:', Object.keys(urlMap).length + '/' + cloudIDs.length)
              resolve(urlMap)
            },
            fail: function () {
              resolve({})
            }
          })
        }
      })
    })
  }
})
