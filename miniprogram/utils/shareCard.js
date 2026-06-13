/**
 * shareCard.js — Canvas 分享卡片生成器
 * ==========================================
 * 布局：顶部品牌色条 + 居中头像 + 短分割线 + 居中联系方式 + 底部「点击保存」提示
 * 画布比例 2:1 (800×400)，适用于微信聊天分享卡片封面
 * 
 * 【优化点】
 * 1. 将所有 Canvas 绘图逻辑封装为独立工具函数（drawRoundRect / drawCircleImage 等）
 * 2. 图片加载使用统一 Promise 包装，支持 cloud:// → HTTPS 自动转换
 * 3. 输出结果内存缓存（按 cardId），避免重复绘制
 * 4. DPR 适配逻辑复用 crop 页已验证方案
 * 5. 所有 async 操作使用 Promise 链，错误统一兜底
 */

const app = getApp()

/** 画布逻辑尺寸 (2:1 比例) */
const CARD_W = 800
const CARD_H = 400
/** 输出图片尺寸 (2x DPR 基准，Canvas 内会再乘实际 DPR) */
const OUTPUT_SCALE = 1

/** 品牌色常量 */
const C_BLUE = '#3B82F6'
const C_BODY = '#475569'
const C_MUTED = '#94A3B8'
const C_DIVIDER = '#E2E8F0'

/** 布局常量 (2:1 比例，居中布局) */
const L_AVATAR = 130        // 头像尺寸
const L_AVATAR_BORDER = 3   // 头像边框宽度
const L_AVATAR_Y = 55       // 头像顶部 Y (顶条下方)
const L_DIVIDER_Y = 205     // 短分割线 Y
const L_DIVIDER_W = 160     // 短分割线宽度
const L_CONTACT_Y = 225     // 联系方式起始 Y
const L_CONTACT_GAP = 36    // 联系方式行间距
const L_SAVE_Y = 378        // 「点击保存」Y
const L_ICON_SIZE = 22      // 联系方式图标尺寸

/** 字体常量 */
const FONT_FAMILY = 'PingFang SC, sans-serif'

/** shareImage 内存缓存: Map<cardKey, { tempFilePath, expireAt }> */
var _imageCache = {}
var CACHE_TTL = 10 * 60 * 1000  // 10分钟

// =========================================================================
// 公共导出: 生成分享卡片图片
// =========================================================================

/**
 * 生成分享卡片图片 (返回本地临时文件路径)
 * @param {string} canvasId - Canvas 节点 ID
 * @param {object} card - 名片数据 (来自 cards 集合)
 * @param {object} options - 可选配置
 * @param {string} options.cardKey - 缓存 key (默认 card._id)
 * @param {number} options.scale  - 输出倍数 (默认 1，生成 800x400)
 * @returns {Promise<{tempFilePath: string}>}
 */
function generate(canvasId, card, options) {
  options = options || {}
  var cardKey = options.cardKey || (card._id || 'shareCard')
  var now = Date.now()

  // 【优化】检查内存缓存，避免短时间内重复绘制
  var cached = _imageCache[cardKey]
  if (cached && cached.expireAt > now && cached.tempFilePath) {
    console.log('[shareCard] 命中缓存，跳过绘制:', cardKey)
    return Promise.resolve({ tempFilePath: cached.tempFilePath })
  }

  return new Promise(function (resolve, reject) {
    // 获取 Canvas 节点 (复用 crop 页已有的获取模式)
    var query = wx.createSelectorQuery()
    query.select(canvasId)
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

        // 设置画布像素尺寸 (逻辑尺寸 × DPR)
        canvas.width = CARD_W * dpr
        canvas.height = CARD_H * dpr
        ctx.scale(dpr, dpr)

        // 加载需要的图片
        _loadAssets(card, canvas).then(function (assets) {
          // 绘制 Scheme A 布局
          _drawLayout(ctx, card, assets)

          // 导出临时文件
          var destW = CARD_W * OUTPUT_SCALE
          var destH = CARD_H * OUTPUT_SCALE
          wx.canvasToTempFilePath({
            canvas: canvas,
            x: 0, y: 0,
            width: CARD_W, height: CARD_H,
            destWidth: destW, destHeight: destH,
            fileType: 'jpg',
            quality: 0.9,
            success: function (tempRes) {
              // 【优化】写入缓存
              _imageCache[cardKey] = {
                tempFilePath: tempRes.tempFilePath,
                expireAt: now + CACHE_TTL
              }
              resolve({ tempFilePath: tempRes.tempFilePath })
            },
            fail: function (err) {
              console.error('[shareCard] canvasToTempFilePath 失败:', err)
              reject(err)
            }
          })
        }).catch(reject)
      })
  })
}

