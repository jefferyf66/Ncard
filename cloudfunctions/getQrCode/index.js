const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event, context) => {
  const { path } = event
  
  if (!path) {
    return { success: false, error: '缺少path参数' }
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
