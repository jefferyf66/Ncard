App({
  globalData: {
    userInfo: null,
    systemInfo: null,
    cardsCache: [],
    lastUpdateTime: 0
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

  showConfirm(title, content) {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        content,
        success: (res) => {
          resolve(res.confirm)
        }
      })
    })
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

  isCacheValid(key) {
    try {
      const data = wx.getStorageSync(key)
      if (!data) return false
      return Date.now() < data.timestamp
    } catch (e) {
      return false
    }
  },

  isValidPhone(phone) {
    return /^1[3-9]\d{9}$/.test(phone)
  },

  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  },

  formatTime(date) {
    if (!date) return ''
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  debounce(fn, delay = 500) {
    let timer = null
    return function (...args) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => fn.apply(this, args), delay)
    }
  }
})