// =========================================================================
// 内部: 图片资源加载
// =========================================================================

/**
 * 统一加载 Canvas 需要的图片资源
 * 【优化】将 cloud:// → HTTPS 和 canvas.createImage 封装为独立流程
 * 
 * @param {object} card - 名片数据
 * @param {object} canvasNode - Canvas 节点实例
 * @returns {Promise<{avatar: Image|null}>}
 */
function _loadAssets(card, canvasNode) {
  var avatarSrc = card.avatar || ''

  // 创建默认结果
  var result = { avatar: null }

  // 没有头像源 → 直接 resolve
  if (!avatarSrc) {
    console.log('[shareCard] 名片无头像字段，使用占位符')
    return Promise.resolve(result)
  }

  console.log('[shareCard] 开始加载头像:', avatarSrc.substring(0, 60))

  return _resolveToHttps(avatarSrc).then(function (httpsUrl) {
    if (!httpsUrl) {
      console.warn('[shareCard] 头像 URL 解析失败，使用占位符')
      return result
    }
    return _loadCanvasImage(canvasNode, httpsUrl).then(function (img) {
      if (img) {
        console.log('[shareCard] 头像加载完成，准备绘制到 Canvas')
      } else {
        console.warn('[shareCard] 头像图片对象为空，使用占位符')
      }
      result.avatar = img
      return result
    })
  })
}

/**
 * 【修复】将 cloud:// 或已有 HTTPS URL 统一转换为 HTTPS URL
 * 
 * 策略:
 *   1. https:// 开头 → 直接返回
 *   2. cloud:// 开头 → 优先调 resolveCloudUrls 云函数（管理员权限，跨用户可用）
 *   3. 云函数失败/未部署 → 降级为 wx.cloud.getTempFileURL（仅同用户可用）
 *   4. 以上均失败 → 返回空字符串，Canvas 绘制占位符
 * 
 * @param {string} src - cloud:// 或 https:// URL
 * @returns {Promise<string>} HTTPS URL (失败时返回空字符串)
 */
function _resolveToHttps(src) {
  if (!src) return Promise.resolve('')

  // 已经是 HTTPS → 直接返回
  if (src.indexOf('https://') === 0) {
    console.log('[shareCard] 头像已是 HTTPS，直接使用')
    return Promise.resolve(src)
  }

  // cloud:// 格式 → 通过云端代理转换
  if (src.indexOf('cloud://') === 0) {
    console.log('[shareCard] 头像为 cloud:// 格式，调用 resolveCloudUrls 云函数转换')

    return app.resolveCloudFileIDs([src]).then(function (urlMap) {
      var httpsUrl = urlMap[src]
      if (httpsUrl) {
        console.log('[shareCard] resolveCloudUrls 成功:', httpsUrl.substring(0, 80))
        return httpsUrl
      }
      // 云函数返回了但结果为空 → 尝试降级
      console.warn('[shareCard] resolveCloudUrls 返回空结果，尝试降级 getTempFileURL')
      return _resolveViaTempFileURL(src)
    }).catch(function (err) {
      // 云函数调用失败（大概率未部署）→ 降级
      console.warn('[shareCard] resolveCloudUrls 调用失败:', err && err.message)
      return _resolveViaTempFileURL(src)
    })
  }

  // 其他本地路径，不做转换
  return Promise.resolve(src)
}

/**
 * 【修复】降级方案：直接使用 wx.cloud.getTempFileURL
 * 仅在 resolveCloudUrls 云函数不可用时使用。
 * 局限性：只能解析当前用户有权限的 cloud:// URL（同 openid）
 * 
 * @param {string} fileID - cloud:// fileID
 * @returns {Promise<string>}
 */
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

