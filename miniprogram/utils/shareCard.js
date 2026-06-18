/**
 * shareCard.js — Canvas 分享卡片生成器
 * ==========================================
 * v8 — 5:4 比例导出（微信分享图规范），Banner 触顶 + 间隙居中
 * 内容区填充整个 Canvas 宽度（阴影自然溢出被裁切），不预留额外阴影留白
 *
 * 【复合布局 v4】
 * - 顶部横幅：「点击保存我的名片」浅蓝背景引导 (#D6EAF8)，锚定 y=0
 * - 透明间隙：Banner 与名片卡片之间的自然呼吸间距（上半部透明留白）
 * - 底部名片：与首页 WXML 完全一致的样式（cardStyle 单一数据源）
 * - 底部透明：下半部留白，使整体符合 5:4 比例
 * - 云端配置（config 集合 shareCardDimensions）可远程热更新画布宽度
 * - Canvas 操作带序列化锁（_canvasLock），防止多卡片并行生成时竞争
 */


// =========================================================================
// 统一样式配置（与首页 WXML 共用）
// =========================================================================
var cardStyle = require('../config/cardStyle')
var CARD = cardStyle.CARD
var rpxToCanvas = cardStyle.rpxToCanvas
var fitToBubbleSize = cardStyle.fitToBubbleSize
var calcCardHeight = cardStyle.calcCardHeight

// =========================================================================
// 默认尺寸（本地兜底，极端情况下使用）
// =========================================================================
var DEFAULT_DIMENSIONS = Object.freeze({ width: 702, height: 520 })

// =========================================================================
// 缓存开关
// =========================================================================
var ENABLE_SHARE_CACHE = true

// =========================================================================
// 内存缓存
// =========================================================================
var _imageCache = {}                    // 分享图片缓存: versionedKey → { tempFilePath, expireAt }
var _avatarImageCache = {}              // 头像图片缓存: avatarSrc → Image
var CACHE_TTL = 10 * 60 * 1000          // 分享图片缓存 10 分钟
var AVATAR_CACHE_MAX = 10               // 头像缓存最大数量
var AVATAR_LOAD_TIMEOUT = 15000         // 头像加载超时 15 秒

// =========================================================================
// Canvas 序列化锁（防多卡片并行生成时状态竞争）
// =========================================================================
var _canvasLock = Promise.resolve()

// =========================================================================
// 布局缓存：key = "宽度x高度_联系方式数"，不同联系方式数的卡片独立缓存
var _layoutCache = {}                // { key: layoutObject }
var _layoutPromise = {}              // 按联系方式数分键: { [contactCount]: Promise }（防并发）

// =========================================================================
// 公开: 获取当前生效的尺寸（供页面层绑定 Canvas 样式等）
// =========================================================================
function getCurrentDimensions() {
  // 从缓存中取任意一个 layout 获取基础尺寸
  var keys = Object.keys(_layoutCache)
  if (keys.length > 0) {
    var lo = _layoutCache[keys[0]]
    return { width: lo.w, height: lo.totalH }
  }
  var d = cardStyle.defaultCardCanvasSize()
  var bannerH = rpxToCanvas(CARD.bannerHeight, d.width)
  var fitted = fitToBubbleSize(d.width, d.height + bannerH)
  return { width: fitted.width, height: Math.round(fitted.width * 4 / 5) }
}

// =========================================================================
// 公开: 强制刷新布局（后台管理更新云端配置后，下次分享生效）
// =========================================================================
function refreshLayout() {
  _layoutCache = {}
  _layoutPromise = {}
  console.log('[shareCard] 布局配置已重置，下次生成时将重新获取')
}

