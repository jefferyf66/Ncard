const app = getApp()
const storage = require('../../config/storage')

Page({
  data: {
    stats: {
      visitors: 0,
      viewed: 0,
      newCards: 0,
      recent: 0
    },
    visitors: [],
    isLoading: true,
    isEmpty: false,
    isError: false,
    errorMsg: '',
    mode: 'global',
    cardId: '',
    cardName: ''
  },

  onLoad(options) {
    const cardId = (options && options.cardId) || ''
    this._cardId = cardId
    if (cardId) {
      this.setData({ mode: 'card', cardId: cardId })
      this._loadCardName(cardId)
    }
    this.loadVisitors()
  },

  onShow() {
    // onShow 不再重复加载，避免 onLoad 加载成功后立刻再加载
    // 仅在没有数据时重新加载
    if (this.data.isEmpty && !this.data.isLoading) {
      this.loadVisitors()
    }
  },

  /**
   * 单卡模式：读取卡片名作为页面上下文（仅取 name 字段，降权限）
   */
  _loadCardName(cardId) {
    if (!wx.cloud) return
    wx.cloud.database().collection('cards').doc(cardId).field({ name: true }).get()
      .then((res) => {
        if (res.data && res.data.name) {
          this.setData({ cardName: res.data.name })
        }
      })
      .catch(() => {})
  },

  /**
   * 从单卡视图返回全局访客视图
   */
  goGlobal() {
    wx.redirectTo({ url: '/pages/visitors/index' })
  },

  loadVisitors() {
    if (!wx.cloud) {
      this.setData({
        isLoading: false,
        isError: true,
        errorMsg: '微信版本过低，不支持云开发'
      })
      return
    }

    this.setData({ isLoading: true, isError: false })

    // 先获取用户 openId（用于过滤统计和访客数据）
    app.getOpenId().then((myOpenId) => {
      this._myOpenId = myOpenId

      // 1. 名片数（仅全局模式有意义；单卡模式无需展示）
      if (!this._cardId) {
        wx.cloud.database().collection('user_save_cards').count()
          .then((res) => {
            this.setData({ 'stats.newCards': res.total || 0 })
          })
          .catch(() => {})
      }

      // 构建请求体：单卡模式追加 cardId 维度（per-card 过滤）
      const statsData = { cardOwnerId: myOpenId || '' }
      const listData = { cardOwnerId: myOpenId || '', limit: 50 }
      if (this._cardId) {
        statsData.cardId = this._cardId
        listData.cardId = this._cardId
      }

      // 2. 访客统计（准确 count，按 cardOwnerId + 可选 cardId 过滤）
      wx.cloud.callFunction({
        name: 'initVisits',
        data: { action: 'getMyVisitorStats', data: statsData }
      }).then((statsRes) => {
        if (statsRes.result && statsRes.result.ok) {
          this.setData({
            'stats.visitors': statsRes.result.visitors || 0,
            'stats.viewed': statsRes.result.viewed || 0
          })
        }
        // 3. 访客列表（单独请求，不影响统计口径）
        return wx.cloud.callFunction({
          name: 'initVisits',
          data: { action: 'getRecentVisitors', data: listData }
        })
      }).then((res) => {
        if (res.result && res.result.ok) {
          this._processVisitors(res.result.list || [])
        } else {
          this._loadVisitorsDirect()
        }
      }).catch(() => {
        this._loadVisitorsDirect()
      })
    }).catch(() => {
      // 无法获取 openId → 降级（不过滤）
      this._loadVisitorsDirect()
    })
  },

  _processVisitors(list) {
    const visitors = (list || []).map((v) => {
      return {
        id: v._id,
        visitorOpenId: v.visitorOpenId || '',
        cardId: v.cardId || '',
        cardName: v.cardName || '',
        name: v.visitorName || ('访客 #' + (v.visitorOpenId || '').slice(-4).toUpperCase()),
        phone: v.visitorPhone || '',
        position: v.visitorPosition || '',
        company: v.visitorCompany || '',
        avatar: storage.resolveCloudUrl(v.visitorAvatar),
        visitCount: v.visitCount || 1,
        visitorLevel: v.visitorLevel || 1,
        actions: v.actions || [],
        lastVisit: app.formatTime(v.visitTime),
        description: v.cardName ? ('查看了您的「' + v.cardName + '」') : (v.source === 'share' ? '通过分享查看了您' : '查看了您')
      }
    })

    // 客户端聚合：按 visitorOpenId 去重（与首页逻辑对齐）
    const merged = this._mergeVisitorsByOpenId(visitors)

    // 注意：stats.visitors / stats.viewed 已由 getMyVisitorStats 写入，
    // 此处只更新列表，不覆盖统计数字（避免受 limit:50 截断影响）
    this.setData({
      visitors: merged,
      isLoading: false,
      isEmpty: merged.length === 0,
      'stats.recent': merged.length
    })
  },

  /**
   * 客户端聚合：同一 visitorOpenId 的多次访问归并为一条
   * 与首页 _aggregateVisitors 逻辑保持一致
   */
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

  _loadVisitorsDirect() {
    const db = wx.cloud.database()
    const _ = db.command
    const myOpenId = this._myOpenId || ''

    // 构建查询条件：按 cardOwnerId 过滤（单卡模式追加 cardId）
    const baseWhere = {}
    if (myOpenId) baseWhere.cardOwnerId = myOpenId
    if (this._cardId) baseWhere.cardId = this._cardId

    // 统计：访客总数
    let query = db.collection('visits')
    if (myOpenId) query = query.where(baseWhere)
    query.count()
      .then((res) => {
        this.setData({ 'stats.visitors': res.total || 0 })
        // 多次来访
        const repeatWhere = myOpenId
          ? { cardOwnerId: myOpenId, visitCount: _.gt(1) }
          : { visitCount: _.gt(1) }
        return db.collection('visits').where(repeatWhere).count()
      })
      .then((res) => {
        this.setData({ 'stats.viewed': res.total || 0 })
        // 加载列表
        let listQuery = db.collection('visits')
        if (myOpenId) listQuery = listQuery.where(baseWhere)
        return listQuery.orderBy('visitTime', 'desc').limit(50).get()
      })
      .then((res) => {
        this._processVisitors(res.data || [])
      })
      .catch((err) => {
        console.warn('[Visitors] visits 集合不存在或查询失败:', err)
        this.setData({
          visitors: [],
          'stats.visitors': 0,
          'stats.viewed': 0,
          isLoading: false,
          isEmpty: true
        })
      })
  },

  goToProfile(e) {
    const item = e.currentTarget.dataset.item
    wx.showToast({ title: `查看 ${item.name} 的名片`, icon: 'none' })
  },

  /**
   * 从访客项跳转到对应名片详情（全局视图下，每条访客记录归属不同名片）
   */
  goToCard(e) {
    const cardId = e.currentTarget.dataset.cardid
    if (cardId) {
      wx.navigateTo({ url: '/pages/preview/index?id=' + cardId })
    }
  }
})
