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

module.exports = {
  STORAGE_BASE: STORAGE_BASE,
  resolveCloudUrl: resolveCloudUrl
}
