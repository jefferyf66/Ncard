const app = getApp()

Page({
  data: {
    cards: [],
    shownCards: [],
    filter: 'all', // all | personal | team
    isLoading: true,
    isEmpty: false
  },

  onLoad() {
    this.loadCards()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    const now = Date.now()
    if (now - (this._lastLoadTs || 0) < 5000) return
    this._lastLoadTs = now
    this.loadCards()
  },

  loadCards() {
    if (!wx.cloud) {
      this.setData({ isLoading: false, isEmpty: true })
      wx.showToast({ title: '云开发未初始化', icon: 'none' })
      return
    }

    this.setData({ isLoading: true })

    // 1. 获取当前用户 openId
    app.getOpenId().then((myOpenId) => {
      if (!myOpenId) {
        this.setData({ isLoading: false, isEmpty: true })
        wx.showToast({ title: '获取用户信息失败', icon: 'none' })
        return
      }

      // 2. 查询 user_save_cards，获取当前用户保存的他人名片 ID
      var db = wx.cloud.database()
      db.collection('user_save_cards')
        .orderBy('savedAt', 'desc')
        .get()
        .then((res) => {
          var savedRecords = res.data || []

          if (savedRecords.length === 0) {
            this.setData({ cards: [], isLoading: false, isEmpty: true })
            return
          }

          // 3. 提取 cardId 列表，批量查询名片
          var cardIds = savedRecords.map(function (r) { return r.cardId })
          this._fetchCardsByIds(cardIds)
        })
        .catch((err) => {
          console.error('[List] 查询保存记录失败:', err)
          this.setData({ isLoading: false, isEmpty: true })
          wx.showToast({ title: '获取失败，请下拉刷新', icon: 'none' })
        })
    }).catch(() => {
      this.setData({ isLoading: false, isEmpty: true })
    })
  },

  /**
   * 根据 ID 列表批量获取名片
   */
  _fetchCardsByIds(cardIds) {
    var db = wx.cloud.database()
    var _ = db.command

    db.collection('cards')
      .where({ _id: _.in(cardIds) })
      .get()
      .then((res) => {
        var cards = res.data || []

        // 转换 cloud:// 头像为临时 HTTPS URL（跨设备可见性修复）
        var cloudAvatars = []
        cards.forEach(function (c) {
          if (c.avatar && c.avatar.indexOf('cloud://') === 0) {
            cloudAvatars.push(c.avatar)
          }
        })

        var finishLoad = function (cards) {
          this._mergeTeamInfo(cards).then(function (cardsWithTeams) {
            this.setData({
              cards: cardsWithTeams,
              isLoading: false,
              isEmpty: cardsWithTeams.length === 0
            })
            this._applyFilter()
          }.bind(this))
        }.bind(this)

        if (cloudAvatars.length > 0) {
          app.resolveCloudFileIDs(cloudAvatars).then(function (urlMap) {
            cards.forEach(function (c) {
              if (urlMap[c.avatar]) {
                c.avatar = urlMap[c.avatar]
              }
            })
            // 兜底：将未解析成功的 cloud:// URL 替换为默认头像，避免渲染层加载失败
            this._fallbackCloudAvatars(cards)
            finishLoad(cards)
          }.bind(this)).catch(function () {
            this._fallbackCloudAvatars(cards)
            finishLoad(cards)
          }.bind(this))
        } else {
          finishLoad(cards)
        }
      })
      .catch((err) => {
        console.error('[List] 获取名片失败:', err)
        this.setData({ isLoading: false })
        wx.showToast({ title: '获取失败，请下拉刷新', icon: 'none' })
      })
  },

  /**
   * 兜底：将未成功解析的 cloud:// 头像替换为默认头像
   * 避免 cloud:// URL 传给渲染层导致图片加载失败
   */
  _fallbackCloudAvatars(cards) {
    cards.forEach(function (c) {
      if (c.avatar && typeof c.avatar === 'string' && c.avatar.indexOf('cloud://') === 0) {
        c.avatar = '/images/avatar.png'
      }
    })
  },

  /**
   * 批量聚合「名片所属团队」信息（仅客户端不可直读 team_members，必须经云函数）
   * 返回带 teams / isTeam 的 cards；优先用团队托管 org 字段覆盖 company/department/position
   * 失败不阻断名片夹主流程（降级为纯个人名片展示）
   */
  _mergeTeamInfo(cards) {
    const cardIds = (cards || []).map(c => c._id)
    if (!cardIds.length || !wx.cloud) {
      cards.forEach(c => { c.teams = []; c.isTeam = false })
      return Promise.resolve(cards)
    }
    return wx.cloud.callFunction({
      name: 'teamManager',
      data: { action: 'getCardsTeams', cardIds }
    }).then((res) => {
      const r = res && res.result
      const map = {}
      if (r && r.success && r.data && r.data.list) {
        r.data.list.forEach(item => { map[item.cardId] = item.teams })
      }
      cards.forEach(c => {
        const teams = map[c._id] || []
        c.teams = teams
        c.isTeam = teams.length > 0
        // 团队名片：优先展示团队托管的组织字段（company/department/position）
        if (c.isTeam) {
          const t = teams[0]
          if (t && t.org) {
            if (t.org.company) c.company = t.org.company
            if (t.org.department) c.department = t.org.department
            if (t.org.position) c.position = t.org.position
          }
        }
      })
      return cards
    }).catch(() => {
      cards.forEach(c => { c.teams = []; c.isTeam = false })
      return cards
    })
  },

  /**
   * 按 filter 计算可见列表：全部 / 个人 / 团队
   */
  _applyFilter() {
    const filter = this.data.filter
    let shown = this.data.cards
    if (filter === 'personal') shown = this.data.cards.filter(c => !c.isTeam)
    else if (filter === 'team') shown = this.data.cards.filter(c => c.isTeam)
    this.setData({ shownCards: shown })
  },

  setFilter(e) {
    const filter = e.currentTarget.dataset.filter
    if (!filter || filter === this.data.filter) return
    this.setData({ filter }, () => this._applyFilter())
  },

  goToCard(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const card = this.data.cards.find(c => c._id === id)
    if (!card) return
    // 团队名片且存在可访问团队 → 进团队视图；否则进个人名片预览
    if (card.isTeam) {
      const accessibleTeam = (card.teams || []).find(t => t.accessible)
      if (accessibleTeam) {
        wx.navigateTo({ url: `/pages/team/detail?id=${accessibleTeam.shortId}` })
        return
      }
    }
    wx.navigateTo({ url: `/pages/preview/index?id=${id}` })
  },

  /**
   * 头像加载失败降级：替换为默认头像
   */
  onAvatarError(e) {
    var index = e.currentTarget.dataset.index
    if (index === undefined || index === null) return
    var key = 'cards[' + index + '].avatar'
    var data = {}
    data[key] = '/images/avatar.png'
    this.setData(data)
  },

  onPullDownRefresh() {
    this.loadCards()
    wx.stopPullDownRefresh()
  }
})