/**
 * 【修复】Canvas createImage + onload Promise 封装
 * 
 * @param {object} canvasNode - Canvas 节点实例
 * @param {string} src - HTTPS URL
 * @returns {Promise<Image>}
 */
function _loadCanvasImage(canvasNode, src) {
  return new Promise(function (resolve) {
    var img = canvasNode.createImage()
    var resolved = false

    // 超时保护 (15秒)
    var timer = setTimeout(function () {
      if (resolved) return
      resolved = true
      console.warn('[shareCard] 图片加载超时:', src.substring(0, 80))
      resolve(null)
    }, 15000)

    img.onload = function () {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      console.log('[shareCard] 图片加载成功:', src.substring(0, 80))
      resolve(img)
    }

    img.onerror = function (err) {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      console.warn('[shareCard] 图片加载失败:', src.substring(0, 80), err)
      resolve(null)
    }

    img.src = src
  })
}

// =========================================================================
// 内部: DPR 获取
// =========================================================================

/**
 * 【优化】获取设备像素比，封装为函数避免各处重复调用 wx.getSystemInfoSync
 */
function _getDpr() {
  try {
    return wx.getSystemInfoSync().pixelRatio || 2
  } catch (e) {
    return 2
  }
}

// =========================================================================
// 内部: 布局绘制 (2:1 比例，居中对称)
// =========================================================================

/**
 * 绘制整套分享卡片布局 (2:1 比例，居中对称)
 * 布局顺序确保下层先画、上层后画
 */
function _drawLayout(ctx, card, assets) {
  // 1. 白色背景
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // 2. 蓝色顶条（品牌标识）
  ctx.fillStyle = C_BLUE
  ctx.fillRect(0, 0, CARD_W, 12)

  // 3. 头像（水平居中）
  var avatarCx = CARD_W / 2
  var avatarX = avatarCx - L_AVATAR / 2
  if (assets.avatar) {
    _drawCircleImage(ctx, assets.avatar, avatarX, L_AVATAR_Y, L_AVATAR)
  } else {
    _drawAvatarPlaceholder(ctx, avatarX, L_AVATAR_Y, L_AVATAR)
    console.log('[shareCard] 头像不可用，使用蓝色渐变占位符')
  }

  // 4. 短分割线（居中）
  _drawCenteredDivider(ctx, avatarCx, L_DIVIDER_Y, L_DIVIDER_W)

  // 5. 联系方式（居中排列）
  _drawContactInfo(ctx, card, avatarCx, L_CONTACT_Y)

  // 6. 底部「点击保存」提示
  _drawSaveHint(ctx)
}

// =========================================================================
// 内部: 绘制原子操作
// =========================================================================

/**
 * 圆形头像裁切绘制
 * 【优化】统一画布圆切逻辑，可复用
 * 
 * @param {CanvasRenderingContext2D} ctx
 * @param {Image} img - Canvas Image 对象
 * @param {number} x   - 左上角 X
 * @param {number} y   - 左上角 Y
 * @param {number} size - 尺寸
 */
function _drawCircleImage(ctx, img, x, y, size) {
  var r = size / 2
  ctx.save()
  ctx.beginPath()
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.drawImage(img, x, y, size, size)
  ctx.restore()

  // 头像边框
  ctx.save()
  ctx.beginPath()
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.18)'
  ctx.lineWidth = L_AVATAR_BORDER
  ctx.stroke()
  ctx.restore()
}

/**
 * 头像占位（无头像时显示蓝色渐变圆 + 首字）
 */
function _drawAvatarPlaceholder(ctx, x, y, size) {
  var r = size / 2
  var cx = x + r
  var cy = y + r

  // 蓝色渐变圆
  var grad = ctx.createLinearGradient(cx, 0, cx, size)
  grad.addColorStop(0, '#3B82F6')
  grad.addColorStop(1, '#60A5FA')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

  // 首字占位
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 48px ' + FONT_FAMILY
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('名', cx, cy)
}

/**
 * 单行文本裁剪（超出宽度打省略号）
 * 【优化】避免 Canvas text 溢出，统一处理
 */
