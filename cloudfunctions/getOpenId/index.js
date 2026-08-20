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

    // 幂等登录：先查已存在记录，避免重复建号
    const exist = await userColl.where({ _openid: OPENID }).get()
    if (exist.data.length > 0) {
      const userDoc = exist.data[0]
      const now = Date.now()
      await userColl.doc(userDoc._id).update({ data: { lastLoginAt: now } })
      userDoc.lastLoginAt = now
      return buildResult(OPENID, APPID, UNIONID, userDoc)
    }

    // 首次注册：显式写 _openid（admin 上下文 add 不自动注入）
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

    let userDoc
    try {
      const addRes = await userColl.add({ data: payload })
      userDoc = { _id: addRes._id, ...payload }
    } catch (addErr) {
      // P1-①: 并发首登竞态（唯一索引冲突等）时回查已有记录返回，杜绝重复建号 / 返回 null
      console.warn('[getOpenId] ensureUser add 冲突，回查已有记录:', addErr)
      const retry = await userColl.where({ _openid: OPENID }).get()
      if (retry.data.length > 0) {
        userDoc = retry.data[0]
      } else {
        throw addErr // 实在拿不到则交给外层 catch 返回 success:false
      }
    }

    return buildResult(OPENID, APPID, UNIONID, userDoc)
  } catch (e) {
    // 与默认 action 的 {success:true} 契约统一：失败返回 success:false（P2-4）
    console.error('[getOpenId] ensureUser 失败:', e)
    return { success: false, error: (e && e.message) || String(e) }
  }
}

// 统一 ensureUser 返回体（openid/appid/unionid 与默认 action 一致）
function buildResult(openid, appid, unionid, userDoc) {
  return {
    success: true,
    data: {
      openid,
      appid,
      unionid: unionid || '',
      user: userDoc
    }
  }
}
