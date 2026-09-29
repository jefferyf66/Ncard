const app = getApp()
var shareUtil = require('../../utils/share')
var teamUtil = require('../../utils/team')
var cardStyle = require('../../config/cardStyle')
var storage = require('../../config/storage')

Page({
  data: {
    cards: [],
    isLoading: true,
    isEmpty: false,
    isError: false,
    errorMsg: '',
    teamCount: 0,
    hasMore: true,
    pageSize: 10,
    currentPage: 0,
    // Canvas 尺寸（5:4 比例 = 微信分享图显示规范，含横幅，经气泡适配）
    canvasWidth: (function() {
      var cw = cardStyle.CARD.cardWidth
      var ch = cardStyle.calcCardHeight(cw, 3) + cardStyle.rpxToCanvas(cardStyle.CARD.bannerHeight, cw)
      var fitted = cardStyle.fitToBubbleSize(cw, ch)
      return fitted.width
    })(),
    canvasHeight: (function() {
      var cw = cardStyle.CARD.cardWidth
      var ch = cardStyle.calcCardHeight(cw, 3) + cardStyle.rpxToCanvas(cardStyle.CARD.bannerHeight, cw)
      var fitted = cardStyle.fitToBubbleSize(cw, ch)
      return Math.round(fitted.width * 4 / 5)  // 5:4 比例 = 600 × 0.8 = 480
    })(),
    // 分享相关状态
    shareCardId: '',
    shareCardData: null,
    // 一次性分享留言（方案 A：留言随分享链接带过去，仅写入 visits，绝不写入 cards）
    shareNote: '',
    recentNotes: [],
    showShareNoteSheet: false,
    pendingShareId: '',
    _shareCardId: '',
    // 拖拽排序状态（首页名片顺序调整）
    dragStartIndex: -1,
    dragStartY: 0,
    isDragging: false
  },

  onLoad() {
    // 官方隐私弹窗模式：无需手动检查隐私授权状态
    // 当调用隐私 API（如云开发）时，微信自动弹出官方隐私弹窗
    this.loadCards(true)
    this.initShareMenu()
    // 缓存设备平台，供「添加到桌面」等场景复用（避免每次点击重复取）
    const deviceInfoCache = wx.getDeviceInfo ? wx.getDeviceInfo() : {}
    this._devicePlatform = (deviceInfoCache.platform || deviceInfoCache.system || '').toLowerCase()
  },

  /**
   * 静默注册访客身份：确保当前用户的 openid 存在于 visitor_profiles 集合
   * 在 onShow 中调用（idempotent：已存在则跳过）
   * 后续可通过创建名片(L3)或授权弹窗(L2)补充真实身份信息
   */
  _registerVisitorProfile() {
    if (!wx.cloud) return
    var that = this
    app.getOpenId().then(function (myOpenId) {
      if (!myOpenId) return
      var db = wx.cloud.database()
      // 【CON-01 幂等保障·前端侧】此处为「先 count 再 add」的先查后写语义（步骤非原子）：
      // 高并发 / onShow 高频触发下，两次 count→add 之间仍能插重，可能写入同一 openid 的多条记录。
      // 代码侧无法彻底防并发插重，最终保障须由数据层承担：
      // ⚠️ 请手动在【云开发控制台】给 visitor_profiles 集合的 openid 字段建立【唯一索引】，
      //    写入重复键时由数据库拒绝，作为防插重的最终手段（属手动运维项，代码不自动建索引）。
      //    .catch 中已对 add 失败静默忽略（仅 warn），唯一索引冲突亦在此被安静吞掉，不影响主流程。
      db.collection('visitor_profiles').where({ openid: myOpenId }).count()
        .then(function (res) {
          if (res.total > 0) {
            return
          }
          return db.collection('visitor_profiles').add({
            data: {
              openid: myOpenId,
              nickname: '',
              avatarUrl: '',
              createdAt: new Date(),
              updatedAt: new Date()
            }
          })
        })
        .then(function () {
          // 注册成功
        })
        .catch(function (err) {
          console.warn('[Index] visitor_profiles 静默注册失败:', err)
        })
    }).catch(function () {})
  },

  openPrivacyPolicy() {
    // 官方弹窗模式：使用微信内置隐私协议页替代自定义 agreement 页面
    if (wx.openPrivacyContract) {
      wx.openPrivacyContract({
        success: () => {},
        fail: (err) => {
          console.error('[Index] 打开隐私协议页失败:', err)
          // 降级：跳转到自定义协议页
          wx.navigateTo({ url: '/pages/agreement/index?tab=privacy' })
        }
      })
    } else {
      // 低版本微信降级
      wx.navigateTo({ url: '/pages/agreement/index?tab=privacy' })
    }
  },

  openServiceAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index?tab=service' })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    // 静默注册访客身份（idempotent：已存在则跳过）
    this._registerVisitorProfile()

    // 实时拉取「我的团队」数量（5 分钟缓存，见 loadTeamCount）
    this.loadTeamCount()

    // 预生成兜底分享图（方案 B）：进首页即生成并缓存，确保后续分享同步可用，永不空白
    this._getFallbackShareImage()
    
    var needsRefresh = app.getCache('cardsNeedRefresh')
    if (needsRefresh) {
      // 编辑页设置了刷新标志 → 强制重新加载卡片
      app.setCache('cardsNeedRefresh', false)
      this.loadCards(true)
      return
    }
    
    const lastUpdate = app.getCache('lastCardUpdate')
    const now = Date.now()
    
    if (!lastUpdate || now - lastUpdate > 300000) {
      this.loadCards(true)
    }
  },

  onPullDownRefresh() {
    this.loadCards(true, () => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.isLoading) {
      this.loadCards(false)
    }
  },

  onUnload() {
    if (this._loadTimer) {
      clearTimeout(this._loadTimer)
      this._loadTimer = null
    }
  },

  loadCards(isRefresh = false, callback) {
    if (!wx.cloud) {
      this.setData({
        isLoading: false,
        isError: true,
        errorMsg: '微信版本过低，不支持云开发',
        isEmpty: true
      })
      if (callback) callback()
      return
    }

    this.setData({ isLoading: true, isError: false })

    // 先获取用户 openId，用于过滤只显示自己的名片
    app.getOpenId().then((myOpenId) => {
      if (!myOpenId) {
        // 无法获取 openId 时降级为不过滤
        console.warn('[Index] 未获取到 openId，不进行过滤')
        this._doLoadCards(isRefresh, callback, null)
        return
      }
      this._myOpenId = myOpenId
      this._doLoadCards(isRefresh, callback, myOpenId)
    }).catch(() => {
      console.warn('[Index] getOpenId 失败，降级加载')
      this._doLoadCards(isRefresh, callback, null)
    })
  },

  _doLoadCards(isRefresh, callback, myOpenId) {
    const currentPage = isRefresh ? 0 : this.data.currentPage
    const collection = wx.cloud.database().collection('cards')
    var query = collection
      .orderBy('createTime', 'desc')
      .skip(currentPage * this.data.pageSize)
      .limit(this.data.pageSize)

    // 仅显示当前用户自己创建的名片
    if (myOpenId) {
      query = query.where({ _openid: myOpenId })
    }

    this._loadTimer = setTimeout(() => {
      console.warn('[Index] 加载超时，尝试使用缓存')
      this.tryLoadCache()
      // 超时回退也触发存量分享图自愈：setData 异步未生效，不能依赖 this.data.cards，
      // 须从同步可读的缓存源取 cards，否则首次打开拿到空数组 → 队列空 → 毒卡永不重生成
      this._ensureShareImages(this._getCacheCards())
      if (callback) callback()
    }, 10000)

    query.get()
      .then(res => {
        clearTimeout(this._loadTimer)

        const newCards = res.data || []
        // F19 降级方案：翻页期间跳过重排触发 —— 仅刷新时全量按 order 重排，翻页只追加保持展示稳定。
        // 理由：分页键（createTime）与展示键（order）无法在 order 历史数据缺失下统一——
        // 云数据库 orderBy('order','asc') 会把缺失字段排最前，与展示「无 order 排最后」语义冲突，
        // 统一排序键需先迁移存量数据，风险过高，故按审计允许的降级路径处理。
        const rawCards = isRefresh ? newCards : [...this.data.cards, ...newCards]
        const cards = isRefresh ? this._sortCards(rawCards) : rawCards
        const hasMore = newCards.length >= this.data.pageSize
        const isEmpty = isRefresh && newCards.length === 0

        this.setData({
          cards,
          isLoading: false,
          isEmpty,
          isError: false,
          hasMore,
          currentPage: currentPage + 1
        })

        app.setCache('cardsCache', cards, 600000)
        app.setCache('lastCardUpdate', Date.now())

        // 预生成缺失的分享图（fire-and-forget）：保证分享时走预存卡片图而非头像降级
        this._ensureShareImages(cards)

        if (callback) callback()
      })
      .catch(err => {
        clearTimeout(this._loadTimer)
        console.error('[Index] 加载失败:', err)
        this.tryLoadCache()
        // 失败回退也触发存量分享图自愈（与超时回退一致，同样用同步缓存源）
        this._ensureShareImages(this._getCacheCards())
        this.setData({
          isError: true,
          errorMsg: '网络错误，请检查网络后重试'
        })
        if (callback) callback()
      })
  },

  tryLoadCache() {
    // F05 修复：getCache 已内部解包并做过期判断，这里直接拿 value（原 cache.value 双重取值恒 undefined）
    const cache = app.getCache('cardsCache')
    if (cache && cache.length > 0) {
      this.setData({
        cards: this._sortCards(cache),
        isLoading: false,
        isEmpty: false
      })
    }
  },

  /**
   * 客户端排序：有 order 的卡片按 order 升序（手动排序优先），
   * 无 order 的卡片（含新创建未排过序的）排在后面，彼此按 createTime 降序（最新在前）。
   * 这样：
   *  - 用户从未手动排序时，等同于原来的 createTime desc（最新名片在最上）
   *  - 一旦手动拖拽，所有已加载卡片获得显式 order，保持手动顺序
   *  - 之后新建的名片（无 order）自然追加到末尾
   */
  _sortCards(cards) {
    if (!cards || !cards.length) return cards || []
    const arr = cards.slice()
    arr.sort((a, b) => {
      const oa = (typeof a.order === 'number') ? a.order : Infinity
      const ob = (typeof b.order === 'number') ? b.order : Infinity
      if (oa !== ob) return oa - ob
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0
      return tb - ta
    })
    return arr
  },

  /**
   * 拖拽排序 —— 句柄 touchstart
   * 记录起点索引与手指 Y，并测量卡片实际高度（用于计算跨过几张卡）
   */
  onCardTouchStart(e) {
    if (e.touches.length !== 1) return
    const index = parseInt(e.currentTarget.dataset.index)
    if (isNaN(index) || index < 0 || index >= this.data.cards.length) return

    const that = this
    wx.createSelectorQuery().in(this).select('.card-item').boundingClientRect(function (rect) {
      if (rect && rect.height) that._cardItemH = rect.height
    }).exec()

    this.setData({
      dragStartIndex: index,
      dragStartY: e.touches[0].clientY,
      isDragging: true
    })
  },

  /**
   * 拖拽中 —— 仅让被拖卡片跟手（translateY），列表在松手时一次性重排，
   * 避免在 move 中频繁 splice 引起的抖动。句柄用 catchtouchmove 不冒泡，
   * 不会触发卡片内其他按钮。
   */
  onCardTouchMove(e) {
    if (this.data.dragStartIndex === -1 || !this.data.isDragging) return
    if (e.touches.length !== 1) return
    const deltaY = e.touches[0].clientY - this.data.dragStartY
    const idx = this.data.dragStartIndex
    this.setData({
      ['cards[' + idx + ']._dragOffset']: deltaY
    })
  },

  /**
   * 松手 —— 依据累计位移计算目标位置，splice 重排后回写 order:0..n-1，再批量持久化
   */
  onCardTouchEnd(e) {
    if (this.data.dragStartIndex === -1) return
    const startIndex = this.data.dragStartIndex
    const cards = this.data.cards.slice()
    const step = this._cardItemH || 300
    const endY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : this.data.dragStartY
    const deltaY = endY - this.data.dragStartY

    let moveIndex = startIndex + Math.round(deltaY / step)
    moveIndex = Math.max(0, Math.min(cards.length - 1, moveIndex))

    if (moveIndex !== startIndex) {
      const [dragged] = cards.splice(startIndex, 1)
      delete dragged._dragOffset
      delete dragged._dragging
      cards.splice(moveIndex, 0, dragged)
    } else {
      delete cards[startIndex]._dragOffset
      delete cards[startIndex]._dragging
    }

    // 清掉所有拖拽瞬态字段，并写入显式顺序
    cards.forEach((c, i) => {
      delete c._dragOffset
      delete c._dragging
      c.order = i
    })

    this.setData({
      cards,
      dragStartIndex: -1,
      dragStartY: 0,
      isDragging: false
    })

    this._persistCardOrder(cards)
  },

  /**
   * 批量持久化顺序：每张卡直连 update order（仅写 order，保留其余字段）。
   * 首页只展示自己的卡，集合权限「仅创建者可读写」保证只有本人能改自己的卡。
   */
  _persistCardOrder(cards) {
    if (!wx.cloud) return
    const db = wx.cloud.database()
    const updates = cards.map(function (c) {
      return db.collection('cards').doc(c._id).update({ data: { order: c.order } })
    })
    Promise.all(updates).then(function () {
      console.log('[Index] 名片顺序已持久化，共', cards.length, '张')
    }).catch(function (err) {
      console.warn('[Index] 名片顺序持久化失败:', err)
    })
  },

  retryLoad() {
    this.setData({ isError: false })
    this.loadCards(true)
  },

  goToEdit() {
    console.log('[Index] 跳转到编辑页')
    wx.navigateTo({
      url: '/pages/edit/index',
      fail: (err) => {
        console.error('[Index] 跳转失败:', err)
        app.showError('跳转失败')
      }
    })
  },

  onShareButtonTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const card = this.data.cards.find(c => c._id === id)
    if (!card) return
    console.log('[Share] onShareButtonTap, id:', id, 'hasShareImage:', !!card.shareImageUrl)
    // 暂存本次分享的留言与一次性 sid（供 onShareAppMessage 写入分享 path）
    this._activeShare = {
      id: id,
      card: card,
      note: this.data.shareNote || '',
      sid: this.data.pendingShareId || ''
    }
    // 留言非空则落库到「最近用过」，供下次快捷点取
    if ((this.data.shareNote || '').trim()) this._saveRecentNote(this.data.shareNote)
    // 触发分享即收起底部填写层（原生分享面板关掉后不再残留遮罩）
    this.setData({ shareCardId: id, shareCardData: card, showShareNoteSheet: false })
    // 还原自定义 tab-bar（与 openShareNoteSheet 中隐藏成对）
    const tb = this.getTabBar && this.getTabBar()
    if (tb) tb.setData({ hidden: false })
  },

  /**
   * 打开「分享留言」底部填写层
   * - 将当前选中的名片 id 暂存到 data._shareCardId，供底部内层 open-type="share" 按钮取用
   * - 生成一次性 sid（写入分享 path，服务端写入 visits.shareId），每次分享可带不同内容
   * - 每次打开清空上次输入的留言
   */
  openShareNoteSheet(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const pendingShareId = id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
    this.setData({
      _shareCardId: id,
      pendingShareId: pendingShareId,
      shareNote: '',
      recentNotes: this._loadRecentNotes(),
      showShareNoteSheet: true
    })
    // 打开填写层时隐藏自定义 tab-bar，避免遮罩下残留底部栏（关闭/分享后还原）
    const tb = this.getTabBar && this.getTabBar()
    if (tb) tb.setData({ hidden: true })
  },

  /**
   * 关闭「分享留言」底部填写层
   */
  closeShareNoteSheet() {
    this.setData({ showShareNoteSheet: false })
    // 还原自定义 tab-bar（与 openShareNoteSheet 中隐藏成对）
    const tb = this.getTabBar && this.getTabBar()
    if (tb) tb.setData({ hidden: false })
  },

  /**
   * 记录底部填写层的留言输入（textarea maxlength 已限制 40 字）
   */
  onShareNoteInput(e) {
    this.setData({ shareNote: (e.detail && e.detail.value) || '' })
  },

  /**
   * 读取本地「最近用过」的分享留言（最多 3 条），供底部填写层快捷点取
   */
  _loadRecentNotes() {
    const list = wx.getStorageSync('recentShareNotes') || []
    return Array.isArray(list) ? list.slice(0, 3) : []
  },

  /**
   * 将本次分享留言写入本地「最近用过」（去重 + 置顶 + 最多 3 条）
   */
  _saveRecentNote(note) {
    const key = 'recentShareNotes'
    const v = (note || '').trim()
    if (!v) return
    const list = wx.getStorageSync(key) || []
    const next = [v, ...(Array.isArray(list) ? list : []).filter(x => x !== v)].slice(0, 3)
    wx.setStorageSync(key, next)
  },

  /**
   * 点击「最近用过」chip：将对应留言回填到 textarea
   */
  onPickRecentNote(e) {
    const note = e.currentTarget.dataset.note
    if (note) this.setData({ shareNote: note })
  },

  stopPropagation() {
    // 阻止事件冒泡
  },

  initShareMenu() {
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline'],
      success: () => console.log('[Index] 分享菜单初始化成功'),
      fail: (err) => console.warn('[Index] 分享菜单初始化失败:', err)
    })
  },

  /**
   * 解析分享图片 URL（cloud:// / https:// / 空）— 纯同步，不返回 Promise
   * cloud:// 必须转 HTTPS：基础库虽声称支持 cloud:// 作 imageUrl，但实测接收方不可见
   * （与 config/storage.js 的结论一致），用作 onShareAppMessage 的同步降级路径
   */
  _resolveAvatarUrl(avatar) {
    if (!avatar) return ''
    if (avatar.indexOf('cloud://') === 0) return storage.resolveCloudUrl(avatar)
    if (avatar.indexOf('https://') === 0) return avatar
    return ''
  },

  /**
   * 给分享图 URL 追加样式版本 cache-buster，强制微信重新拉取「当前灰底」图。
   * 根因：微信分享缩略图按 imageUrl 在服务端做缓存——历史透明底黑/白图被缓存后，
   * 即便云存储文件已重生成灰底，微信仍按旧 URL 命中缓存、继续显示黑图。
   * 在 URL 上挂 ?imgv=<样式版本>，样式升级即视为新 URL，微信必重新抓取当前灰底图。
   * 云存储 CDN 忽略 query 直接回当前文件内容，故不会影响实际取图。
   */
  _cacheBustShareUrl(url) {
    if (!url) return url
    if (url.indexOf('https://') !== 0 && url.indexOf('http://') !== 0) {
      url = storage.resolveCloudUrl(url)
    }
    if (url.indexOf('https://') !== 0) return url
    var sep = url.indexOf('?') >= 0 ? '&' : '?'
    return url + sep + 'imgv=' + storage.SHARE_IMAGE_STYLE
  },

  /**
   * 基础库 ≥ 2.12.0 才支持 onShareAppMessage 返回 Promise（用于「实时生成真图」路径）。
   * 低于此版本必须同步 return，否则分享会失败。
   */
  _canUseSharePromise() {
    try {
      var sdk = (wx.getSystemInfoSync ? wx.getSystemInfoSync().SDKVersion : '0') || '0'
      return this._cmpVersion(sdk, '2.12.0') >= 0
    } catch (e) {
      return false
    }
  },

  // 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等 0
  _cmpVersion(a, b) {
    var pa = ('' + a).split('.'), pb = ('' + b).split('.')
    var len = Math.max(pa.length, pb.length)
    for (var i = 0; i < len; i++) {
      var na = parseInt(pa[i] || '0', 10) || 0
      var nb = parseInt(pb[i] || '0', 10) || 0
      if (na > nb) return 1
      if (na < nb) return -1
    }
    return 0
  },

  /**
   * 判断卡片预存分享图是否为「当前样式版本」的有效图
   * 仅 shareImageUrl 存在不足以复用——历史透明底黑/白图(样式版本过期)必须重新生成，
   * 否则 4a/朋友圈/实时生成都会把旧坏图原样发出去。
   */
  _isShareImageFresh(card) {
    return !!(card && card.shareImageUrl && card.shareImageStyle === storage.SHARE_IMAGE_STYLE)
  },

  /**
   * 回写分享图到内存副本 + 云端 cards（供生成/上传成功后复用，避免重复逻辑）
   */
  _markShareImage(id, httpsUrl, cloudFileID) {
    var cards = this.data.cards || []
    for (var k = 0; k < cards.length; k++) {
      if (cards[k]._id === id) {
        cards[k].shareImageUrl = httpsUrl
        cards[k].shareImageFileID = cloudFileID
        cards[k].shareImageStyle = storage.SHARE_IMAGE_STYLE
      }
    }
    wx.cloud.database().collection('cards').doc(id).update({
      data: { shareImageUrl: httpsUrl, shareImageFileID: cloudFileID, shareImageStyle: storage.SHARE_IMAGE_STYLE }
    }).then(function () {
      console.log('[Share] shareImageUrl 已回写，下次分享直接用')
    }).catch(function () {
      console.warn('[Share] shareImageUrl 回写失败（不影响本次分享）')
    })
  },

  /**
   * 方案 A — 实时生成真实分享图并等待上传完成（≤5s），返回 Promise<url>
   * 用于「无预存图」场景：本次分享即带真图（接收方可靠展示），而非头像/空白。
   * 超时或失败 resolve('')，由调用方降级到兜底图（方案 B）。
   */
  _ensureShareImageUrl(card, id) {
    var self = this
    var WAIT = 5000
    return new Promise(function (resolve) {
      if (self._isShareImageFresh(card)) {
        var u = card.shareImageUrl
        if (u.indexOf('cloud://') === 0) u = storage.resolveCloudUrl(u)
        resolve(u)
        return
      }
      var shareCard = require('../../utils/shareCard')
      var settled = false
      var timer = setTimeout(function () {
        if (settled) return
        settled = true
        console.warn('[Share] 实时生成等待超时(5s)，降级兜底图')
        resolve('')
      }, WAIT)
      shareCard.generate('shareCanvas', card, { cardKey: id, pageContext: self })
        .then(function (res) {
          if (settled) return
          wx.cloud.uploadFile({
            cloudPath: 'sharecards/card_' + id + '.jpg',
            filePath: res.tempFilePath,
            success: function (up) {
              if (settled) return
              settled = true
              clearTimeout(timer)
              var cleanUrl = storage.resolveCloudUrl(up.fileID)
              self._markShareImage(id, cleanUrl, up.fileID)
              resolve(self._cacheBustShareUrl(cleanUrl))
            },
            fail: function () {
              if (settled) return
              settled = true
              clearTimeout(timer)
              resolve(res.tempFilePath)
            }
          })
        })
        .catch(function () {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve('')
        })
    })
  },

  /**
   * 方案 B — 兜底分享图（永不空白）
   * 无预存图 / 无头像 / 生成失败等所有「无有效图」场景，退回一张预生成的默认名片图。
   * 在 onShow 预生成并缓存到 _fallbackShareUrl，故同步路径也能取到。
   */
  _getFallbackShareImage() {
    var self = this
    if (self._fallbackShareUrl) return Promise.resolve(self._fallbackShareUrl)
    var shareCard = require('../../utils/shareCard')
    var defaultCard = {
      _id: '__fallback__', name: '投贴儿名片', position: '', company: '',
      phone: '', email: '', address: '', avatar: null
    }
    return shareCard.generate('shareCanvas', defaultCard, { cardKey: '__fallback__', pageContext: self })
      .then(function (res) {
        self._fallbackShareUrl = res.tempFilePath
        console.log('[Share] 兜底分享图已预生成')
        return res.tempFilePath
      })
      .catch(function () {
        console.warn('[Share] 兜底分享图生成失败')
        return ''
      })
  },

  // 同步取兜底图（已预生成则用之，否则空串）
  _fallbackSync() {
    return this._fallbackShareUrl || ''
  },

  /**
   * 生成分享图 → 上传云存储 → 回写卡片 shareImageUrl/shareImageFileID
   * 供两处复用：onShareAppMessage 4b 后台补生成、_ensureShareImages 预生成队列
   * 返回 Promise<boolean>（true=已回写），失败 resolve(false) 不抛错（fire-and-forget 语义）
   * 含 15s 超时熔断（C1）：确保单卡永不挂起，预生成队列不会断链。
   */
  _generateAndPersistShareImage(card, id) {
    var self = this
    return new Promise(function (resolve) {
      try {
        var shareCard = require('../../utils/shareCard')
        var settled = false
        var timer = setTimeout(function () {
          if (settled) return
          settled = true
          console.warn('[Share] 预生成超时(15s)，跳过该卡')
          resolve(false)
        }, 15000)
        shareCard.generate('shareCanvas', card, {
          cardKey: id,
          pageContext: self
        }).then(function (res) {
          if (settled) return
          wx.cloud.uploadFile({
            cloudPath: 'sharecards/card_' + id + '.jpg',
            filePath: res.tempFilePath,
            success: function (uploadRes) {
              if (settled) return
              settled = true
              clearTimeout(timer)
              var cloudFileID = uploadRes.fileID
              var shareUrl = storage.resolveCloudUrl(cloudFileID)
              console.log('[Share] 后台已生成分享图:', shareUrl)
              self._markShareImage(id, shareUrl, cloudFileID)
              resolve(true)
            },
            fail: function (err) {
              if (settled) return
              settled = true
              clearTimeout(timer)
              console.warn('[Share] 后台上传失败:', err)
              resolve(false)
            }
          })
        }).catch(function (err) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          console.warn('[Share] 后台生成失败:', err && err.message)
          resolve(false)
        })
      } catch (e) {
        console.warn('[Share] require shareCard 失败:', e)
        resolve(false)
      }
    })
  },

  /**
   * 同步获取可用于分享图自愈的 cards 源
   * 超时/失败回退中 setData 异步未生效，this.data.cards 不可靠；
   * 优先取同步可读的本地缓存 cardsCache，回退到已渲染的 data.cards
   */
  _getCacheCards() {
    try {
      var cc = app.getCache && app.getCache('cardsCache')
      if (cc && cc.length) return cc
    } catch (e) { /* ignore */ }
    return (this.data && this.data.cards) || []
  },

  /**
   * 预生成缺失分享图的排队器（loadCards 成功后调用）
   * 背景：分享图只依赖「用户上次保存/上次分享」时点写入的 shareImageUrl，一旦某次
   * Canvas 生成超时/失败，卡片就持续处于「分享显示头像」状态。这里在数据加载后
   * 主动补齐缺口，使用户分享时几乎总能命中 4a 预存图路径。
   * 串行执行（shareCard.generate 内部有全局 canvas 锁，逐张排队避免争抢）；
   * 每张卡有 in-flight 去重，单张失败不重试（下次 loadCards 再补），全部 fire-and-forget。
   */
  _ensureShareImages(cards) {
    var self = this
    if (!wx.cloud) return
    if (!self._shareGenRunning) self._shareGenRunning = {}
    var queue = (cards || []).filter(function (c) {
      // 存量自愈：无预存图「或」底色样式版本过期(历史透明底黑/白图) → 重生成
      var stale = !c.shareImageUrl || c.shareImageStyle !== storage.SHARE_IMAGE_STYLE
      return c && c._id && c.name && stale && !self._shareGenRunning[c._id]
    })
    if (!queue.length) return
    console.log('[Share] 预生成分享图，缺失数量:', queue.length)
    var i = 0
    var next = function () {
      if (i >= queue.length) return
      var card = queue[i++]
      self._shareGenRunning[card._id] = true
      self._generateAndPersistShareImage(card, card._id).then(function () {
        next()
      }, function () { next() })
    }
    next()
  },

  /**
   * onShareAppMessage — 微信分享入口
   *
   * 【关键约束】
   * - 基础库 < 2.12.0 不支持返回 Promise，必须同步 return
   * - 基础库 ≥ 2.12.0 支持 return Promise，但同步返回更可靠
   * - 策略：优先同步路径（预存图 / 头像降级），仅实时 Canvas 生成走异步
   *
   * options 参数（基础库 2.12.0+）：
   *   options.from === 'button' → open-type="share" 按钮触发
   *   options.target.dataset.id → data-id="{{item._id}}" 值
   */
  onShareAppMessage(options) {
    var id, card, path, title
    var self = this

    try {

    // ================================================================
    // 1. 解析卡片 ID（四级优先级，确保任意版本都能拿到）
    // ================================================================
    // (a) options.target.dataset — 基础库 2.12.0+
    if (options && options.from === 'button' && options.target && options.target.dataset) {
      id = options.target.dataset.id
    }
    // (b) bindtap → onShareButtonTap 预设的 _activeShare
    if (!id) {
      var active = self._activeShare || {}
      id = active.id || ''
    }
    // (c) this.data.shareCardId（setData 同步写入）
    if (!id) {
      id = self.data.shareCardId || ''
    }

    // ================================================================
    // 2. 根据 ID 查找完整卡片数据
    // ================================================================
    if (id && self.data.cards && self.data.cards.length > 0) {
      card = self.data.cards.find(function (c) { return c._id === id })
    }
    if (!card || !card.name) {
      card = (self._activeShare && self._activeShare.card) || self.data.shareCardData || {}
    }

    // ================================================================
    // 3. 构建分享参数
    // ================================================================
    path = id ? '/pages/preview/index?id=' + id + '&source=share' : '/pages/index/index'

    // 一次性分享留言：仅当本次分享（onShareButtonTap 预设）携带 note 时，追加 sid + note 到分享 path
    // sid/shareId 用于服务端去重与展示；note 经 encodeURIComponent 编码，接收端 decodeURIComponent 解码
    // 注意：self._activeShare 在函数末尾（清理共享状态处）被整体置 null，note/sid 必须在此之前被 path 用掉
    if (id && self._activeShare && self._activeShare.note) {
      path += '&sid=' + encodeURIComponent(self._activeShare.sid || '') + '&note=' + encodeURIComponent(self._activeShare.note)
    }

    title = shareUtil.buildShareTitle(card)

    console.log('[Share] onShareAppMessage',
      'from:', options && options.from,
      'id:', id,
      'hasName:', !!(card && card.name),
      'hasShareImage:', !!(card && card.shareImageUrl),
      'shareImageUrl:', (card && card.shareImageUrl) ? (card.shareImageUrl.substring(0, 80) + '...') : '(empty)',
      'title:', title,
      'path:', path,
      'cardsCount:', self.data.cards.length,
      'shareCardId:', self.data.shareCardId
    )

    // 清理共享状态
    self._activeShare = null

    // ================================================================
    // 4. 分享图获取（同步优先，异步兜底）
    // ================================================================

    // 4a. 已有「当前样式版本」预存分享图 → 同步返回 ✅
    // 注意：仅 shareImageUrl 存在不足以复用——历史透明底图(样式过期)必须重新生成
    if (self._isShareImageFresh(card)) {
      var imageUrl = self._cacheBustShareUrl(card.shareImageUrl)
      console.log('[Share] 4a 返回, finalUrl:', imageUrl)
      return { title: title, path: path, imageUrl: imageUrl }
    }

    // 4b. 无「当前版本」预存图（无图 或 样式过期）但有有效名片
    if (card && card.name && id) {
      // 样式过期的旧图：本次分享即实时重生成新图，避免把黑/白底旧图发出去
      var staleImage = !!card.shareImageUrl && !self._isShareImageFresh(card)
      if (staleImage && self._canUseSharePromise()) {
        console.log('[Share] 路径 4b — 样式过期，实时重生成(Promise)')
        return self._ensureShareImageUrl(card, id).then(function (url) {
          return { title: title, path: path, imageUrl: url || self._fallbackSync() }
        })
      }
      var fallbackUrl = self._resolveAvatarUrl(card.avatar)

      if (fallbackUrl) {
        // 有头像：同步返回头像（微信可显示），后台补生成预存图（下次分享走 4a）
        self._generateAndPersistShareImage(card, id)
        console.log('[Share] 路径 4b — 同步返回头像, fallbackUrl:', fallbackUrl)
        return { title: title, path: path, imageUrl: fallbackUrl }
      }

      // 无头像（同步返回会空白）：方案 A 实时生成真图；超时/失败走方案 B 兜底
      if (self._canUseSharePromise()) {
        console.log('[Share] 路径 4b — 无头像，走实时生成(Promise)')
        return self._ensureShareImageUrl(card, id).then(function (url) {
          return { title: title, path: path, imageUrl: url || self._fallbackSync() }
        })
      }
      // 不支持 Promise 的老基础库：同步返回兜底图（onShow 已预生成）
      console.log('[Share] 路径 4b — 无头像，老基础库走兜底图')
      return { title: title, path: path, imageUrl: self._fallbackSync() }
    }

    // 4c. 无有效名片数据 → 兜底图（永不空白）
    console.log('[Share] 路径 4c — 无有效名片, 走兜底图')
    return { title: title, path: path, imageUrl: self._fallbackSync() }

    } catch (e) {
      console.error('[Share] onShareAppMessage 异常:', e)
      return { title: title || '名片', path: path || '/pages/index/index', imageUrl: '' }
    }
  },

  onShareTimeline() {
    var active = this._activeShare || {}
    var card = active.card || this.data.shareCardData || {}
    var id = active.id || this.data.shareCardId || ''
    var query = id ? 'id=' + id : ''

    // 用「当前样式版本」预存分享图优先（cloud:// 转 HTTPS，朋友圈不支持 cloud://）
    // 样式过期的旧图不返回，改走兜底图（onShareTimeline 不支持异步等待）
    if (this._isShareImageFresh(card)) {
      var tlImage = this._cacheBustShareUrl(card.shareImageUrl)
      return { title: shareUtil.buildShareTitle(card), query: query, imageUrl: tlImage }
    }
    // 无有效分享图时：退回兜底图（onShow 已预生成，同步可用），避免朋友圈空白
    return { title: shareUtil.buildShareTitle(card), query: query, imageUrl: this._fallbackSync() }
  },

  goToPreview(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      app.showError('参数错误')
      return
    }

    console.log('[Index] 跳转到预览页, id:', id)
    wx.navigateTo({
      url: `/pages/preview/index?id=${id}`,
      fail: (err) => {
        console.error('[Index] 跳转失败:', err)
        app.showError('跳转失败')
      }
    })
  },

  goToCardList() {
    console.log('[Index] 切换到名片夹')
    wx.switchTab({
      url: '/pages/list/index',
      fail: (err) => {
        console.error('[Index] 切换失败:', err)
        app.showError('切换失败')
      }
    })
  },

  /**
   * 拉取「我的团队」数量，显示在首页底部团队按钮（我的团队 · N）
   * 带 5 分钟缓存，避免每次 onShow 都打云函数
   */
  loadTeamCount() {
    if (!wx.cloud) return
    var that = this
    var cached = app.getCache('teamCountCache')
    if (cached && Date.now() - cached.t < 300000) {
      that.setData({ teamCount: cached.count || 0 })
      return
    }
    teamUtil.callTeamManager('getMyTeams').then(function (res) {
      if (res.success && res.data && res.data.teams) {
        var count = (res.data.teams || []).length
        that.setData({ teamCount: count })
        app.setCache('teamCountCache', { count: count, t: Date.now() })
      }
    }).catch(function () {
      // 静默失败，保留上一值
    })
  },

  goTeamList() {
    console.log('[Index] 切换到我的团队列表')
    wx.switchTab({
      url: '/pages/team/list',
      fail: (err) => {
        console.error('[Index] 切换失败:', err)
        app.showError('切换失败')
      }
    })
  },

  /**
   * 添加到桌面
   * - Android: 调用 wx.showAddToDesktop() 一键添加（能力由 wx.canIUse 判定，免手写版本号）
   * - iOS: 不支持 API，引导手动操作
   * - 开发者工具: 不支持，提示真机预览
   * - 低版本微信: 降级为文字引导
   */
  addToDesktop() {
    let platform = this._devicePlatform || ''
    if (!platform) {
      const di = wx.getDeviceInfo ? wx.getDeviceInfo() : {}
      platform = (di.platform || di.system || '').toLowerCase()
    }

    // 开发者工具 / 模拟器不支持该 API，避免误导为权限问题
    if (platform === 'devtools') {
      wx.showModal({
        title: '添加到桌面',
        content: '开发者工具暂不支持「添加到桌面」，请在真机预览中体验',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    // iOS 不支持 API
    if (platform.indexOf('ios') >= 0) {
      wx.showModal({
        title: '添加到桌面',
        content: 'iOS 暂不支持一键添加。请点击右上角「...」→「添加到桌面」，或经 Safari「添加到主屏幕」',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    // 用官方能力判定替代手写版本比较（canIUse 始终与实际 API 对齐）
    if (typeof wx.canIUse === 'function' && !wx.canIUse('showAddToDesktop')) {
      wx.showModal({
        title: '添加到桌面',
        content: '当前微信版本较低，请点击右上角「...」→「添加到桌面」',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    // Android: 调用官方 API
    wx.showAddToDesktop({
      success: () => {
        wx.showToast({ title: '已发起添加，请按提示完成', icon: 'none', duration: 2500 })
      },
      fail: (err) => {
        console.warn('[Index] 添加桌面失败:', err)
        const errMsg = (err && err.errMsg) || ''
        if (errMsg.indexOf('cancel') >= 0 || errMsg.indexOf('canceled') >= 0) {
          // 用户取消，不提示
          return
        }
        wx.showModal({
          title: '添加失败',
          content: '请确认微信「桌面快捷方式」权限已开启（设置→应用→微信→权限），且小程序已正式上线',
          showCancel: false,
          confirmText: '知道了'
        })
      }
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
  }
})
