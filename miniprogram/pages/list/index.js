const app = getApp()

Page({
  data: {
    cards: [],
    isLoading: true,
    isEmpty: false
  },

  onLoad() {
    this.loadCards()
  },

  onShow() {
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

        var finishLoad = function () {
          this.setData({
            cards: cards,
            isLoading: false,
            isEmpty: cards.length === 0
          })
        }.bind(this)

        if (cloudAvatars.length > 0) {
          app.resolveCloudFileIDs(cloudAvatars).then(function (urlMap) {
            cards.forEach(function (c) {
              if (urlMap[c.avatar]) {
                c.avatar = urlMap[c.avatar]
              }
            })
            finishLoad()
          }).catch(function () {
            finishLoad()
          })
        } else {
          finishLoad()
        }
      })
      .catch((err) => {
        console.error('[List] 获取名片失败:', err)
        this.setData({ isLoading: false })
        wx.showToast({ title: '获取失败，请下拉刷新', icon: 'none' })
      })
  },

  goToPreview(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/preview/index?id=${id}`
    })
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