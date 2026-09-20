// 云函数：初始化 visits 集合并提供访客记录能力
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 字段级可见性默认配置（与前端 miniprogram/config/cardVisibility.js 保持一致）
const DEFAULT_FIELD_VISIBILITY = require('./visibility').DEFAULT_FIELD_VISIBILITY

// 按 fieldVisibility 服务端过滤：只返回访客可见字段
// public 恒返；authorized 仅 isOwner||isAuthorized 返；private 永不返（D5 安全模型）
function filterCardByVisibility(card, fv, isOwner, isAuthorized) {
  const out = { _id: card._id }
  if (isOwner && card._openid) out._openid = card._openid
  const fields = Object.keys(card)
  for (const k of fields) {
    if (k === '_id' || k === '_openid' || k === 'fieldVisibility') continue
    const vis = (fv && fv[k]) || DEFAULT_FIELD_VISIBILITY[k] || 'public'
    if (vis === 'public') {
      out[k] = card[k]
    } else if (vis === 'authorized' && (isOwner || isAuthorized)) {
      out[k] = card[k]
    }
    // private 或未授权的 authorized → 跳过，不下发
  }
  return out
}

// 方案 A：访客身份读时解析（resolve-on-read）
// 读取时实时解析访客最新身份，覆盖 visits 文档里的陈旧快照，根治访客升级身份后
// 名片主人看到的用户名/头像不刷新的 staleness bug。不依赖写入时快照。
// 优先级：L3（有自己名片的访客）覆盖 L2（有授权昵称但无名片），不降级。
async function resolveVisitorIdentities(openids) {
  const ids = Array.from(new Set((openids || []).filter(Boolean)))
  const map = {}
  if (ids.length === 0) return map

  // L3：有自己名片的访客（cards._openid 命中）
  try {
    const cardRes = await db.collection('cards')
      .where({ _openid: db.command.in(ids) })
      .limit(100)
      .get()
    for (const c of (cardRes.data || [])) {
      if (c._openid) {
        map[c._openid] = {
          visitorName: c.name || '',
          visitorAvatar: c.avatar || '',
          visitorPosition: c.position || '',
          visitorCompany: c.company || '',
          visitorLevel: 3
        }
      }
    }
  } catch (e) {
    // 查询失败不中断主流程
    console.warn('[initVisits] resolveVisitorIdentities L3 查询失败:', e.message)
  }

  // L2：有授权昵称但无名片（visitor_profiles.openid 命中，且非 L3 才写入，避免降级）
  try {
    const profileRes = await db.collection('visitor_profiles')
      .where({ openid: db.command.in(ids) })
      .limit(100)
      .get()
    for (const p of (profileRes.data || [])) {
      if (p.openid && !map[p.openid]) {
        map[p.openid] = {
          visitorName: p.nickname || '',
          visitorAvatar: p.avatarUrl || '',
          visitorPosition: '',
          visitorCompany: '',
          visitorLevel: 2
        }
      }
    }
  } catch (e) {
    // 查询失败不中断主流程
    console.warn('[initVisits] resolveVisitorIdentities L2 查询失败:', e.message)
  }

  return map
}

