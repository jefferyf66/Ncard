const cloud = require('wx-server-sdk')
cloud.init()

// 小程序页面路径正则校验
const PATH_REGEX = /^\/pages\/[a-zA-Z0-9\/\-]+\/[a-zA-Z0-9\-]+$/

exports.main = async (event, context) => {
  const { path } = event
  
  if (!path) {
    return { success: false, error: '缺少path参数' }
  }

  // 校验 path 格式，防止非法输入
  if (typeof path !== 'string' || path.length > 128 || !PATH_REGEX.test(path)) {
    return { success: false, error: 'path格式不正确，仅允许小程序页面路径' }
  }

  try {
    const result = await cloud.openapi.wxacode.get({
      path: path,
      width: 280
    })
    
    const uploadResult = await cloud.uploadFile({
      cloudPath: `qrcodes/${Date.now()}.jpg`,
      fileContent: result.buffer
    })
    
    return { success: true, fileID: uploadResult.fileID }
  } catch (err) {
    console.error('[getQrCode] 生成二维码失败:', err)
    return { success: false, error: err.message || '生成失败' }
  }
}
