// 云函数：resolveCloudUrls
// 以管理员身份将 cloud:// fileID 转换为 HTTPS URL 或 base64 data URL
// 绕开云存储「仅创建者可读写」的权限限制，安全代理给被分享者
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// MIME 类型映射（根据文件扩展名推断）
var MIME_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

// 内存缓存：fileID → { tempFileURL, expireAt }
// 临时 URL 有效期 2h，缓存 115 分钟（留 5 分钟缓冲）
var urlCache = {}
var CACHE_DURATION = 6900000 // 115 分钟
var MIN_REMAINING = 60000    // 至少剩余 1 分钟才复用

exports.main = async (event, context) => {
  var fileIDs = event.fileIDs

  if (!fileIDs || !fileIDs.length) {
    return { urls: {} }
  }

  var cloudIDs = fileIDs.filter(function (id) {
    return typeof id === 'string' && id.indexOf('cloud://') === 0
  })

  if (cloudIDs.length === 0) {
    return { urls: {} }
  }

  var now = Date.now()

  // 过滤出需要重新获取的 ID（缓存未命中或即将过期）
  var uncached = cloudIDs.filter(function (id) {
    var entry = urlCache[id]
    return !entry || entry.expireAt <= now + MIN_REMAINING
  })

  if (uncached.length > 0) {
    // ── Step 1：批量 getTempFileURL（对当前用户自己的文件有效）──
    try {
      var batchRes = await cloud.getTempFileURL({ fileList: uncached })
      var fileList = batchRes.fileList || []
      fileList.forEach(function (item) {
        if (item.status === 0 && item.tempFileURL) {
          // 成功：缓存临时 HTTPS URL
          urlCache[item.fileID] = {
            tempFileURL: item.tempFileURL,
            expireAt: now + CACHE_DURATION
          }
          console.log('[resolveCloudUrls] getTempFileURL 成功:', item.fileID.substring(0, 60))
        }
        // status !== 0 表示权限不足或文件不存在，静默进入 Step 2 降级
      })
    } catch (err) {
      console.error('[resolveCloudUrls] getTempFileURL 批量调用失败:', err.message)
      // 全部进入 Step 2 降级
    }

    // ── Step 2：downloadFile 降级（绕过存储 ACL，管理员权限）──
    for (var i = 0; i < uncached.length; i++) {
      var id = uncached[i]

      // 如果 Step 1 已成功缓存，跳过
      var entry = urlCache[id]
      if (entry && entry.tempFileURL) {
        continue
      }

      try {
        console.log('[resolveCloudUrls] getTempFileURL 被 ACL 拒绝，降级 downloadFile:', id.substring(0, 60))
        var downloadRes = await cloud.downloadFile({ fileID: id })

        if (downloadRes && downloadRes.fileContent) {
          var buffer = downloadRes.fileContent
          var base64 = buffer.toString('base64')

          // 从 fileID 提取文件扩展名推断 MIME 类型
          var ext = 'jpg'
          var dotIndex = id.lastIndexOf('.')
          if (dotIndex > -1) {
            ext = id.substring(dotIndex + 1).toLowerCase()
          }
          var mime = MIME_MAP[ext] || 'image/jpeg'

          var dataUrl = 'data:' + mime + ';base64,' + base64
          urlCache[id] = {
            tempFileURL: dataUrl,
            expireAt: now + CACHE_DURATION
          }
          console.log('[resolveCloudUrls] downloadFile 成功，data URL 长度:', dataUrl.length)
        } else {
          console.warn('[resolveCloudUrls] downloadFile 返回空内容:', id.substring(0, 60))
          urlCache[id] = { tempFileURL: '', expireAt: now }
        }
      } catch (downloadErr) {
        console.error('[resolveCloudUrls] downloadFile 也失败:', id.substring(0, 60), downloadErr.message)
        // 彻底失败，缓存空 URL 避免重复尝试
        urlCache[id] = { tempFileURL: '', expireAt: now + 300000 } // 5 分钟后重试
      }
    }
  }

  // ── 构造返回映射 ──
  var urls = {}
  cloudIDs.forEach(function (id) {
    var entry = urlCache[id]
    urls[id] = entry ? (entry.tempFileURL || '') : ''
  })

  console.log('[resolveCloudUrls] 返回映射:', Object.keys(urls).length, '个 fileID')
  return { urls: urls }
}