exports.main = async (event, context) => {
  // 服务端身份（唯一可信来源，绝不读 event 传入的 openid）
  const { OPENID } = cloud.getWXContext()
  const { action, data } = event

  switch (action) {

    // 确保 visits 集合存在（尝试插入一条空记录再删除）
    case 'ensureCollection': {
      try {
        const placeholder = await db.collection('visits').add({
          data: { _placeholder: true }
        })
        await db.collection('visits').doc(placeholder._id).remove()
        return { ok: true, message: 'visits 集合已就绪' }
      } catch (e) {
        // 集合已存在也会报错，直接返回成功
        if (e.errCode === -502005) {
          // 集合确实不存在，但 add 也失败了 → 需要在 MP 后台手动创建
          return { ok: true, message: '请在云开发控制台手动创建 visits 集合' }
        }
        return { ok: true, message: 'visits 集合已存在，无需创建' }
      }
    }

    // 记录一次访问（含匿名访客身份识别）
    case 'recordVisit': {
      const { cardId, source, note, shareId } = data || {}
      if (!cardId) {
        return { ok: false, message: '参数不完整' }
      }
      if (!OPENID) {
        return { ok: false, message: '未授权' }
      }

      // 访客身份以服务端 OPENID 为准
      const visitorOpenId = OPENID
      // 名片归属以数据库为准，防止伪造 cardOwnerId
      let cardOwnerId = ''
      let cardName = ''
      try {
        const cardRes = await db.collection('cards').doc(cardId).get()
        cardOwnerId = (cardRes.data && cardRes.data._openid) || ''
        cardName = (cardRes.data && cardRes.data.name) || ''
      } catch (e) { /* 名片不存在 */ }
      if (!cardOwnerId) {
        return { ok: false, message: '名片不存在' }
      }

      // 不记录自己访问自己的卡片
      if (visitorOpenId === cardOwnerId) {
        return { ok: true, skipped: true, reason: 'self_visit' }
      }

      const now = new Date()

      // === 三级访客身份识别（enrichment）===
      let visitorName = ''
      let visitorAvatar = ''
      let visitorPosition = ''
      let visitorCompany = ''
      let visitorPhone = ''
      let visitorLevel = 1  // 1=匿名 / 2=已授权微信昵称 / 3=卡片用户

      try {
        // L3 检查：visitorOpenId 是否有自己的名片
        const cardRes = await db.collection('cards')
          .where({ _openid: visitorOpenId })
          .limit(1)
          .get()

        if (cardRes.data && cardRes.data.length > 0) {
          const card = cardRes.data[0]
          visitorName = card.name || ''
          visitorAvatar = card.avatar || ''
          visitorPosition = card.position || ''
          visitorCompany = card.company || ''
          visitorPhone = card.phone || ''
          visitorLevel = 3
        }
      } catch (e) {
        // cards 集合查询失败不影响主流程
        console.warn('[initVisits] L3 卡片用户查询失败:', e.message)
      }

      // L2 检查：如果非 L3，检查 visitor_profiles 是否有授权记录
      if (visitorLevel < 3) {
        try {
          const profileRes = await db.collection('visitor_profiles')
            .where({ openid: visitorOpenId })
            .limit(1)
            .get()

          if (profileRes.data && profileRes.data.length > 0) {
            const profile = profileRes.data[0]
            visitorName = profile.nickname || ''
            visitorAvatar = profile.avatarUrl || ''
            visitorLevel = 2
          }
        } catch (e) {
          // visitor_profiles 集合可能不存在
          console.warn('[initVisits] L2 授权用户查询失败:', e.message)
        }
      }
      // L1: visitorLevel 保持 1，visitorName 为空 → 前端显示 "访客 #XXXX"

      // 查找是否最近有过访问记录（30分钟内算同一次）
      const recent = await db.collection('visits')
        .where({
          cardId,
          visitorOpenId
        })
        .orderBy('visitTime', 'desc')
        .limit(1)
        .get()

      if (recent.data && recent.data.length > 0) {
        const lastVisit = new Date(recent.data[0].visitTime)
        const diffMin = (now - lastVisit) / 1000 / 60

        if (diffMin < 30) {
          // 更新最近一条记录的时间 + enrichment（身份可能升级了）
          await db.collection('visits').doc(recent.data[0]._id).update({
            data: {
              visitTime: now,
              visitCount: db.command.inc(1),
              visitorName: visitorName || recent.data[0].visitorName || '',
              visitorAvatar: visitorAvatar || recent.data[0].visitorAvatar || '',
              visitorPosition: visitorPosition || recent.data[0].visitorPosition || '',
              visitorCompany: visitorCompany || recent.data[0].visitorCompany || '',
              visitorPhone: visitorPhone || recent.data[0].visitorPhone || '',
              visitorLevel: Math.max(visitorLevel, recent.data[0].visitorLevel || 1),
              cardName: cardName || recent.data[0].cardName || '',
              // 留言：仅当本次携带非空留言时覆盖；否则保留已有留言（避免空值覆盖，方案 A）
              note: (note && typeof note === 'string') ? note : (recent.data[0].note || '')
            }
          })
          return { ok: true, updated: true, visitorLevel: visitorLevel }
        }
      }

      // F10 修复：插入前按同 cardId+visitorOpenId+30 分钟时间窗再查一次，
      // 收窄 check-then-insert 竞态窗口（并发双写时合并到已有记录，不重复插入）
      const dupCheck = await db.collection('visits')
        .where({
          cardId,
          visitorOpenId,
          visitTime: db.command.gte(new Date(now.getTime() - 30 * 60 * 1000))
        })
        .limit(1)
        .get()
      if (dupCheck.data && dupCheck.data.length > 0) {
        await db.collection('visits').doc(dupCheck.data[0]._id).update({
          data: {
            visitTime: now,
            visitCount: db.command.inc(1),
            visitorName: visitorName || dupCheck.data[0].visitorName || '',
            visitorAvatar: visitorAvatar || dupCheck.data[0].visitorAvatar || '',
            visitorLevel: Math.max(visitorLevel, dupCheck.data[0].visitorLevel || 1),
            // 留言：仅当本次携带非空留言时覆盖；否则保留已有留言（避免空值覆盖，方案 A）
            note: (note && typeof note === 'string') ? note : (dupCheck.data[0].note || '')
          }
        })
        return { ok: true, updated: true, visitorLevel: visitorLevel }
      }

      // 新记录（含 enrichment 数据）
      await db.collection('visits').add({
        data: {
          cardId,
          cardOwnerId: cardOwnerId || '',
          visitorOpenId,
          visitorName,
          visitorAvatar,
          visitorPosition,
          visitorCompany,
          visitorPhone,
          visitorLevel,
          visitTime: now,
          visitCount: 1,
          actions: [],
          cardName,
          source: source || 'direct',
          // 一次性分享留言：仅写入 visits（分享记录），绝不写入 cards 集合
          note: note || '',
          shareId: shareId || ''
        }
      })

      return { ok: true, created: true, visitorLevel: visitorLevel }
    }

    // 获取我的访客统计（可选 cardId：按单张名片过滤；owner 以服务端 OPENID 为准）
    case 'getMyVisitorStats': {
      const { cardId } = data || {}
      if (!OPENID) {
        return { ok: false, message: '未授权' }
      }

      // 构建过滤条件：cardId 可选（缺省为全局聚合）；cardOwnerId 强制服务端身份
      const where = { cardOwnerId: OPENID }
      if (cardId) where.cardId = cardId

      // 访客总数
      const totalResult = await db.collection('visits')
        .where(where)
        .count()

      // 多次来访数
      const repeatResult = await db.collection('visits')
        .where({
          ...where,
          visitCount: db.command.gt(1)
        })
        .count()

      return {
        ok: true,
        visitors: totalResult.total || 0,
        viewed: repeatResult.total || 0
      }
    }

    // 获取最近访客列表（可选 cardId：按单张名片过滤；owner 以服务端 OPENID 为准）
    case 'getRecentVisitors': {
      const { limit = 10, cardId } = data || {}
      if (!OPENID) {
        return { ok: false, message: '未授权' }
      }

      // 构建过滤条件：cardId 可选（缺省为全局聚合）；cardOwnerId 强制服务端身份
      const where = { cardOwnerId: OPENID }
      if (cardId) where.cardId = cardId

      const result = await db.collection('visits')
        .where(where)
        .orderBy('visitTime', 'desc')
        .limit(limit)
        .get()

      const list = result.data || []
      // 方案 A：读时解析访客最新身份，覆盖陈旧快照
      const openids = list.map(v => v.visitorOpenId).filter(Boolean)
      if (openids.length) {
        const idMap = await resolveVisitorIdentities(openids)
        for (const v of list) {
          const r = idMap[v.visitorOpenId]
          if (r) {
            v.visitorName = r.visitorName || v.visitorName || ''
            v.visitorAvatar = r.visitorAvatar || v.visitorAvatar || ''
            v.visitorPosition = r.visitorPosition || v.visitorPosition || ''
            v.visitorCompany = r.visitorCompany || v.visitorCompany || ''
            v.visitorLevel = r.visitorLevel > (v.visitorLevel || 1) ? r.visitorLevel : v.visitorLevel
          }
        }
      }
      // 安全：无条件移除访客私密电话，防止向名片主人泄露（SEC-03 纵深防御，不依赖上面分支）
      for (const v of list) delete v.visitorPhone
      return {
        ok: true,
        list
      }
    }

    // 获取我的访客仪表盘（统计 + 最近访客，合并为一次调用；可选 cardId）
    case 'getMyVisitorDashboard': {
      const { cardId } = data || {}
      if (!OPENID) {
        return { ok: false, message: '未授权' }
      }

      // 构建过滤条件：cardId 可选（缺省为全局聚合）；cardOwnerId 强制服务端身份
      const where = { cardOwnerId: OPENID }
      if (cardId) where.cardId = cardId

      // 三路并行：总数、回访数、最近访客
      const [totalResult, repeatResult, recentResult] = await Promise.all([
        db.collection('visits').where(where).count(),
        db.collection('visits')
          .where({ ...where, visitCount: db.command.gt(1) })
          .count(),
        db.collection('visits')
          .where(where)
          .orderBy('visitTime', 'desc')
          .limit(20)
          .get()
      ])

      const recentList = recentResult.data || []
      // 方案 A：读时解析访客最新身份，覆盖陈旧快照
      const recentOpenids = recentList.map(v => v.visitorOpenId).filter(Boolean)
      if (recentOpenids.length) {
        const idMap = await resolveVisitorIdentities(recentOpenids)
        for (const v of recentList) {
          const r = idMap[v.visitorOpenId]
          if (r) {
            v.visitorName = r.visitorName || v.visitorName || ''
            v.visitorAvatar = r.visitorAvatar || v.visitorAvatar || ''
            v.visitorPosition = r.visitorPosition || v.visitorPosition || ''
            v.visitorCompany = r.visitorCompany || v.visitorCompany || ''
            v.visitorLevel = r.visitorLevel > (v.visitorLevel || 1) ? r.visitorLevel : v.visitorLevel
          }
        }
      }
      // 安全：无条件移除访客私密电话，防止向名片主人泄露（SEC-03 纵深防御，不依赖上面分支）
      for (const v of recentList) delete v.visitorPhone
      return {
        ok: true,
        visitors: totalResult.total || 0,
        viewed: repeatResult.total || 0,
        recentVisitors: recentList
      }
    }

    // D5 服务端卡片视图：访客读卡改走云函数，按 fieldVisibility 只下发可见字段
    case 'getCardView': {
      const { cardId } = data || {}
      if (!cardId || !OPENID) return { ok: false, message: '参数不完整' }

      let cardDoc
      try {
        cardDoc = await db.collection('cards').doc(cardId).get()
      } catch (e) {
        return { ok: false, message: '名片不存在' }
      }
      const card = cardDoc.data
      const isOwner = card._openid === OPENID
      const fv = card.fieldVisibility || null

      let isAuthorized = false
      let lockedFields = []
      if (!isOwner) {
        // 该访客是否存在已授权访问记录
        const v = await db.collection('visits')
          .where({ cardId, visitorOpenId: OPENID, authorized: true })
          .limit(1)
          .get()
        isAuthorized = !!(v.data && v.data.length > 0)
        // 计算被锁字段（authorized 且当前不可见）
        const visMap = fv || DEFAULT_FIELD_VISIBILITY
        for (const [k, vis] of Object.entries(visMap)) {
          if (vis === 'authorized') lockedFields.push(k)
        }
      }

      const visible = filterCardByVisibility(card, fv, isOwner, isAuthorized)
      return {
        ok: true,
        card: visible,
        isOwner,
        isAuthorized,
        fieldVisibility: fv || DEFAULT_FIELD_VISIBILITY,
        lockedFields
      }
    }

    // 名片夹批量读卡：cards 集合权限收紧为「仅创建者可读写」后，前端不可直读他人卡
    // 经云函数 admin 读取，按 fieldVisibility 只下发公开字段（isOwner=false, isAuthorized=false）
    case 'getCardsBatch': {
      const { cardIds = [] } = data || {}
      if (!Array.isArray(cardIds) || cardIds.length === 0) {
        return { ok: true, cards: [] }
      }
      // 封顶，避免超大请求
      const ids = cardIds.slice(0, 100)
      const cardRes = await db.collection('cards')
        .where({ _id: db.command.in(ids) })
        .limit(100)
        .get()
      const cards = (cardRes.data || []).map(card => {
        const fv = card.fieldVisibility || null
        return filterCardByVisibility(card, fv, false, false)
      })
      return { ok: true, cards }
    }

    // 访客授权：标记 visit.authorized=true + 按 L2 enrich + 回传授权后可见字段（D1/D2）
    case 'authorizeVisit': {
      const { cardId, nickname, avatarUrl } = data || {}
      if (!cardId || !OPENID) return { ok: false, message: '参数不完整' }
      // F14 修复：与 accountManager.updateMyProfile 同口径 —— nickname trim+限长 30、avatarUrl 限长 500
      const nick = (typeof nickname === 'string') ? nickname.trim().slice(0, 30) : ''
      const avatar = (typeof avatarUrl === 'string') ? avatarUrl.slice(0, 500) : ''
      const visitorOpenId = OPENID

      // 名片归属以数据库为准
      let cardOwnerId = ''
      let cardName = ''
      let cardDoc
      try {
        cardDoc = await db.collection('cards').doc(cardId).get()
        cardOwnerId = (cardDoc.data && cardDoc.data._openid) || ''
        cardName = (cardDoc.data && cardDoc.data.name) || ''
      } catch (e) { /* 名片不存在 */ }
      if (!cardOwnerId) return { ok: false, message: '名片不存在' }

      // 主人自己的名片无需授权（前端也不会触发），直接返回全字段
      if (visitorOpenId === cardOwnerId) {
        const visible = filterCardByVisibility(cardDoc.data, cardDoc.data.fieldVisibility, true, false)
        return { ok: true, authorized: true, isOwner: true, card: visible, lockedFields: [] }
      }

      // 1) 写/更新 visitor_profiles（L2 身份源）
      const profileRes = await db.collection('visitor_profiles')
        .where({ openid: visitorOpenId })
        .limit(1)
        .get()
      if (profileRes.data && profileRes.data.length > 0) {
        await db.collection('visitor_profiles').doc(profileRes.data[0]._id).update({
          data: {
            nickname: nick,
            avatarUrl: avatar,
            authorizedAt: new Date()
          }
        })
      } else {
        await db.collection('visitor_profiles').add({
          data: {
            openid: visitorOpenId,
            nickname: nick,
            avatarUrl: avatar,
            authorizedAt: new Date()
          }
        })
      }

      // 2) 找/建本次 visit 并标 authorized=true（复用 30 分钟同一次逻辑）
      const now = new Date()
      const recent = await db.collection('visits')
        .where({ cardId, visitorOpenId })
        .orderBy('visitTime', 'desc')
        .limit(1)
        .get()

      let visitId
      if (recent.data && recent.data.length > 0) {
        const lastVisit = new Date(recent.data[0].visitTime)
        const diffMin = (now - lastVisit) / 1000 / 60
        if (diffMin < 30) {
          visitId = recent.data[0]._id
          await db.collection('visits').doc(visitId).update({
            data: {
              authorized: true,
              visitorName: nick,
              visitorAvatar: avatar,
              visitorLevel: Math.max(recent.data[0].visitorLevel || 1, 2),
              visitTime: now
            }
          })
        }
      }
      if (!visitId) {
        const r = await db.collection('visits').add({
          data: {
            cardId,
            cardOwnerId,
            visitorOpenId,
            authorized: true,
            visitorName: nick,
            visitorAvatar: avatar,
            visitorLevel: 2,
            visitTime: now,
            visitCount: 1,
            actions: [],
            cardName,
            source: 'authorized'
          }
        })
        visitId = r._id
      }

      // 3) 返回授权后可见字段（同 getCardView 过滤，isAuthorized=true）
      const afterRes = await db.collection('cards').doc(cardId).get()
      const visible = filterCardByVisibility(afterRes.data, afterRes.data.fieldVisibility, false, true)
      return { ok: true, authorized: true, card: visible, lockedFields: [] }
    }

    default:
      return { ok: false, message: '未知操作: ' + action }
  }
}
