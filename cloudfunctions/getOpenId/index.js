const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  console.log('[getOpenId] 开始执行，event:', JSON.stringify(event))

  // 路由：ensureUser action → 自动建号/登录并写入 users 集合
  if (event && event.action === 'ensureUser') {
    return await ensureUser()
  }

  // 默认（原逻辑）：仅返回上下文身份信息，不写库
  const wxContext = cloud.getWXContext()
  console.log('[getOpenId] 获取到的 wxContext:', JSON.stringify({
    OPENID: wxContext.OPENID,
    APPID: wxContext.APPID,
    UNIONID: wxContext.UNIONID
  }))

  const result = {
    success: true,
    data: {
      openid: wxContext.OPENID,
      appid: wxContext.APPID,
      unionid: wxContext.UNIONID
    }
  }

  console.log('[getOpenId] 执行完成，返回:', JSON.stringify(result))
  return result
}

/**
 * 确保 users 集合中存在当前用户记录（自动注册/登录）
 * 注意：仅使用 cloud.getWXContext() 获取 OPENID，绝不信任 event.openid
 * 注意：admin 上下文 add() 不会自动注入 _openid，必须显式写入
 * @returns {Promise<Object>}
 */
async function ensureUser() {
  try {
    const { OPENID, APPID, UNIONID } = cloud.getWXContext()
    const userColl = db.collection('users')
    const exist = await userColl.where({ _openid: OPENID }).get()

    let userDoc
    if (exist.data.length === 0) {
      // 复用同一 payload：确保库记录与返回体字段、时间戳完全一致（P2-2）
      const now = Date.now()
      const payload = {
        _openid: OPENID,            // D2坑：admin上下文add不自动注入_openid，必须显式写
        unionid: UNIONID || '',
        nickname: '',
        avatarUrl: '',
        themeColor: '',
        defaultCardId: '',
        registeredAt: now,
        lastLoginAt: now
      }
      const addRes = await userColl.add({ data: payload })
      userDoc = { _id: addRes._id, ...payload }
    } else {
      userDoc = exist.data[0]
      const now = Date.now()
      await userColl.doc(userDoc._id).update({ data: { lastLoginAt: now } })
      // 返回体应反映本次更新后的 lastLoginAt（P2-3）
      userDoc.lastLoginAt = now
    }

    return {
      success: true,
      data: {
        openid: OPENID,
        appid: APPID,
        unionid: UNIONID || '',
        user: userDoc
      }
    }
  } catch (e) {
    // 与默认 action 的 {success:true} 契约统一：失败返回 success:false（P2-4）
    console.error('[getOpenId] ensureUser 失败:', e)
    return { success: false, error: (e && e.message) || String(e) }
  }
}
