const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

  // 存储治理 A2：更新前读旧头像，更新成功后由服务端统一删除旧文件
  // （覆盖 account / 未来所有改头像入口；前端不再各自删，避免漏删与竞态）
  const beforeRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  const oldAvatar = (beforeRes.data && beforeRes.data[0] && beforeRes.data[0].avatarUrl) || ''

  await db.collection('users').where({ _openid: OPENID }).limit(1).update({ data: patch })
  const updated = await db.collection('users').where({ _openid: OPENID }).limit(1).get()

  // 删旧头像：仅当旧值是 cloud:// 且与新值不同；删前做引用安全检查
  if (oldAvatar && typeof patch.avatarUrl === 'string' &&
      oldAvatar !== patch.avatarUrl && oldAvatar.indexOf('cloud://') === 0) {
    try {
      const stillUsed = await Promise.all([
        db.collection('cards').where({ avatar: oldAvatar }).limit(1).get(),
        db.collection('users').where({ avatarUrl: oldAvatar }).limit(2).get(),
        db.collection('visitor_profiles').where({ avatarUrl: oldAvatar }).limit(1).get()
      ])
      const referenced = stillUsed.some((r, i) => {
        const rows = (r.data || []).filter(u => i !== 1 || u._openid !== OPENID)
        return rows.length > 0
      })
      if (!referenced) {
        await cloud.deleteFile({ fileList: [oldAvatar] })
      }
    } catch (e) { /* 清理失败不阻断保存主流程 */ }
  }

  return { success: true, data: updated.data[0] }
}

async function exportMyData(OPENID) {
  const user = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  const cards = await db.collection('cards').where({ _openid: OPENID }).limit(1000).get()
  const saves = await db.collection('user_save_cards').where({ _openid: OPENID }).limit(1000).get()
  const visits = await db.collection('visits').where({ cardOwnerId: OPENID }).limit(1000).get()
  const memberOf = await db.collection('team_members').where({ memberOpenId: OPENID }).limit(100).get()
  const u = (user.data && user.data[0]) || null
  // SEC-03：导出数据中的访客记录剔除访客私人手机号（与 initVisits getRecentVisitors/getMyVisitorDashboard 同口径）
  const visitsClean = (visits.data || []).map(function (v) {
    delete v.visitorPhone
    return v
  })
  const data = {
    user: u,
    cards: cards.data,
    savedCards: saves.data,
    visitsReceived: visitsClean,
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

  // ERR-02 修复：级联清理团队关系与访客隐私残留
  // 1) 删除该用户在 team_members 中的全部记录，并回退对应 teams.memberCount（避免团队人数虚高、团队列表显示已注销成员）
  const teamIdSet = new Set()
  const cardTeamPairs = [] // { cardId, teamId } 配对，用于清理各名片上的 teamIds 关联（修复 LOG-02 残留）
  let skip = 0
  while (true) {
    const memPage = await db.collection('team_members')
      .where({ memberOpenId: OPENID }).limit(1000).skip(skip).get()
    const rows = memPage.data || []
    // 跨页收集全量配对：分页（>1000 成员）亦能完整收集
    rows.forEach(function (m) {
      if (m.teamId) teamIdSet.add(m.teamId)
      if (m.cardId && m.teamId) cardTeamPairs.push({ cardId: m.cardId, teamId: m.teamId })
    })
    if (rows.length < 1000) break
    skip += 1000
  }
  // 逐团队回退 memberCount（可能多条同一 team，Set 已去重，每团队仅一次），等待全部完成
  await Promise.all(Array.from(teamIdSet).map(function (tid) {
    return db.collection('teams').doc(tid).update({ data: { memberCount: _.inc(-1) } }).catch(function () {})
  }))
  // 循环删除该用户全部成员记录（突破单次上限，可能多条）
  while (true) {
    const rm = await db.collection('team_members').where({ memberOpenId: OPENID }).limit(1000).remove()
    const removed = (rm.stats && rm.stats.removed) || 0
    if (removed === 0) break
  }
  // 清理被注销用户作为团队成员托管名片上的 teamIds 关联（修复 LOG-02 残留，防止 teamId 残留）
  // 个别名片缺失时用 .catch(() => {}) 兜底，避免阻断主流程
  await Promise.all(cardTeamPairs.map(function (pair) {
    return db.collection('cards').doc(pair.cardId).update({ data: { teamIds: _.pull(pair.teamId) } }).catch(function () {})
  }))
  // 2) 删除该用户作为访客的 visits 隐私残留（visitorOpenId 指向本人，防止被枚举追踪）
  while (true) {
    const rv = await db.collection('visits').where({ visitorOpenId: OPENID }).limit(1000).remove()
    const removed = (rv.stats && rv.stats.removed) || 0
    if (removed === 0) break
  }
  // 3) 彻底抹除：删除以本人为名片归属的 visits（cardOwnerId 指向本人，含第三方访客数据，注销即全量清除本人标识）
  while (true) {
    const rc = await db.collection('visits').where({ cardOwnerId: OPENID }).limit(1000).remove()
    const removed = (rc.stats && rc.stats.removed) || 0
    if (removed === 0) break
  }

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
