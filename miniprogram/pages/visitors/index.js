const app = getApp()

Page({
  data: {
    stats: {
      visitors: 0,
      viewed: 0,
      newCards: 0
    },
    visitors: [],
    isLoading: true,
    isEmpty: false,
    isError: false,
    errorMsg: ''
  },

  onLoad() {
    this.loadVisitors()
  },

  onShow() {
    // onShow 不再重复加载，避免 onLoad 加载成功后立刻再加载
    // 仅在没有数据时重新加载
    if (this.data.isEmpty && !this.data.isLoading) {
      this.loadVisitors()
    }
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

    var that = this

    // 先获取用户 openId（用于过滤统计和访客数据）
    app.getOpenId().then(function (myOpenId) {
      that._myOpenId = myOpenId

      // 1. 名片数（统计 user_save_cards，与名片夹及首页数据源保持一致）
      wx.cloud.database().collection('user_save_cards').count()
        .then(function (res) {
          that.setData({ 'stats.newCards': res.total || 0 })
        })
        .catch(function () {})

      // 2. 访客统计（准确 count，与首页口径对齐）
      wx.cloud.callFunction({
        name: 'initVisits',
        data: { action: 'getMyVisitorStats', data: { cardOwnerId: myOpenId || '' } }
      }).then(function (statsRes) {
        if (statsRes.result && statsRes.result.ok) {
          that.setData({
            'stats.visitors': statsRes.result.visitors || 0,
            'stats.viewed': statsRes.result.viewed || 0
          })
        }
        // 3. 访客列表（单独请求，不影响统计口径）
        return wx.cloud.callFunction({
          name: 'initVisits',
          data: {
            action: 'getRecentVisitors',
            data: { cardOwnerId: myOpenId || '', limit: 50 }
          }
        })
      }).then(function (res) {
        if (res.result && res.result.ok) {
          that._processVisitors(res.result.list || [])
        } else {
          that._loadVisitorsDirect()
        }
      }).catch(function () {
        that._loadVisitorsDirect()
      })
    }).catch(function () {
      // 无法获取 openId → 降级（不过滤）
      that._loadVisitorsDirect()
    })
  },

  _processVisitors(list) {
    var visitors = (list || []).map(function (v) {
      return {
        id: v._id,
        visitorOpenId: v.visitorOpenId || '',   // 用于客户端聚合去重
        name: v.visitorName || ('访客 #' + (v.visitorOpenId || '').slice(-4).toUpperCase()),
        phone: v.visitorPhone || '',
        position: v.visitorPosition || '',
        company: v.visitorCompany || '',
        avatar: v.visitorAvatar || '',
        visitCount: v.visitCount || 1,
        visitorLevel: v.visitorLevel || 1,
        actions: v.actions || [],
        lastVisit: app.formatTime(v.visitTime),
        description: v.source ? '通过"' + v.source + '"查看了您' : '',
        buttonText: v.visitorName ? '交换名片' : '请问是谁',
        buttonType: v.visitorName ? 'primary' : 'secondary'
      }
    })

    // 客户端聚合：按 visitorOpenId 去重（与首页逻辑对齐）
    var merged = this._mergeVisitorsByOpenId(visitors)

    // 注意：stats.visitors / stats.viewed 已由 getMyVisitorStats 写入，
    // 此处只更新列表，不覆盖统计数字（避免受 limit:50 截断影响）
    this.setData({
      visitors: merged,
      isLoading: false,
      isEmpty: merged.length === 0
    })
  },

  /**
   * 客户端聚合：同一 visitorOpenId 的多次访问归并为一条
   * 与首页 _aggregateVisitors 逻辑保持一致
   */
  _mergeVisitorsByOpenId(visitors) {
    var map = {}
    visitors.forEach(function (v) {
      // 按 visitorOpenId 去重；无 openId 时退化为按 _id 唯一
      var key = v.visitorOpenId || ('anon_' + v.id)
      if (!map[key]) {
        map[key] = Object.assign({}, v)
      } else {
        // 合并：累加访问次数（visitCount 在 visits 文档里已是累计值，这里做保护性求和）
        map[key].visitCount = (map[key].visitCount || 1) + (v.visitCount || 1)
      }
    })
    return Object.values(map)
  },

  _loadVisitorsDirect() {
    var db = wx.cloud.database()
    var _ = db.command
    var myOpenId = this._myOpenId || ''
    var that = this

    // 构建查询条件：按 cardOwnerId 过滤
    var baseWhere = myOpenId ? { cardOwnerId: myOpenId } : {}

    // 统计：访客总数
    var query = db.collection('visits')
    if (myOpenId) query = query.where(baseWhere)
    query.count()
      .then(function (res) {
        that.setData({ 'stats.visitors': res.total || 0 })
        // 多次来访
        var repeatWhere = myOpenId
          ? { cardOwnerId: myOpenId, visitCount: _.gt(1) }
          : { visitCount: _.gt(1) }
        return db.collection('visits').where(repeatWhere).count()
      })
      .then(function (res) {
        that.setData({ 'stats.viewed': res.total || 0 })
        // 加载列表
        var listQuery = db.collection('visits')
        if (myOpenId) listQuery = listQuery.where(baseWhere)
        return listQuery.orderBy('visitTime', 'desc').limit(50).get()
      })
      .then(function (res) {
        that._processVisitors(res.data || [])
      })
      .catch(function (err) {
        console.warn('[Visitors] visits 集合不存在或查询失败:', err)
        that.setData({
          visitors: [],
          'stats.visitors': 0,
          'stats.viewed': 0,
          isLoading: false,
          isEmpty: true
        })
      })
  },

  handleAction(e) {
    const item = e.currentTarget.dataset.item
    const buttonText = item.buttonText
    
    if (buttonText === '交换名片') {
      wx.showToast({ title: '已发送交换请求', icon: 'success' })
    } else if (buttonText === '请问是谁') {
      wx.showToast({ title: '已发送询问', icon: 'none' })
    }
  },

  goToProfile(e) {
    const item = e.currentTarget.dataset.item
    wx.showToast({ title: `查看 ${item.name} 的名片`, icon: 'none' })
  }
})
