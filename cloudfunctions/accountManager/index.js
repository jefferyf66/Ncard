const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 用户自助账号管理（L1）
 * 所有 action 均以 cloud.getWXContext().OPENID 限定「本人」，绝不接受客户端传入的目标 openid。
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { success: false, error: 'no openid' }

  const handlers = {
    getMyProfile: getMyProfile,
    updateMyProfile: updateMyProfile,
    exportMyData: exportMyData,
    requestDeleteAccount: requestDeleteAccount,
    confirmDeleteAccount: confirmDeleteAccount
  }
  const action = event && event.action
  const fn = handlers[action]
  if (!fn) return { success: false, error: 'unknown action: ' + action }

  try {
    return await fn(OPENID, event)
  } catch (e) {
    console.error('[accountManager] ' + action + ' 失败:', e)
    return { success: false, error: (e && e.message) || String(e) }
  }
}

async function getMyProfile(OPENID) {
  const user = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  if (!user.data || user.data.length === 0) return { success: false, error: '用户不存在' }
  return { success: true, data: user.data[0] }
}

async function updateMyProfile(OPENID, event) {
  const patch = {}
  if (typeof event.nickname === 'string') {
    const v = event.nickname.trim().slice(0, 30)
    if (v.length > 0) patch.nickname = v
  }
  if (typeof event.avatarUrl === 'string') {
    patch.avatarUrl = event.avatarUrl.slice(0, 500)
  }
  if (typeof event.realName === 'string') {
    patch.realName = event.realName.trim().slice(0, 30)
  }
  if (Object.keys(patch).length === 0) return { success: false, error: '无有效更新字段' }
  patch.updatedAt = Date.now()
  await db.collection('users').where({ _openid: OPENID }).limit(1).update({ data: patch })
  const updated = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  return { success: true, data: updated.data[0] }
}

async function exportMyData(OPENID) {
  const user = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  const cards = await db.collection('cards').where({ _openid: OPENID }).limit(1000).get()
  const saves = await db.collection('user_save_cards').where({ _openid: OPENID }).limit(1000).get()
  const visits = await db.collection('visits').where({ cardOwnerId: OPENID }).limit(1000).get()
  const memberOf = await db.collection('team_members').where({ memberOpenId: OPENID }).limit(100).get()
  const u = (user.data && user.data[0]) || null
  const data = {
    user: u,
    cards: cards.data,
    savedCards: saves.data,
    visitsReceived: visits.data,
    teams: memberOf.data
  }
  const csv = [
    'field,value',
    'openid,' + OPENID,
    'nickname,' + (u && u.nickname || ''),
    'realName,' + (u && u.realName || ''),
    'registeredAt,' + (u && u.registeredAt || ''),
    'lastLoginAt,' + (u && u.lastLoginAt || ''),
    'cardsCount,' + cards.data.length,
    'savedCount,' + saves.data.length,
    'visitsReceivedCount,' + visits.data.length
  ].join('\n')
  return { success: true, data, csv }
}

async function requestDeleteAccount(OPENID) {
  const owned = await db.collection('teams').where({ ownerOpenId: OPENID }).limit(100).get()
  if (owned.data && owned.data.length > 0) {
    return {
      success: true,
      canDelete: false,
      reason: 'hasTeams',
      ownedTeams: owned.data.map(t => ({ _id: t._id, name: t.name }))
    }
  }
  return { success: true, canDelete: true }
}

async function confirmDeleteAccount(OPENID) {
  // 二次校验：仍拥有团队则拒绝（必须先转让或解散）
  const owned = await db.collection('teams').where({ ownerOpenId: OPENID }).limit(1).get()
  if (owned.data && owned.data.length > 0) {
    return { success: false, error: '仍拥有团队，需先转让或解散' }
  }
  const now = Date.now()
  await db.collection('users').where({ _openid: OPENID }).limit(1).update({
    data: { status: 'deleted', deletedAt: now, updatedAt: now }
  })
  // 清理个人关联数据（保留 cards 内容归属，仅清收藏）
  await db.collection('user_save_cards').where({ _openid: OPENID }).remove()
  await writeAudit(OPENID, 'self_delete', { openid: OPENID })
  return { success: true }
}

async function writeAudit(operatorOpenid, action, detail) {
  try {
    await db.collection('admin_audit_log').add({
      data: {
        operatorOpenid,
        action,
        detail: detail || {},
        createdAt: Date.now()
      }
    })
  } catch (e) {}
}