// =========================================================================
// 核心: 布局计算（基于 cardStyle 统一样式配置）
// 所有坐标全部由 rpxToCanvas() 从 CARD 常量推导，确保与首页 WXSS 一致
// =========================================================================
function computeLayout(canvasW, canvasH) {
  var padding = rpxToCanvas(CARD.cardPadding, canvasW)

  var layout = {
    // 画布
    w: canvasW,
    h: canvasH,

    // 卡片内边距
    padding: padding,
    rightEdge: canvasW - padding,

    // 头像
    avatarSize: rpxToCanvas(CARD.avatarSize, canvasW),
    avatarRadius: rpxToCanvas(CARD.avatarRadius, canvasW),
    avatarX: padding,
    avatarY: padding,

    // 姓名（含最大宽度，防溢出截断）
    nameFontSize: rpxToCanvas(CARD.nameFontSize, canvasW),
    nameY: padding,
    nameMaxWidth: canvasW - padding * 2 - rpxToCanvas(CARD.avatarSize, canvasW) - rpxToCanvas(CARD.avatarRadius, canvasW),

    // 职位（含最大宽度，防溢出截断）
    positionFontSize: rpxToCanvas(CARD.positionFontSize, canvasW),
    positionGap: rpxToCanvas(CARD.positionGap, canvasW),
    positionY: padding + rpxToCanvas(CARD.nameFontSize, canvasW) + rpxToCanvas(CARD.positionGap, canvasW),
    positionMaxWidth: canvasW - padding * 2 - rpxToCanvas(CARD.avatarSize, canvasW) - rpxToCanvas(CARD.avatarRadius, canvasW),

    // 顶部区域底部（头像底部 or 文字底部，取较大者 + topGap）
    topGap: rpxToCanvas(CARD.topGap, canvasW),
    topMarginBottom: rpxToCanvas(CARD.topMarginBottom, canvasW),

    // 分割线
    dividerHeight: Math.max(1, rpxToCanvas(CARD.dividerHeight, canvasW)),
    dividerColor: CARD.dividerColor,
    dividerMarginBottom: rpxToCanvas(CARD.dividerMarginBottom, canvasW),

    // 公司名（含最大宽度，防溢出截断）
    companyFontSize: rpxToCanvas(CARD.companyFontSize, canvasW),
    companyMaxWidth: canvasW - padding * 2,

    // 联系方式（含最大宽度，防溢出截断）
    contactFontSize: rpxToCanvas(CARD.contactFontSize, canvasW),
    contactItemGap: rpxToCanvas(CARD.contactItemGap, canvasW),
    bodyGap: rpxToCanvas(CARD.bodyGap, canvasW),
    contactMaxWidth: canvasW - padding * 2,

    // 卡片圆角 & 边框
    cardBorderRadius: rpxToCanvas(CARD.cardBorderRadius, canvasW),
    cardBorderWidth: Math.max(1, rpxToCanvas(CARD.cardBorderWidth, canvasW))
  }

  // === 动态计算 Y 坐标 ===
  // card-top 底部位置
  var cardTopBottom = padding + Math.max(
    layout.avatarSize,                               // 头像高度
    layout.nameFontSize + layout.positionGap + layout.positionFontSize  // 文字区高度
  ) + layout.topGap

  // 分割线
  layout.cardTopBottom = cardTopBottom
  layout.dividerY = cardTopBottom + layout.topMarginBottom

  // 公司名
  layout.companyY = layout.dividerY + layout.dividerHeight + layout.dividerMarginBottom

  // 联系方式起始
  layout.contactY = layout.companyY + layout.companyFontSize + layout.bodyGap

  // 注意：不 freeze — _ensureLayout 会追加 bannerHeight/cardOffsetY/totalH
  return layout
}

