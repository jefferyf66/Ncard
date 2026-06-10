// 云函数：初始化 visits 集合并提供访客记录能力
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { action, data } = event
  const wxContext = cloud.getWXContext()

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

    // 记录一次访问
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
          // 更新最近一条记录的时间
          await db.collection('visits').doc(recent.data[0]._id).update({
            data: {
              visitTime: now,
              visitCount: db.command.inc(1)
            }
          })
          return { ok: true, updated: true }
        }
      }

      // 新记录
      await db.collection('visits').add({
        data: {
          cardId,
          cardOwnerId: cardOwnerId || '',
          visitorOpenId,
          visitTime: now,
          visitCount: 1,
          actions: [],
          source: data.source || 'direct'
        }
      })

      return { ok: true, created: true }
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
