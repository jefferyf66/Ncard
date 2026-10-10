/**
 * teamShareCard.js — 团队分享卡 Canvas 生成器
 * ============================================
 * 为 team/detail 三种分享（directory / invite / card）生成 5:4 海报。
 * 复用 shareCard.js 的成熟模式：
 *   - 全局 canvas 序列化锁（防多卡并行绘制竞争）
 *   - 内存缓存（含 TEAM_SHARE_STYLE 版本，外观升级自动失效）
 *   - cloud:// → HTTPS（与 storage.resolveCloudUrl 一致）
 * 仅返回本地 tempFilePath，上传云存储 + 缓存击穿由 detail.js 负责（与 index.js 一致）。
 *
 * 三种卡统一品牌蓝，仅靠布局/文案区分：
 *   directory — 白底 + 左侧蓝装饰条 + 成员头像堆叠「共 N 位成员」
 *   invite    — 顶部整条蓝横幅「邀请你加入团队」+ 底部白底蓝字 CTA
 *   card      — 白底 + 左侧蓝装饰条 + 预填徽标（公司/部门/职位）
 */

var storage = require('../config/storage')
var TS = require('../config/teamStyle')
var TEAM = TS.TEAM_CARD
var STYLE = TS.TEAM_SHARE_STYLE

// =========================================================================
// 缓存 + 锁
// =========================================================================
var _imageCache = {}
var CACHE_TTL = 10 * 60 * 1000
var IMAGE_CACHE_MAX = 10
var LOGO_LOAD_TIMEOUT = 15000
var _logoCache = {}
var _canvasLock = Promise.resolve()

function _putCache(key, entry) {
  var keys = Object.keys(_imageCache)
  if (keys.length >= IMAGE_CACHE_MAX) delete _imageCache[keys[0]]
  _imageCache[key] = entry
}

function _resolveToHttps(src) {
  if (!src) return Promise.resolve('')
  if (src.indexOf('https://') === 0) return Promise.resolve(src)
  if (src.indexOf('cloud://') === 0) return Promise.resolve(storage.resolveCloudUrl(src))
  return Promise.resolve(src)
}

function _loadLogo(logoSrc, canvas) {
  return new Promise(function (resolve) {
    if (!logoSrc) { resolve(null); return }
    if (_logoCache[logoSrc]) { resolve(_logoCache[logoSrc]); return }
    _resolveToHttps(logoSrc).then(function (url) {
      if (!url) { resolve(null); return }
      var img = canvas.createImage()
      var settled = false
      var timer = setTimeout(function () {
        if (settled) return
        settled = true
        resolve(null)
      }, LOGO_LOAD_TIMEOUT)
      img.onload = function () {
        if (settled) return
        settled = true
        clearTimeout(timer)
        _logoCache[logoSrc] = img
        resolve(img)
      }
      img.onerror = function () {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(null)
      }
      img.src = url
    }).catch(function () { resolve(null) })
  })
}

// =========================================================================
// 绘制工具
// =========================================================================
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function _truncate(ctx, text, maxWidth) {
  if (!text) return ''
  if (ctx.measureText(text).width <= maxWidth) return text
  var t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}

function _drawLogo(ctx, payload, logoImg, x, y, size) {
  ctx.save()
  _roundRect(ctx, x, y, size, size, TEAM.logoRadius)
  ctx.clip()
  if (logoImg) {
    ctx.drawImage(logoImg, x, y, size, size)
  } else {
    ctx.fillStyle = TEAM.brandBlue
    ctx.fillRect(x, y, size, size)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '500 ' + TEAM.logoTextSize + 'px ' + TEAM.nameFont
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    var ch = (payload.name || '团').slice(0, 1)
    ctx.fillText(ch, x + size / 2, y + size / 2)
  }
  ctx.restore()
}

