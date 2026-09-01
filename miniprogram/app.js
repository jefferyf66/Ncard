var storage = require('./config/storage')

// 应用版本号唯一真源（关于页等展示用）
// ⚠️ 发版打 tag 时必须同步更新此值（见 tag-changelog-reconcile 发版约定）
const APP_VERSION = '1.5.5'

App({
  globalData: {
    userInfo: null,
    systemInfo: null,
    // 当前登录用户记录（由 ensureUser 填充，见 getUser()）
    user: null,
    // 应用版本号（关于页等展示用，唯一真源）
    version: APP_VERSION
  },

  onLaunch() {
    this.getSystemInfo()
    this.initCloud()
    // 启动即确保账号存在（fire-and-forget，失败不影响启动）
    this.ensureUser().then((user) => {
      if (user) this.guideIfUnnamed(user)
    })
  },

  /**
   * 启动软引导：未命名用户跳账号设置页补全昵称
   * 触发条件严控（Q2：仅未归档的活跃普通用户，跳过 admin/root）：
   *   1) ensureUser 成功且返回 user
   *   2) status==='active' 且 nickname 为空字符串
   *   3) role 非 admin/root（运营账号放行，避免假阳性打扰 root 本人）
   *   4) 当前页面栈顶部已非 account 页（防循环跳转）
   * 已有昵称的用户（如 root 本人）绝不打扰。
   */
  guideIfUnnamed(user) {
    if (!user || user.status === 'deleted') return
    if (user.nickname && user.nickname.trim()) return // 已有昵称，不骚扰
    const role = user.role || 'user'
    if (role === 'admin' || role === 'root') return
    // 延迟到页面栈稳定后再判断与跳转（onLaunch 阶段 getCurrentPages 可能为空）
    setTimeout(() => {
      try {
        const pages = getCurrentPages()
        const top = pages[pages.length - 1]
        if (top && top.route && top.route.indexOf('account/index') > -1) return
      } catch (e) {}
      wx.showToast({ title: '请先完善昵称', icon: 'none', duration: 1500 })
      wx.navigateTo({ url: '/pages/account/index' })
    }, 1200)
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
   * 启动即确保用户账号存在（自动注册/登录）
   * 调用 getOpenId 云函数 ensureUser action，写库并返回 user 记录
   * 缓存 Promise：避免并发重复调用，并供页面在首装竞态时 await 刷新（P2-1）
   * @returns {Promise<Object|null>}
   */
  ensureUser() {
    if (!wx.cloud) return Promise.resolve(null)
    if (this._ensureUserPromise) return this._ensureUserPromise
    this._ensureUserPromise = new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'getOpenId',
        data: { action: 'ensureUser' },
        success: (res) => {
          const user = res.result && res.result.data && res.result.data.user
          if (user) {
            this.globalData.user = user
            this.globalData._openId = user._openid
            try { wx.setStorageSync('user', user) } catch (e) {}
          }
          resolve(user || null)
        },
        fail: (err) => {
          console.warn('[App] ensureUser 失败（不影响启动）', err)
          this._ensureUserPromise = null // P1-②: 失败后清空缓存，允许后续重试，避免整会话无账号
          resolve(null)
        }
      })
    })
    return this._ensureUserPromise
  },

  /**
   * 获取当前用户记录
   * 优先取 globalData.user，回退本地原始 storage
   * （user 经 wx.setStorageSync('user', user) 原始写入，与 getCache 的 {value,timestamp} 包装不兼容，故不用 getCache 读取）
   * @returns {Object|null}
   */
  getUser() {
    // 已注销账号（status='deleted'）视为未登录：ensureUser 不会重新激活，仅返回原记录
    if (this.globalData.user && this.globalData.user.status !== 'deleted') return this.globalData.user
    try {
      const cached = wx.getStorageSync('user')
      if (cached && cached.status !== 'deleted') return cached
    } catch (e) {}
    return null
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
   * 批量将云文件 cloud:// ID 转换为永久 HTTPS URL
   * 前提：云存储权限 =「所有用户可读，仅创建者可读写」
   * 转换逻辑见 config/storage.js 的 resolveCloudUrl（单一真源）
   * @param {string[]} fileIDs - cloud:// 格式的文件 ID 列表
   * @returns {Promise<Object>} { originalID: 'https://...' } 的映射
   */
  resolveCloudFileIDs(fileIDs) {
    return Promise.resolve().then(function () {
      if (!fileIDs || fileIDs.length === 0) return {}

      var urlMap = {}
      fileIDs.forEach(function (id) {
        if (id && typeof id === 'string' && id.indexOf('cloud://') === 0) {
          urlMap[id] = storage.resolveCloudUrl(id)
        }
      })
      return urlMap
    })
  }
})