// =========================================================================
// 计算卡片 Canvas 尺寸（含气泡适配）
// @param {object} card - 名片数据
// @returns {Promise<{width: number, height: number}>}
// =========================================================================
function _computeCanvasSize(card) {
  return _fetchBaseWidth().then(function (baseW) {
    // 联系方式的条数
    var contactCount = 0
    if (card.phone) contactCount++
    if (card.email) contactCount++
    if (card.address) contactCount++

    // 卡片自然尺寸（不含横幅）
    var naturalW = baseW
    var naturalH = calcCardHeight(naturalW, contactCount)

    // 横幅高度（px）
    var bannerH = rpxToCanvas(CARD.bannerHeight, naturalW)

    // 总宽度 = 卡片，总高度 = 卡片 + 横幅
    var totalW = naturalW
    var totalH = naturalH + bannerH

    // 气泡适配：对卡片+横幅做等比缩放
    var fitted = fitToBubbleSize(totalW, totalH)

    if (fitted.scale < 1) {
      console.log('[shareCard] 气泡适配 (含横幅):',
        totalW + 'x' + totalH + ' → ' + fitted.width + 'x' + fitted.height,
        '(scale:', (fitted.scale * 100).toFixed(0) + '%)')
    }

    // 强制导出 5:4 = 宽 × 4/5（微信分享图显示规范）
    var canvasTotalH = Math.round(fitted.width * 4 / 5)
    var extraTotal = canvasTotalH - fitted.height
    var extraTop = Math.floor(extraTotal / 2)

    console.log('[shareCard] 5:4 适配:', fitted.width + 'x' + fitted.height,
      '→', fitted.width + 'x' + canvasTotalH,
      '顶部留白:', extraTop, '底部留白:', (extraTotal - extraTop))

    return {
      width: fitted.width,          // 卡片内容宽度（气泡适配后）= Canvas 总宽度
      height: fitted.height,        // 内容实际高度（气泡适配后，用于 cardH 计算）
      bannerHeight: Math.round(bannerH * fitted.scale),
      cardHeight: Math.round(naturalH * fitted.scale),
      canvasTotalH: canvasTotalH,   // 导出目标高度 = width × 4/5 = 480
      extraTop: extraTop            // 顶部透明留白（使内容垂直居中于 5:4 画布）
    }
  })
}

// =========================================================================
// 获取基准卡片宽度（云端优先 → cardStyle 默认）
// =========================================================================
function _fetchBaseWidth() {
  return new Promise(function (resolve) {
    try {
      var db = wx.cloud.database()
      db.collection('config')
        .where({ _key: 'shareCardDimensions' })
        .limit(1)
        .get()
        .then(function (res) {
          if (res.data && res.data.length > 0) {
            var val = res.data[0]
            var w = parseInt(val.width) || 0
            if (w >= 400) {
              console.log('[shareCard] 云端配置卡片宽度:', w)
              resolve(w)
              return
            }
          }
          resolve(CARD.cardWidth)
        })
        .catch(function () {
          resolve(CARD.cardWidth)
        })
    } catch (e) {
      resolve(CARD.cardWidth)
    }
  })
}

