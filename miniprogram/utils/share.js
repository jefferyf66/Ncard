/**
 * share.js — 分享相关公共工具
 * ==========================================
 * 集中管理分享标题、imageUrl 降级等通用逻辑，避免在 index.js / preview.js 等页面中重复
 */

/** 分享标题最大字符数（按 Unicode 码点计算） */
const SHARE_TITLE_MAX = 20
/** 截断后保留的字符数（剩余部分用 ... 替代） */
const SHARE_TITLE_KEEP = 17

/**
 * 生成分享标题：姓名-公司名称
 * - 仅取姓名时返回姓名
 * - 字符数限制 20 个（按 Unicode 码点），超出使用 ... 省略
 * - 使用 Array.from 计算字符数，兼容 emoji 和代理对
 *
 * @param {object} card - 名片数据
 * @returns {string}
 */
function buildShareTitle(card) {
  if (!card) return '名片'
  var name = (card.name || '').trim()
  var company = (card.company || '').trim()
  var title = company ? (name + '-' + company) : (name || '名片')

  // 按 Unicode 码点（而非 UTF-16 码元）计算字符数
  var chars = Array.from(title)
  if (chars.length <= SHARE_TITLE_MAX) return title

  return chars.slice(0, SHARE_TITLE_KEEP).join('') + '...'
}

module.exports = {
  buildShareTitle: buildShareTitle
}
