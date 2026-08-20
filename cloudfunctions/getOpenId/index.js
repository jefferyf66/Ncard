const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  // 路由：ensureUser action → 自动建号/登录并写入 users 集合
  if (event && event.action === 'ensureUser') {
    return await ensureUser()
  }

  // 默认（原逻辑）：仅返回上下文身份信息，不写库
  const wxContext = cloud.getWXContext()
  return {
    success: true,
    data: {
      openid: wxContext.OPENID,
      appid: wxContext.APPID,
      unionid: wxContext.UNIONID
    }
  }
}

/**
 * 确保 users 集合中存在当前用户记录（自动注册/登录）
 * 注意：仅使用 cloud.getWXContext() 获取 OPENID，绝不信任 event.openid
 * 注意：admin 上下文 add() 不会自动注入 _openid，必须显式写入
 */
async function ensureUser() {
  try {
    const { OPENID, APPID, UNIONID } = cloud.getWXContext()
    const userColl = db.collection('users')

    // 幂等登录：先查已存在记录，避免重复建号
    const exist = await userColl.where({ _openid: OPENID }).get()
    if (exist.data.length > 0) {
      const userDoc = exist.data[0]
      // 已注销账号：不重新激活、不更新登录时间，客户端据此视为未登录
      if (userDoc.status !== 'deleted') {
        const now = Date.now()
        await userColl.doc(userDoc._id).update({
          data: {
            lastLoginAt: now,
            loginCount: db.command.inc(1),
            updatedAt: now
          }
        })
        userDoc.lastLoginAt = now
        userDoc.loginCount = (userDoc.loginCount || 0) + 1
        userDoc.updatedAt = now
      }
      // 种子 root 晋升（命中 config.rootOpenids 且当前非 root 时）
      userDoc.role = await resolveRole(OPENID, userDoc.role, userDoc._id)
      return buildResult(OPENID, APPID, UNIONID, userDoc)
    }

    // 首次注册：显式写 _openid（admin 上下文 add 不自动注入）
    const now = Date.now()
    const seededRole = await readSeedRole(OPENID) // 'root' 或 'user'
    const payload = {
      _openid: OPENID,            // D2坑：admin上下文add不自动注入_openid，必须显式写
      unionid: UNIONID || '',
      appid: APPID || '',
      // 资料层
      nickname: '',
      avatarUrl: '',
      realName: '',
      username: '',              // V2 可选 handle，暂空
      // 设置层
      themeColor: '',
      defaultCardId: '',
      // 账号层
      role: seededRole,
      status: 'active',
      loginCount: 1,
      registeredAt: now,
      lastLoginAt: now,
      updatedAt: now
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
    console.error('[getOpenId] ensureUser 失败:', e)
    return { success: false, error: (e && e.message) || String(e) }
  }
}

// 读取 config 集合的种子 root 列表，命中则返回 'root'
async function readSeedRole(OPENID) {
  try {
    const cfg = await db.collection('config').doc('root').get()
    const list = (cfg.data && cfg.data.rootOpenids) || []
    if (Array.isArray(list) && list.indexOf(OPENID) > -1) return 'root'
  } catch (e) {
    // config 不存在时静默降级为普通用户
  }
  return 'user'
}

// 已存在用户：若命中种子 root 且当前非 root，则晋升
async function resolveRole(OPENID, currentRole, userId) {
  if (currentRole === 'root') return 'root'
  const seed = await readSeedRole(OPENID)
  if (seed === 'root') {
    try {
      await db.collection('users').doc(userId).update({ data: { role: 'root' } })
    } catch (e) {}
    return 'root'
  }
  return currentRole || 'user'
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