// =========================================================================
// 主绘制：按 kind 排布三种版式
// =========================================================================
function _drawFrame(ctx, payload, logoImg, kind) {
  var W = TEAM.canvasWidth
  var H = TEAM.canvasHeight
  var padX = 40

  // 左侧品牌蓝装饰条（目录/填写卡）
  if (kind !== 'invite') {
    ctx.fillStyle = TEAM.brandBlueDeep
    ctx.fillRect(0, 0, TEAM.barWidth, H)
  }

  // 邀请成员：顶部整条蓝横幅
  var topOffset = 0
  if (kind === 'invite') {
    ctx.fillStyle = TEAM.brandBlueDeep
    ctx.fillRect(0, 0, W, TEAM.bandHeight)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '500 ' + TEAM.bandTextSize + 'px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('邀请你加入团队', W / 2, TEAM.bandHeight / 2)
    topOffset = TEAM.bandHeight
  }

  // logo + 团队名 + 元信息
  var logoY = topOffset + 44
  var logoSize = TEAM.logoSize
  _drawLogo(ctx, payload, logoImg, padX, logoY, logoSize)

  var textX = padX + logoSize + 24
  var textMaxW = W - textX - padX

  ctx.fillStyle = TEAM.nameColor
  ctx.font = '500 ' + TEAM.nameFontSize + 'px ' + TEAM.nameFont
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  var name = _truncate(ctx, payload.name || '团队', textMaxW)
  ctx.fillText(name, textX, logoY + 40)

  var mc = Math.max(payload.memberCount || 1, 1)
  var meta = '团队ID ' + (payload.shortId || '') + ' · ' + mc + ' 人'
  ctx.fillStyle = TEAM.metaColor
  ctx.font = TEAM.metaFontSize + 'px sans-serif'
  ctx.fillText(meta, textX, logoY + 78)

  // 分割线
  var divY = logoY + logoSize + 24
  ctx.strokeStyle = TEAM.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padX, divY)
  ctx.lineTo(W - padX, divY)
  ctx.stroke()

  if (kind === 'directory') {
    // 成员头像堆叠 + 文案
    var cy = divY + 70
    var shades = ['#E6F1FB', '#B5D4F4', '#85B7EB']
    for (var i = 0; i < 3; i++) {
      ctx.fillStyle = shades[i]
      ctx.beginPath()
      ctx.arc(padX + 24 + i * 22, cy, 24, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = TEAM.metaColor
    ctx.font = TEAM.metaFontSize + 'px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('共 ' + mc + ' 位成员', padX + 110, cy)
  } else if (kind === 'card') {
    // 预填信息徽标
    var keys = (payload.prefillKeys && payload.prefillKeys.length) ? payload.prefillKeys : ['公司', '部门', '职位']
    ctx.fillStyle = TEAM.metaColor
    ctx.font = TEAM.metaFontSize + 'px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('已为你预填以下信息', padX, divY + 40)
    var cx = padX
    var chipY = divY + 56
    var chipH = 44
    var chipFont = '24px sans-serif'
    for (var j = 0; j < keys.length; j++) {
      var label = keys[j]
      var txtW = (function (c) { return c.measureText(label).width })(ctx)
      var chipW = txtW + 28
      ctx.fillStyle = TEAM.chipBg
      _roundRect(ctx, cx, chipY, chipW, chipH, 6)
      ctx.fill()
      ctx.fillStyle = TEAM.chipText
      ctx.font = '500 ' + chipFont
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, cx + chipW / 2, chipY + chipH / 2)
      cx += chipW + 12
    }
  }

  // 底栏 CTA
  var ctaY = H - TEAM.ctaHeight
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (kind === 'invite') {
    // 白底 + 顶部描边 + 蓝字
    ctx.fillStyle = TEAM.bg
    ctx.fillRect(0, ctaY, W, TEAM.ctaHeight)
    ctx.strokeStyle = TEAM.line
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, ctaY)
    ctx.lineTo(W, ctaY)
    ctx.stroke()
    ctx.fillStyle = TEAM.chipText
    ctx.font = '500 ' + TEAM.ctaTextSize + 'px sans-serif'
    ctx.fillText('点击加入团队', W / 2, ctaY + TEAM.ctaHeight / 2)
  } else {
    ctx.fillStyle = TEAM.brandBlueDeep
    ctx.fillRect(0, ctaY, W, TEAM.ctaHeight)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '500 ' + TEAM.ctaTextSize + 'px sans-serif'
    var ctaText = kind === 'directory' ? '点击查看团队名片目录' : '点击填写我的团队名片'
    ctx.fillText(ctaText, W / 2, ctaY + TEAM.ctaHeight / 2)
  }
}

// =========================================================================
// 导出: 生成 tempFilePath
// =========================================================================
function _getDpr() {
  try {
    return (wx.getWindowInfo ? wx.getWindowInfo() : {}).pixelRatio || 2
  } catch (e) {
    return 2
  }
}

function generate(canvasId, payload, kind, options) {
  options = options || {}
  var pageContext = options.pageContext || null
  var now = Date.now()
  var versionedKey = 'team_' + (payload.shortId || 'x') + '_' + kind + '_v' + STYLE

  if (_imageCache[versionedKey] && _imageCache[versionedKey].expireAt > now) {
    return Promise.resolve({ tempFilePath: _imageCache[versionedKey].tempFilePath })
  }

  var W = TEAM.canvasWidth
  var H = TEAM.canvasHeight
  var selector = canvasId.indexOf('#') === 0 ? canvasId : '#' + canvasId

  var resultPromise = _canvasLock.then(function () {
    return new Promise(function (resolve, reject) {
      var query = pageContext ? wx.createSelectorQuery().in(pageContext) : wx.createSelectorQuery()
      query.select(selector).fields({ node: true, size: true }).exec(function (res) {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('Canvas 节点未找到'))
          return
        }
        var canvas = res[0].node
        var ctx = canvas.getContext('2d')
        var dpr = _getDpr()
        canvas.width = W * dpr
        canvas.height = H * dpr
        ctx.scale(dpr, dpr)

        // 白底（JPEG 无 alpha，显式铺白防平台随机填色）
        ctx.fillStyle = TEAM.bg
        ctx.fillRect(0, 0, W, H)

        var drawAll = function (logoImg) {
          _drawFrame(ctx, payload, logoImg, kind)
          wx.canvasToTempFilePath({
            canvas: canvas,
            x: 0, y: 0, width: W, height: H,
            destWidth: W, destHeight: H,
            fileType: 'jpg',
            quality: 0.7,
            success: function (tres) {
              _putCache(versionedKey, { tempFilePath: tres.tempFilePath, expireAt: now + CACHE_TTL })
              resolve({ tempFilePath: tres.tempFilePath })
            },
            fail: function (err) { reject(err) }
          })
        }

        _loadLogo(payload.logoUrl, canvas).then(drawAll).catch(function () { drawAll(null) })
      })
    })
  })
  _canvasLock = resultPromise.then(function () {}, function () {})
  return resultPromise
}

module.exports = {
  generate: generate
}
