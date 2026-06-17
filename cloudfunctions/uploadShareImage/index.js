// uploadShareImage — 云函数（管理员权限上传分享图，绕过 ACL）
// 输入: { imageData: "base64..." }
// 输出: { url: "https://..." }
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const imageData = event.imageData
  if (!imageData) return { ok: false, message: '缺少 imageData' }

  try {
    const buffer = Buffer.from(imageData, 'base64')
    const cloudPath = 'sharecards/export_' + Date.now() + '.png'
    const result = await cloud.uploadFile({ cloudPath, fileContent: buffer })
    const urlResult = await cloud.getTempFileURL({ fileList: [result.fileID] })
    const url = (urlResult.fileList && urlResult.fileList[0] && urlResult.fileList[0].tempFileURL) || ''
    return { ok: true, url }
  } catch (e) {
    console.error('[uploadShareImage]', e)
    return { ok: false, message: e.message }
  }
}
