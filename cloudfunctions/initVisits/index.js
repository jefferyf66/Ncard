// 云函数：初始化 visits 集合并提供访客记录能力
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
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
    },

    // 记录一次访问（含匿名访客身份识别）
    case 'recordVisit': {
      const { cardId, visitorOpenId, cardOwnerId } = data
      if (!cardId || !visitorOpenId) {
        return { ok: false, message: '参数不完整' }
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
            .where({ _openid: visitorOpenId })
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
              visitorLevel: Math.max(visitorLevel, recent.data[0].visitorLevel || 1)
            }
          })
          return { ok: true, updated: true, visitorLevel: visitorLevel }
        }
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
          source: data.source || 'direct'
        }
      })

      return { ok: true, created: true, visitorLevel: visitorLevel }
    },

    // 获取我的访客统计
    case 'getMyVisitorStats': {
      const { cardOwnerId } = data

      // 访客总数
      const totalResult = await db.collection('visits')
        .where({ cardOwnerId })
        .count()

      // 多次来访数
      const repeatResult = await db.collection('visits')
        .where({
          cardOwnerId,
          visitCount: db.command.gt(1)
        })
        .count()

      return {
        ok: true,
        visitors: totalResult.total || 0,
        viewed: repeatResult.total || 0
      }
    },

    // 获取最近访客列表
    case 'getRecentVisitors': {
      const { cardOwnerId, limit = 10 } = data
      const result = await db.collection('visits')
        .where({ cardOwnerId })
        .orderBy('visitTime', 'desc')
        .limit(limit)
        .get()

      return {
        ok: true,
        list: result.data || []
      }
    },

    default:
      return { ok: false, message: '未知操作: ' + action }
  }
}
