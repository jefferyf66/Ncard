// 云函数：resolveCloudUrls
// 以管理员身份将 cloud:// fileID 转换为临时 HTTPS URL
// 绕开云存储「仅创建者可读写」的权限限制，安全代理给被分享者
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 内存缓存：fileID → { tempFileURL, expireAt }，减少重复 getTempFileURL 调用
var urlCache = {}

exports.main = async (event, context) => {
  const { fileIDs } = event

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
  var uncached = []

  // 检查缓存命中
  cloudIDs.forEach(function (id) {
    var entry = urlCache[id]
    if (entry && entry.expireAt > now + 60000) {
      // 缓存未过期（至少还剩 1 分钟），直接使用
      // 返回时仍然填充到结果中
    } else {
      uncached.push(id)
    }
  })

  try {
    if (uncached.length > 0) {
      var res = await cloud.getTempFileURL({ fileList: uncached })
      ;(res.fileList || []).forEach(function (item) {
        // 临时 URL 有效期为 2 小时，缓存到过期前 5 分钟
        urlCache[item.fileID] = {
          tempFileURL: item.tempFileURL || '',
          expireAt: now + 6900000 // 115 分钟
        }
      })
    }
  } catch (err) {
    console.error('[resolveCloudUrls] getTempFileURL 失败:', err)
  }

  // 构造返回映射
  var urls = {}
  cloudIDs.forEach(function (id) {
    var entry = urlCache[id]
    urls[id] = entry ? (entry.tempFileURL || '') : ''
  })

  return { urls: urls }
}
