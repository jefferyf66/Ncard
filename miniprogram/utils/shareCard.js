/**
 * shareCard.js — Canvas 分享卡片生成器
 * ==========================================
 * 布局：顶部浅蓝色占位（"点击保存我的名片"）+ 名片主体（与首页一致）
 *
 * 【动态适配系统 v2】
 * - 所有布局坐标由 computeLayout(w, h) 按比例自动计算，换尺寸无需
 *   逐行改像素
 * - 云端配置（config 集合 shareCardDimensions）可远程热更新画布尺寸，
 *   无需发布小程序
 * - 缓存 key 含尺寸版本号，换尺寸后旧缓存自动失效
 * - 本地兜底：云端不可用时回到 800×400 默认尺寸
 */

const app = getApp()

// =========================================================================
// 默认尺寸（本地兜底，云端不可用时使用）
// =========================================================================
var DEFAULT_DIMENSIONS = Object.freeze({ width: 800, height: 400 })

// =========================================================================
// 缓存开关
// =========================================================================
var ENABLE_SHARE_CACHE = true

// =========================================================================
// 颜色常量（与尺寸无关）
// =========================================================================
var C_BODY = '#475569'
var C_DIVIDER = 'rgba(0, 0, 0, 0.08)'
var C_PRIMARY = '#1E293B'
var C_SECONDARY = '#64748B'
var C_BANNER_BG = '#E0F2FE'
var C_BANNER_TEXT = '#0369A1'

// =========================================================================
// 字体常量
// =========================================================================
var FONT_FAMILY = 'PingFang SC, sans-serif'
var FONT_NAME = 'Georgia, Times New Roman, serif'

// =========================================================================
// 资源路径
// =========================================================================
var APP_ICON_PATH = '/images/icons/logo-app-144.png'

// =========================================================================
// 内存缓存
// =========================================================================
var _imageCache = {}                    // 分享图片缓存: versionedKey → { tempFilePath, expireAt }
var _avatarImageCache = {}              // 头像图片缓存: avatarSrc → Image
var _appIconImage = null                // 小程序图标单例
var CACHE_TTL = 10 * 60 * 1000          // 分享图片缓存 10 分钟
var AVATAR_CACHE_MAX = 10               // 头像缓存最大数量
var AVATAR_LOAD_TIMEOUT = 15000         // 头像加载超时 15 秒

// =========================================================================
// 动态适配状态
// =========================================================================
var _activeLayout = null                // computeLayout() 计算结果（缓存）
var _layoutVersion = ''                 // 尺寸版本号，如 "800x400"
var _layoutPromise = null               // 正在进行的配置获取 Promise（防并发）

// =========================================================================
// 公开: 获取当前生效的尺寸（供页面层绑定 Canvas 样式等）
// =========================================================================
function getCurrentDimensions() {
  if (_activeLayout) {
    return { width: _activeLayout.w, height: _activeLayout.h }
  }
  return { width: DEFAULT_DIMENSIONS.width, height: DEFAULT_DIMENSIONS.height }
}

// =========================================================================
// 公开: 强制刷新布局（后台管理更新云端配置后，下次分享生效）
// =========================================================================
function refreshLayout() {
  _activeLayout = null
  _layoutVersion = ''
  _layoutPromise = null
  console.log('[shareCard] 布局配置已重置，下次生成时将重新获取')
}

