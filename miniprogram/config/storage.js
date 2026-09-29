/**
 * storage.js — 云存储 HTTPS 基址（单一真源）
 * ==========================================
 * 前提：云存储权限 =「所有用户可读，仅创建者可读写」
 * 微信 2.8.1+ 虽声称支持 cloud:// 作为 imageUrl，但分享图接收方实测不可见，
 * 因此所有对外 URL 统一转换为 HTTPS CDN 地址。
 *
 * 历史：该基址曾硬编码于 app.js / shareCard.js / edit/index.js / index/index.js
 * 共 5 处，环境 ID 变更需改 4 个文件极易漏改。现收敛到此处单一导出。
 */

// 云存储 HTTPS 基址（环境 ID: 636c-cloudbase-d0gqgpu422d7e544f-1432712671）
var STORAGE_BASE = 'https://636c-cloudbase-d0gqgpu422d7e544f-1432712671.tcb.qcloud.la'

/**
 * 将 cloud:// 文件 ID 转换为永久 HTTPS URL
 * @param {string} cloudId - cloud://env-id/path 或已为 https 的地址
 * @returns {string} HTTPS URL；非 cloud:// 输入原样返回；空输入返回空串
 */
function resolveCloudUrl(cloudId) {
  if (!cloudId || typeof cloudId !== 'string') return ''
  if (cloudId.indexOf('cloud://') !== 0) return cloudId
  // cloud://env-id.storage-id/path/to/file → STORAGE_BASE/path/to/file
  var path = cloudId.replace('cloud://', '').split('/').slice(1).join('/')
  return STORAGE_BASE + '/' + path
}

// 分享图底色样式版本（单一真源）
// v1 = 透明底（JPEG 无 alpha 通道，透明区被平台随机填黑/白，历史缺陷，v1.5.14 及更早）
// v2 = 浅灰底 #F5F7FA（跨端统一，根治分享图黑白混杂，v1.5.15 起）
// v3 = 同 v2 视觉；仅因 v1.5.15 开发期热重载错配，曾把"旧透明底图"误标为 v2，
//      导致 _isShareImageFresh 判新鲜、自愈队列跳过、黑底永久锁死 → 抬版本强制所有卡重生成一次
// v4 = 顶部引导横幅底色由浅蓝(#D6EAF8)改为与分享图一致的浅灰(#F5F7FA)，字体放大加粗更突出；
//      属 banner 外观变更，须抬版本让所有历史分享图重绘
// v5 = banner 引导字体由 34 再放大至 38（rpx），更突出；外观微调须抬版本重绘
var SHARE_IMAGE_STYLE = 'v5'

module.exports = {
  STORAGE_BASE: STORAGE_BASE,
  resolveCloudUrl: resolveCloudUrl,
  SHARE_IMAGE_STYLE: SHARE_IMAGE_STYLE
}