function _drawClippedText(ctx, text, x, y, maxW, lineH) {
  var metrics = ctx.measureText(text)
  if (metrics.width <= maxW) {
    ctx.fillText(text, x, y)
    return
  }
  // 逐字减少直到宽度合适
  for (var i = text.length - 1; i > 0; i--) {
    var clipped = text.substring(0, i) + '...'
    if (ctx.measureText(clipped).width <= maxW) {
      ctx.fillText(clipped, x, y)
      return
    }
  }
  ctx.fillText('...', x, y)
}

/**
 * 短分割线（居中）
 */
function _drawCenteredDivider(ctx, cx, y, w) {
  ctx.strokeStyle = C_DIVIDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx - w / 2, y)
  ctx.lineTo(cx + w / 2, y)
  ctx.stroke()
}

/**
 * 联系方式（水平居中排列）
 */
function _drawContactInfo(ctx, card, cx, y) {
  var items = []
  if (card.phone) items.push({ icon: 'phone', text: card.phone })
  if (card.email) items.push({ icon: 'email', text: card.email })
  if (card.address) items.push({ icon: 'address', text: card.address })

  if (items.length === 0) return

  for (var i = 0; i < items.length; i++) {
    _drawContactRow(ctx, items[i], cx, y + i * L_CONTACT_GAP)
  }
}

/**
 * 单行联系信息（图标 + 文字，水平居中）
 */
function _drawContactRow(ctx, item, cx, y) {
  var iconSize = L_ICON_SIZE
  var gap = 12

  ctx.font = '20px ' + FONT_FAMILY
  var textW = ctx.measureText(item.text).width
  var totalW = iconSize + gap + textW
  var startX = cx - totalW / 2

  // 图标
  _drawContactIcon(ctx, item.icon, startX, y + 2, iconSize)

  // 文字
  ctx.fillStyle = C_BODY
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(item.text, startX + iconSize + gap, y)
}

/**
 * 简易联系方式图标 (SVG→Canvas 替代方案: 用基础形状画)
 */
function _drawContactIcon(ctx, type, x, y, size) {
  var cx = x + size / 2
  var cy = y + size / 2

  ctx.save()
  ctx.fillStyle = C_BLUE
  ctx.strokeStyle = C_BLUE
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (type === 'phone') {
    // 手机图标: 圆角矩形 + 听筒弧线
    _drawRoundRect(ctx, x, y, size, size, 4)
    ctx.fill()
  } else if (type === 'email') {
    // 邮件图标: 信封
    _drawRoundRect(ctx, x, y, size, size * 0.7, 3)
    ctx.stroke()
    // 信封口折线
    ctx.beginPath()
    ctx.moveTo(x + 2, y + 2)
    ctx.lineTo(cx, cy - 1)
    ctx.lineTo(x + size - 2, y + 2)
    ctx.stroke()
  } else if (type === 'address') {
    // 地址图标: 地图标记
    _drawRoundRect(ctx, x + 2, y + 4, size - 4, size - 8, 3)
    ctx.stroke()
    // 三角形箭头
    ctx.beginPath()
    ctx.moveTo(cx, y + size)
    ctx.lineTo(cx - 5, y + size - 8)
    ctx.lineTo(cx + 5, y + size - 8)
    ctx.closePath()
    ctx.fill()
  }

  ctx.restore()
}

/**
 * 【优化】通用圆角矩形绘制函数
 */
function _drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/**
 * 底部「点击保存」操作提示
 */
function _drawSaveHint(ctx) {
  ctx.fillStyle = C_MUTED
  ctx.font = '18px ' + FONT_FAMILY
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('点击保存', CARD_W / 2, L_SAVE_Y)
}

// =========================================================================
// 缓存管理
// =========================================================================

/**
 * 【优化】清除指定卡片的缓存
 */
function clearCache(cardKey) {
  if (cardKey) {
    delete _imageCache[cardKey]
  } else {
    _imageCache = {}
  }
}

// =========================================================================
// 模块导出
// =========================================================================
module.exports = {
  generate: generate,
  clearCache: clearCache,
  /** 导出尺寸常量供外部引用 */
  CARD_WIDTH: CARD_W,
  CARD_HEIGHT: CARD_H
}
