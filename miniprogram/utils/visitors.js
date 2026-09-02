/**
 * visitors.js — 访客数据处理公共工具
 * F22①：_mergeVisitorsByOpenId 此前在 preview / visitors 两页各自重复实现，
 * 收敛为单一真源，两页统一引用。
 */

/**
 * 客户端聚合：同一 visitorOpenId 的多次访问归并为一条
 * （匿名访客无 openid，按记录 id 兜底分键）
 */
function mergeVisitorsByOpenId(visitors) {
  const map = {}
  ;(visitors || []).forEach((v) => {
    const key = v.visitorOpenId || ('anon_' + v.id)
    if (!map[key]) {
      map[key] = { ...v }
    } else {
      map[key].visitCount = (map[key].visitCount || 1) + (v.visitCount || 1)
    }
  })
  return Object.values(map)
}

module.exports = {
  mergeVisitorsByOpenId: mergeVisitorsByOpenId
}