// =========================================================================
// 核心: 比例化布局计算
// 所有坐标全部由 w/h 按比例推导，换尺寸只需改入参
// =========================================================================
function computeLayout(w, h) {
  var contentH = h * 0.75           // 下半部分名片主体高度
  var padding = Math.round(w * 0.05)   // 水平内边距 = 5% 宽度
  var bannerH = Math.round(h * 0.25)   // 顶部 Banner 高度 = 25% 总高
  var avatarSize = Math.round(contentH * 0.367) // 头像 ≈ 36.7% 内容区高度
  var avatarRadius = Math.round(avatarSize * 0.145) // 圆角 ≈ 16px @110

  // 字体大小：均按画布宽度百分比计算，保持视觉比例一致
  var nameFontSize = Math.round(w * 0.06)       // 48px @800
  var positionFontSize = Math.round(w * 0.03)   // 24px @800
  var companyFontSize = Math.round(w * 0.0325)  // 26px @800
  var contactFontSize = Math.round(w * 0.025)   // 20px @800
  var bannerFontSize = Math.round(h * 0.08)     // 32px @400

  return Object.freeze({
    // 画布
    w: w,
    h: h,

    // Banner 区域
    bannerH: bannerH,
    bannerFontSize: bannerFontSize,
    appIconSize: Math.round(bannerH * 0.4),     // 40px @100
    appIconPadding: Math.round(bannerH * 0.2),  // 20px @100
    appIconRadius: Math.round(bannerH * 0.08),  // 8px @100

    // 内容区起始
    contentStartY: bannerH,
    padding: padding,
    rightEdge: w - padding,

    // 头像
    avatarSize: avatarSize,
    avatarRadius: Math.max(4, avatarRadius),
    avatarX: padding,
    avatarY: bannerH + Math.round(contentH * 0.06),      // +18px @300

    // 文字区（右对齐）
    nameFontSize: Math.max(18, nameFontSize),
    nameY: bannerH + Math.round(contentH * 0.047),        // +14px @300
    positionFontSize: Math.max(12, positionFontSize),
    positionY: bannerH + Math.round(contentH * 0.047)
               + Math.round(w * 0.0675),                  // +54px @800

    // 分割线
    dividerY: bannerH + avatarSize + Math.round(contentH * 0.067), // +20px
    dividerHeight: Math.max(1, Math.round(h * 0.005)),   // 2px @400
    dividerColor: C_DIVIDER,

    // 公司名
    companyFontSize: Math.max(14, companyFontSize),
    companyY: bannerH + avatarSize + Math.round(contentH * 0.127), // +38px

    // 联系方式
    contactFontSize: Math.max(10, contactFontSize),
    contactY: bannerH + avatarSize + Math.round(contentH * 0.24),  // +72px
    contactGap: Math.round(h * 0.075),                    // 30px @400
  })
}

// =========================================================================
// 云端配置获取（异步，仅首次调用时请求网络）
// =========================================================================
function _ensureLayout() {
  // 已缓存 → 直接返回
  if (_activeLayout) {
    return Promise.resolve(_activeLayout)
  }

  // 正在获取 → 复用进行中的 Promise（防并发）
  if (_layoutPromise) {
    return _layoutPromise
  }

  _layoutPromise = _fetchRemoteDimensions()
    .then(function (dims) {
      _activeLayout = computeLayout(dims.width, dims.height)
      _layoutVersion = dims.width + 'x' + dims.height
      _layoutPromise = null
      console.log('[shareCard] 布局就绪:', _layoutVersion,
        'bannerH:', _activeLayout.bannerH,
        'avatarSize:', _activeLayout.avatarSize)
      return _activeLayout
    })
    .catch(function (err) {
      // 极端情况兜底
      console.error('[shareCard] 布局初始化失败:', err)
      _activeLayout = computeLayout(
        DEFAULT_DIMENSIONS.width,
        DEFAULT_DIMENSIONS.height
      )
      _layoutVersion = DEFAULT_DIMENSIONS.width + 'x' + DEFAULT_DIMENSIONS.height
      _layoutPromise = null
      return _activeLayout
    })

  return _layoutPromise
}

/**
 * 从云数据库 config 集合读取远程尺寸配置
 * 
 * 云数据库文档结构：
 *   collection: config
 *   document: { _key: "shareCardDimensions", width: 800, height: 400 }
 * 
 * 读取失败 → 使用 DEFAULT_DIMENSIONS
 * 值不合法 → 使用 DEFAULT_DIMENSIONS
 * 
 * @returns {Promise<{width: number, height: number}>}
 */