// =========================================================================
// 布局初始化（异步，带缓存）
// =========================================================================
function _ensureLayout(card) {
  // 计算联系方式条数
  var contactCount = 0
  if (card.phone) contactCount++
  if (card.email) contactCount++
  if (card.address) contactCount++
  // 限制 0-3
  if (contactCount < 0) contactCount = 0
  if (contactCount > 3) contactCount = 3

  // 已缓存的 layout key
  var cacheKey = contactCount + 'c'  // e.g. "2c" 表示 2 条联系方式

  // 命中缓存 → 直接返回
  if (_layoutCache[cacheKey]) {
    return Promise.resolve(_layoutCache[cacheKey])
  }

  // 同一联系方式数的布局正在获取 → 复用进行中的 Promise
  if (_layoutPromise[cacheKey]) {
    return _layoutPromise[cacheKey]
  }

  _layoutPromise[cacheKey] = _computeCanvasSize(card)
    .then(function (dims) {
      var bannerH = dims.bannerHeight || 0
      var cardH = dims.height - bannerH

      var layout = computeLayout(dims.width, cardH)
      layout.bannerHeight = bannerH
      // 卡片从 Banner 底部 + 透明间隙开始（v8：间隙在 Banner 与卡片之间）
      var gapTop = dims.extraTop || 0
      layout.bannerHeight = bannerH
      layout.cardOffsetY = bannerH + gapTop         // card starts after banner + gap
      layout.totalH = dims.canvasTotalH             // 480 — 5:4 导出高度
      layout.extraTop = gapTop                      // 保留供 generate 日志用
      layout.contactCount = contactCount

      // 按联系方式数缓存
      _layoutCache[cacheKey] = layout
      _layoutPromise[cacheKey] = null

      console.log('[shareCard] 布局就绪:', dims.width + 'x' + dims.height,
        '→ canvas', dims.width + 'x' + dims.canvasTotalH,
        'contacts:', contactCount, 'banner:', bannerH, 'card:', cardH,
        'gap:', gapTop)
      return layout
    })
    .catch(function (err) {
      console.error('[shareCard] 布局初始化失败:', err)
      var dw = DEFAULT_DIMENSIONS.width
      var dh = DEFAULT_DIMENSIONS.height
      var bannerFallback = rpxToCanvas(CARD.bannerHeight, dw)
      var fitted = fitToBubbleSize(dw, dh + bannerFallback)
      var canvasTotalH_FB = Math.round(fitted.width * 4 / 5)
      var extraTop_FB = Math.floor((canvasTotalH_FB - fitted.height) / 2)
      var layout = computeLayout(fitted.width, dh)
      layout.bannerHeight = bannerFallback
      layout.cardOffsetY = bannerFallback + extraTop_FB
      layout.totalH = canvasTotalH_FB
      layout.extraTop = extraTop_FB
      layout.contactCount = contactCount

      _layoutCache[cacheKey] = layout
      _layoutPromise[cacheKey] = null
      return layout
    })

  return _layoutPromise[cacheKey]
}

// =========================================================================
// 公开 API: generate(canvasId, card, options)
// =========================================================================
function generate(canvasId, card, options) {
  options = options || {}
  var cardKey = options.cardKey || (card._id || 'shareCard')
  var pageContext = options.pageContext || null  // 【修复】页面作用域，确保真机 type="2d" canvas 可查
  var now = Date.now()

  // 1. 确保布局已就绪（含气泡适配，按联系人数缓存）
  return _ensureLayout(card).then(function (layout) {
    // 缓存 key：含卡片数据版本，修改后 updateTime 变化 → 自动失效
    // 降级链：_updateTime → updateTime → updatetime → createTime → _id
    var dataVersion = card._updateTime || card.updateTime || card.updatetime || card.createTime || card._id || ''
    var versionedKey = cardKey + '_' + layout.w + 'x' + layout.totalH + '_' + layout.contactCount + 'c_v' + dataVersion

    // 2. 检查缓存（key 含尺寸版本）
    if (ENABLE_SHARE_CACHE) {
      var cached = _imageCache[versionedKey]
      if (cached && cached.expireAt > now && cached.tempFilePath) {
        console.log('[shareCard] 命中缓存:', versionedKey)
        return { tempFilePath: cached.tempFilePath }
      }
    }

    // 3. Canvas 绘制 — 通过序列化锁排队，防止多卡片并行时状态竞争
    // chain the lock: nextTask = _canvasLock.then(() => doWork())
    var resultPromise = _canvasLock.then(function () {
      return new Promise(function (resolve, reject) {
        var canvasW = layout.w
        console.log('[shareCard] 生成分享卡片, key:', versionedKey,
          'dim:', canvasW + 'x' + layout.totalH,
          'cardW:', layout.w, 'banner:', layout.bannerHeight, 'name:', card.name)

        var selector = canvasId
        if (selector.indexOf('#') !== 0) {
          selector = '#' + canvasId
        }

        // 【修复】使用 .in(pageContext) 确保在真机上正确找到 type="2d" Canvas 节点
        var query = pageContext
          ? wx.createSelectorQuery().in(pageContext)
          : wx.createSelectorQuery()
        query.select(selector)
          .fields({ node: true, size: true })
          .exec(function (canvasRes) {
            if (!canvasRes || !canvasRes[0] || !canvasRes[0].node) {
              console.error('[shareCard] Canvas 节点未找到:', canvasId)
              reject(new Error('Canvas 节点未找到'))
              return
            }

            var canvas = canvasRes[0].node
            var ctx = canvas.getContext('2d')
            var dpr = _getDpr()

            // 画布尺寸 = 卡片内容宽度 × 5:4 导出高度
            // totalH 已是 480（width × 4/5），确保微信分享图不被裁剪
            canvas.width = canvasW * dpr
            canvas.height = layout.totalH * dpr
            ctx.scale(dpr, dpr)

            // 透明背景 — Banner 从 y=0 触顶，卡片从 bannerH+gap 开始
            ctx.clearRect(0, 0, canvasW, layout.totalH)

            // 加载头像
            _loadAvatarToCanvas(card.avatar, canvas).then(function (avatarImg) {
              _drawLayout(ctx, card, avatarImg, layout)
              _exportAndResolve(canvas, versionedKey, now, layout, resolve, reject)
            }).catch(function (err) {
              console.warn('[shareCard] 头像加载异常，降级绘制:', err && err.message)
              _drawLayout(ctx, card, null, layout)
              _exportAndResolve(canvas, versionedKey, now, layout, resolve, reject)
            })
          })
      })
    })

    // 更新锁引用：无论成功失败都不影响后续任务执行
    _canvasLock = resultPromise.then(function () {}, function () {})
    return resultPromise
  })
}