function _fetchRemoteDimensions() {
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
            var h = parseInt(val.height) || 0
            if (w >= 400 && h >= 200) {
              console.log('[shareCard] 云端配置尺寸:', w, 'x', h)
              resolve({ width: w, height: h })
              return
            }
            console.warn('[shareCard] 云端配置尺寸不合法 (w>=400, h>=200):', w, 'x', h)
          } else {
            console.log('[shareCard] 云端未配置 shareCardDimensions，使用默认值')
          }
          resolve(DEFAULT_DIMENSIONS)
        })
        .catch(function (err) {
          console.warn('[shareCard] 云端配置读取失败，使用默认尺寸:', err && err.message)
          resolve(DEFAULT_DIMENSIONS)
        })
    } catch (e) {
      // wx.cloud 不可用（开发环境未初始化云开发）
      console.warn('[shareCard] 云开发不可用，使用默认尺寸')
      resolve(DEFAULT_DIMENSIONS)
    }
  })
}

// =========================================================================
// 公开 API: generate(canvasId, card, options)
// =========================================================================
function generate(canvasId, card, options) {
  options = options || {}
  var cardKey = options.cardKey || (card._id || 'shareCard')
  var now = Date.now()

  // 1. 确保布局已就绪
  return _ensureLayout().then(function (layout) {
    var versionedKey = cardKey + '_' + _layoutVersion

    // 2. 检查缓存（key 含尺寸版本）
    if (ENABLE_SHARE_CACHE) {
      var cached = _imageCache[versionedKey]
      if (cached && cached.expireAt > now && cached.tempFilePath) {
        console.log('[shareCard] 命中缓存:', versionedKey)
        return { tempFilePath: cached.tempFilePath }
      }
    }

    // 3. Canvas 绘制
    console.log('[shareCard] 生成分享卡片, key:', versionedKey,
      'dim:', layout.w + 'x' + layout.h, 'name:', card.name)

    return new Promise(function (resolve, reject) {
      var selector = canvasId
      if (selector.indexOf('#') !== 0) {
        selector = '#' + canvasId
      }

      wx.createSelectorQuery()
        .select(selector)
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

          // 使用动态布局尺寸
          canvas.width = layout.w * dpr
          canvas.height = layout.h * dpr
          ctx.scale(dpr, dpr)

          // 白色背景
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, layout.w, layout.h)

          // 并行加载资源
          Promise.all([
            _loadAppIcon(canvas),
            _loadAvatarToCanvas(card.avatar, canvas)
          ]).then(function (results) {
            var iconReady = results[0]
            var avatarReady = results[1]
            console.log('[shareCard] 资源就绪 - 图标:', iconReady, ', 头像:', avatarReady)
            _drawLayout(ctx, card, avatarReady ? card.avatar : null, iconReady, layout)
            _exportAndResolve(canvas, versionedKey, now, layout, resolve, reject)
          }).catch(function (err) {
            console.warn('[shareCard] 资源加载异常，降级绘制:', err && err.message)
            _drawLayout(ctx, card, null, false, layout)
            _exportAndResolve(canvas, versionedKey, now, layout, resolve, reject)
          })
        })
    })
  })
}

// =========================================================================
// 资源加载
// =========================================================================

function _loadAppIcon(canvas) {
  return new Promise(function (resolve) {
    if (_appIconImage) {
      console.log('[shareCard] 小程序图标已缓存')
      resolve(true)
      return
    }

    var img = canvas.createImage()
    img.onload = function () {
      console.log('[shareCard] 小程序图标加载成功')
      _appIconImage = img
      resolve(true)
    }
    img.onerror = function (err) {
      console.warn('[shareCard] 小程序图标加载失败:', err)
      resolve(false)
    }
    img.src = APP_ICON_PATH
  })
}