// =========================================================================
// 资源加载
// =========================================================================

function _loadAvatarToCanvas(avatarSrc, canvas) {
  return new Promise(function (resolve) {
    if (!avatarSrc) {
      console.log('[shareCard] 头像源为空')
      resolve(null)
      return
    }

    var cachedAvatar = _avatarImageCache[avatarSrc]
    if (cachedAvatar) {
      console.log('[shareCard] 命中头像缓存:', avatarSrc.substring(0, 60))
      resolve(cachedAvatar)
      return
    }

    var urlPromise = Promise.resolve(avatarSrc)
    if (avatarSrc.indexOf('cloud://') === 0) {
      urlPromise = _resolveToHttps(avatarSrc)
    }

    urlPromise.then(function (url) {
      if (!url) {
        console.warn('[shareCard] URL 转换失败')
        resolve(null)
        return
      }

      var img = canvas.createImage()
      var settled = false

      var timer = setTimeout(function () {
        if (settled) return
        settled = true
        console.warn('[shareCard] 头像加载超时:', url.substring(0, 80))
        resolve(null)
      }, AVATAR_LOAD_TIMEOUT)

      img.onload = function () {
        if (settled) return
        settled = true
        clearTimeout(timer)
        console.log('[shareCard] 头像加载成功:', url.substring(0, 60))
        _putAvatarCache(avatarSrc, img)
        resolve(img)
      }
      img.onerror = function (err) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        console.warn('[shareCard] 头像加载失败:', url.substring(0, 80), err)
        resolve(null)
      }
      img.src = url
    }).catch(function () {
      resolve(null)
    })
  })
}


function _putAvatarCache(key, image) {
  var keys = Object.keys(_avatarImageCache)
  if (keys.length >= AVATAR_CACHE_MAX) {
    delete _avatarImageCache[keys[0]]
  }
  _avatarImageCache[key] = image
}

// =========================================================================
// cloud:// → HTTPS 转换（云存储已设为所有用户可读，直接拼永久 URL）
// =========================================================================

function _resolveToHttps(src) {
  if (!src) return Promise.resolve('')

  if (src.indexOf('https://') === 0) {
    return Promise.resolve(src)
  }

  if (src.indexOf('cloud://') === 0) {
    var STORAGE_BASE = 'https://636c-cloudbase-d0gqgpu422d7e544f-1432712671.tcb.qcloud.la'
    var path = src.replace('cloud://', '').split('/').slice(1).join('/')
    var url = STORAGE_BASE + '/' + path
    return Promise.resolve(url)
  }

  return Promise.resolve(src)
}

// =========================================================================
// 工具: DPR
// =========================================================================