function _loadAvatarToCanvas(avatarSrc, canvas) {
  return new Promise(function (resolve) {
    if (!avatarSrc) {
      console.log('[shareCard] 头像源为空')
      resolve(false)
      return
    }

    var cachedAvatar = _avatarImageCache[avatarSrc]
    if (cachedAvatar) {
      console.log('[shareCard] 命中头像缓存:', avatarSrc.substring(0, 60))
      _loadedAvatar = cachedAvatar
      resolve(true)
      return
    }

    var urlPromise = Promise.resolve(avatarSrc)
    if (avatarSrc.indexOf('cloud://') === 0) {
      urlPromise = _resolveToHttps(avatarSrc)
    }

    urlPromise.then(function (url) {
      if (!url) {
        console.warn('[shareCard] URL 转换失败')
        resolve(false)
        return
      }

      var img = canvas.createImage()
      var settled = false

      var timer = setTimeout(function () {
        if (settled) return
        settled = true
        console.warn('[shareCard] 头像加载超时:', url.substring(0, 80))
        resolve(false)
      }, AVATAR_LOAD_TIMEOUT)

      img.onload = function () {
        if (settled) return
        settled = true
        clearTimeout(timer)
        console.log('[shareCard] 头像加载成功:', url.substring(0, 60))
        _putAvatarCache(avatarSrc, img)
        _loadedAvatar = img
        resolve(true)
      }
      img.onerror = function (err) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        console.warn('[shareCard] 头像加载失败:', url.substring(0, 80), err)
        resolve(false)
      }
      img.src = url
    }).catch(function () {
      resolve(false)
    })
  })
}

var _loadedAvatar = null

function _putAvatarCache(key, image) {
  var keys = Object.keys(_avatarImageCache)
  if (keys.length >= AVATAR_CACHE_MAX) {
    delete _avatarImageCache[keys[0]]
  }
  _avatarImageCache[key] = image
}

// =========================================================================
// cloud:// → HTTPS 转换（三级降级）
// =========================================================================

function _resolveToHttps(src) {
  if (!src) return Promise.resolve('')

  if (src.indexOf('https://') === 0) {
    console.log('[shareCard] 头像已是 HTTPS，直接使用')
    return Promise.resolve(src)
  }

  if (src.indexOf('cloud://') === 0) {
    console.log('[shareCard] 头像为 cloud:// 格式，调用 resolveCloudUrls 云函数转换')
    return app.resolveCloudFileIDs([src]).then(function (urlMap) {
      var httpsUrl = urlMap[src]
      if (httpsUrl) {
        console.log('[shareCard] resolveCloudUrls 成功:', httpsUrl.substring(0, 80))
        return httpsUrl
      }
      console.warn('[shareCard] resolveCloudUrls 返回空结果，尝试降级 getTempFileURL')
      return _resolveViaTempFileURL(src)
    }).catch(function (err) {
      console.warn('[shareCard] resolveCloudUrls 调用失败:', err && err.message)
      return _resolveViaTempFileURL(src)
    })
  }

  return Promise.resolve(src)
}

function _resolveViaTempFileURL(fileID) {
  return new Promise(function (resolve) {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: function (res) {
        var url = (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) || ''
        if (url) {
          console.log('[shareCard] getTempFileURL 降级成功:', url.substring(0, 80))
        } else {
          console.warn('[shareCard] getTempFileURL 降级也失败: 无有效 URL')
        }
        resolve(url)
      },
      fail: function (err) {
        console.error('[shareCard] getTempFileURL 降级失败:', err)
        resolve('')
      }
    })
  })
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
// Canvas 导出
// =========================================================================

function _exportAndResolve(canvas, versionedKey, now, layout, resolve, reject) {
  wx.canvasToTempFilePath({
    canvas: canvas,
    x: 0, y: 0,
    width: layout.w, height: layout.h,
    destWidth: layout.w, destHeight: layout.h,
    fileType: 'jpg',
    quality: 0.9,
    success: function (tempRes) {
      console.log('[shareCard] 图片导出成功, key:', versionedKey)
      if (ENABLE_SHARE_CACHE) {
        _imageCache[versionedKey] = {
          tempFilePath: tempRes.tempFilePath,
          expireAt: now + CACHE_TTL
        }
      }
      resolve({ tempFilePath: tempRes.tempFilePath })
    },
    fail: function (err) {
      console.error('[shareCard] canvasToTempFilePath 失败, key:', versionedKey, 'error:', err)
      reject(err)
    }
  })
}