function _getDpr() {
  try {
    return wx.getSystemInfoSync().pixelRatio || 2
  } catch (e) {
    return 2
  }
}

// =========================================================================
// Canvas 导出 — 本地 temp 路径，由 index.js 直接用作 imageUrl
// =========================================================================

function _exportAndResolve(canvas, versionedKey, now, layout, resolve, reject) {
  var exportW = layout.w
  wx.canvasToTempFilePath({
    canvas: canvas,
    x: 0, y: 0,
    width: exportW, height: layout.totalH,
    destWidth: exportW, destHeight: layout.totalH,
    fileType: 'jpg',       // PNG 易超 128KB 被微信丢弃；JPEG 可控制在 30-60KB
    quality: 0.7,          // 0.7 画质对文字卡片足够，远低于 128KB 限制
    success: function (tempRes) {
      console.log('[shareCard] 图片导出成功, size:', (tempRes.tempFilePath || '').length)
      if (ENABLE_SHARE_CACHE) {
        _imageCache[versionedKey] = {
          tempFilePath: tempRes.tempFilePath,
          expireAt: now + CACHE_TTL
        }
      }
      resolve({ tempFilePath: tempRes.tempFilePath })
    },
    fail: function (err) {
      console.error('[shareCard] canvasToTempFilePath 失败', err)
      reject(err)
    }
  })
}

// =========================================================================
// 绘制: 主布局（v8 — Banner 触顶 + 间隙 + 卡片，5:4 导出）
// =========================================================================

/**
 * 绘制整套分享卡片（横幅 + 名片，与首页视觉一致）
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} card - 名片数据
 * @param {Image|null} avatarImg - 已加载的头像 Image 对象
 * @param {object} layout - computeLayout() 计算结果（含 bannerHeight/cardOffsetY/totalH）
 */
function _drawLayout(ctx, card, avatarImg, layout) {

  // === 0. 顶部横幅（引导点击保存名片） ===
  _drawBanner(ctx, layout)

  // === 卡片区域偏移 ===
  var offY = layout.cardOffsetY || 0

  ctx.save()
  ctx.translate(0, offY)

  // === 1. 卡片背景（圆角 + 阴影 + 白色填充 + 边框） ===
  _drawCardBg(ctx, layout)

  // === 2. card-top（头像 + 姓名 + 职位） ===
  _drawAvatar(ctx, avatarImg,
    layout.avatarX, layout.avatarY,
    layout.avatarSize, layout.avatarRadius)

  // 姓名（右对齐，Georgia 字体，防溢出截断）
  ctx.fillStyle = CARD.nameColor
  ctx.font = CARD.nameFontWeight + ' ' + layout.nameFontSize + 'px ' + CARD.nameFontFamily
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  var nameText = _truncateText(ctx, card.name || '', layout.nameMaxWidth)
  ctx.fillText(nameText, layout.rightEdge, layout.nameY)

  // 职位（防溢出截断）
  ctx.fillStyle = CARD.positionColor
  ctx.font = layout.positionFontSize + 'px PingFang SC, sans-serif'
  var posText = _truncateText(ctx, card.position || '', layout.positionMaxWidth)
  ctx.fillText(posText, layout.rightEdge, layout.positionY)

  // === 3. 分割线 ===
  ctx.fillStyle = CARD.dividerColor
  ctx.fillRect(layout.padding, layout.dividerY,
    layout.w - layout.padding * 2, layout.dividerHeight)

  // === 4. card-body（公司名 + 联系方式） ===
  ctx.fillStyle = CARD.companyColor
  ctx.font = CARD.companyFontWeight + ' ' + layout.companyFontSize + 'px PingFang SC, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(_truncateText(ctx, card.company || '', layout.companyMaxWidth),
    layout.padding, layout.companyY)

  _drawContactInfo(ctx, card, layout)

  ctx.restore()
}

// =========================================================================
// 绘制: 顶部横幅（引导点击保存名片）
// =========================================================================

function _drawBanner(ctx, layout) {
  var bh = layout.bannerHeight || 0
  if (bh <= 0) return

  // 浅蓝背景填满卡片全宽
  ctx.fillStyle = CARD.bannerBg
  ctx.fillRect(0, 0, layout.w, bh)

  // 居中文字
  ctx.fillStyle = CARD.bannerTextColor
  ctx.font = CARD.bannerTextWeight + ' ' + Math.round(bh * 0.3) + 'px PingFang SC, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(CARD.bannerText, layout.w / 2, bh / 2)
}

// =========================================================================
// 绘制: 卡片背景（圆角 + 阴影 + 白色 + 边框）
// =========================================================================

function _drawCardBg(ctx, layout) {
  var r = layout.cardBorderRadius
  var w = layout.w
  var h = layout.h

  // 阴影（与 WXSS 的 box-shadow: 0 8rpx 32rpx rgba(0,0,0,0.08) 一致）
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)'
  ctx.shadowBlur = rpxToCanvas(CARD.cardShadowBlur, w)
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = rpxToCanvas(CARD.cardShadowOffsetY, w)
  _drawRoundRect(ctx, 0, 0, w, h, r)
  ctx.fillStyle = CARD.cardBg
  ctx.fill()
  ctx.restore()

  // 白色背景
  _drawRoundRect(ctx, 0, 0, w, h, r)
  ctx.fillStyle = CARD.cardBg
  ctx.fill()

  // 边框
  ctx.strokeStyle = CARD.cardBorderColor
  ctx.lineWidth = layout.cardBorderWidth
  _drawRoundRect(ctx, 0, 0, w, h, r)
  ctx.stroke()
}

// =========================================================================
// 绘制: 头像
// =========================================================================

function _drawAvatar(ctx, avatarImg, x, y, size, radius) {
  if (!avatarImg) {
    var gradient = ctx.createLinearGradient(x, y, x + size, y + size)
    gradient.addColorStop(0, CARD.avatarPlaceholderGradientStart)
    gradient.addColorStop(1, CARD.avatarPlaceholderGradientEnd)
    ctx.fillStyle = gradient
    _drawRoundRect(ctx, x, y, size, size, radius)
    ctx.fill()

    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold ' + Math.round(size * 0.4) + 'px PingFang SC, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('名', x + size / 2, y + size / 2)
    return
  }

  ctx.save()
  _drawRoundRect(ctx, x, y, size, size, radius)
  ctx.clip()
  ctx.drawImage(avatarImg, x, y, size, size)
  ctx.restore()
}

// =========================================================================
// 绘制: 圆角矩形
// =========================================================================

function _drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

// =========================================================================
// 绘制: 联系方式
// =========================================================================

function _drawContactInfo(ctx, card, layout) {
  var items = []
  if (card.phone) items.push(card.phone)
  if (card.email) items.push(card.email)
  if (card.address) items.push(card.address)

  ctx.fillStyle = CARD.contactColor
  ctx.font = layout.contactFontSize + 'px PingFang SC, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'

  var maxTextW = layout.contactMaxWidth

  for (var i = 0; i < items.length; i++) {
    var text = _truncateText(ctx, items[i], maxTextW)
    ctx.fillText(text, layout.rightEdge, layout.contactY + i * layout.contactItemGap)
  }
}

// =========================================================================
// 工具: 截断超长文本（Canvas fillText 无自动换行，超宽文本会溢出）
// =========================================================================

function _truncateText(ctx, text, maxWidth) {
  if (!text) return ''
  var metrics = ctx.measureText(text)
  if (metrics.width <= maxWidth) return text

  // 二分查找截断点
  var lo = 0
  var hi = text.length
  while (lo < hi) {
    var mid = Math.floor((lo + hi + 1) / 2)
    var sample = text.substring(0, mid) + '...'
    if (ctx.measureText(sample).width <= maxWidth) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return text.substring(0, lo) + '...'
}

// =========================================================================
// 导出
// =========================================================================

module.exports = {
  generate: generate,
  getCurrentDimensions: getCurrentDimensions,
  refreshLayout: refreshLayout
}