// =========================================================================
// 绘制: 主布局
// =========================================================================

/**
 * 绘制整套分享卡片布局
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} card - 名片数据
 * @param {string|null} avatarSrc - 头像 URL（已解析）
 * @param {boolean} iconReady - 小程序图标是否加载完成
 * @param {object} layout - computeLayout() 计算结果
 */
function _drawLayout(ctx, card, avatarSrc, iconReady, layout) {
  // === Banner 区域 ===
  ctx.fillStyle = C_BANNER_BG
  ctx.fillRect(0, 0, layout.w, layout.bannerH)

  if (iconReady && _appIconImage) {
    _drawAppIcon(ctx, layout.appIconPadding, layout.appIconPadding, layout)
  }

  ctx.fillStyle = C_BANNER_TEXT
  ctx.font = '600 ' + layout.bannerFontSize + 'px ' + FONT_FAMILY
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('点击保存我的名片', layout.w / 2, layout.bannerH / 2)

  // === 名片主体 ===
  // 头像
  _drawAvatar(ctx, avatarSrc,
    layout.avatarX, layout.avatarY,
    layout.avatarSize, layout.avatarRadius)

  // 姓名
  ctx.fillStyle = C_PRIMARY
  ctx.font = 'bold ' + layout.nameFontSize + 'px ' + FONT_NAME
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(card.name || '', layout.rightEdge, layout.nameY)

  // 职位
  ctx.fillStyle = C_SECONDARY
  ctx.font = layout.positionFontSize + 'px ' + FONT_FAMILY
  ctx.fillText(card.position || '', layout.rightEdge, layout.positionY)

  // 分割线
  ctx.fillStyle = layout.dividerColor
  ctx.fillRect(layout.padding, layout.dividerY,
    layout.w - layout.padding * 2, layout.dividerHeight)

  // 公司名
  ctx.fillStyle = C_PRIMARY
  ctx.font = '600 ' + layout.companyFontSize + 'px ' + FONT_FAMILY
  ctx.textAlign = 'left'
  ctx.fillText(card.company || '', layout.padding, layout.companyY)

  // 联系方式
  _drawContactInfo(ctx, card, layout)
}

// =========================================================================
// 绘制: 小程序图标
// =========================================================================

function _drawAppIcon(ctx, x, y, layout) {
  ctx.save()
  _drawRoundRect(ctx, x, y, layout.appIconSize, layout.appIconSize, layout.appIconRadius)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()

  ctx.drawImage(_appIconImage, x, y, layout.appIconSize, layout.appIconSize)
  ctx.restore()
}

// =========================================================================
// 绘制: 头像
// =========================================================================

function _drawAvatar(ctx, avatarSrc, x, y, size, radius) {
  if (!avatarSrc || !_loadedAvatar) {
    // 蓝紫渐变占位
    var gradient = ctx.createLinearGradient(x, y, x + size, y + size)
    gradient.addColorStop(0, '#3B82F6')
    gradient.addColorStop(1, '#8B5CF6')
    ctx.fillStyle = gradient
    _drawRoundRect(ctx, x, y, size, size, radius)
    ctx.fill()

    // "名"字
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold ' + Math.round(size * 0.4) + 'px ' + FONT_FAMILY
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('名', x + size / 2, y + size / 2)
    return
  }

  ctx.save()
  _drawRoundRect(ctx, x, y, size, size, radius)
  ctx.clip()
  ctx.drawImage(_loadedAvatar, x, y, size, size)
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

  ctx.fillStyle = C_BODY
  ctx.font = layout.contactFontSize + 'px ' + FONT_FAMILY
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'

  for (var i = 0; i < items.length; i++) {
    ctx.fillText(items[i], layout.rightEdge, layout.contactY + i * layout.contactGap)
  }
}

// =========================================================================
// 导出
// =========================================================================

module.exports = {
  generate: generate,
  getCurrentDimensions: getCurrentDimensions,
  refreshLayout: refreshLayout
}
