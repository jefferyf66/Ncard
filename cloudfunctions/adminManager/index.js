const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ROLE_LEVEL = { user: 1, admin: 2, root: 3 }

/**
 * 运营后台管理（L2）
 * 安全红线：所有 action 服务端以 getWXContext().OPENID 查 users.role 判定权限，
 * 绝不信任客户端传入的身份或目标。关键操作写 admin_audit_log。
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { success: false, error: 'no openid' }

  const action = event && event.action
  const handlers = {
    getUserStats: getUserStats,
    listUsers: listUsers,
    getUserDetail: getUserDetail,
    listTeams: listTeams,
    setUserRole: setUserRole,
    transferRoot: transferRoot,
    disbandTeam: disbandTeam,
    batchArchiveUnnamed: batchArchiveUnnamed
  }
  const fn = handlers[action]
  if (!fn) return { success: false, error: 'unknown action: ' + action }

  // 取调用者角色
  let myRole = 'user'
  try {
    const meRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    const me = (meRes.data && meRes.data[0]) || null
    myRole = (me && me.role) || 'user'
  } catch (e) {}

  // 权限门槛
  const needAdmin = ['getUserStats', 'listUsers', 'getUserDetail', 'listTeams', 'disbandTeam']
  const needRoot = ['setUserRole', 'transferRoot', 'batchArchiveUnnamed']
  if (needAdmin.indexOf(action) > -1 && ROLE_LEVEL[myRole] < ROLE_LEVEL.admin) {
    return { success: false, error: '需要 admin 及以上权限' }
  }
  if (needRoot.indexOf(action) > -1 && myRole !== 'root') {
    return { success: false, error: '需要 root 权限' }
  }

  try {
    return await fn(OPENID, myRole, event)
  } catch (e) {
    console.error('[adminManager] ' + action + ' 失败:', e)
    return { success: false, error: (e && e.message) || String(e) }
  }
}

async function getUserStats() {
  const now = Date.now()
  const d7 = now - 7 * 86400000
  const d30 = now - 30 * 86400000
  const total = await db.collection('users').where({ status: 'active' }).count()
  const active7 = await db.collection('users').where({ status: 'active', lastLoginAt: _.gte(d7) }).count()
  const zombie30 = await db.collection('users').where({ status: 'active', lastLoginAt: _.lte(d30) }).count()
  const deleted = await db.collection('users').where({ status: 'deleted' }).count()
  return {
    success: true,
    data: {
      total: total.total,
      active7: active7.total,
      zombie30: zombie30.total,
      deleted: deleted.total
    }
  }
}

async function listUsers(OPENID, myRole, event) {
  const page = Math.max(0, parseInt(event.page) || 0)
  const pageSize = Math.min(50, parseInt(event.pageSize) || 20)
  const where = { status: _.neq('deleted') }
  if (event.role) where.role = event.role
  if (event.keyword) {
    where.nickname = db.RegExp({ regexp: String(event.keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
  }
  const totalRes = await db.collection('users').where(where).count()
  const list = await db.collection('users').where(where)
    .orderBy('lastLoginAt', 'desc')
    .skip(page * pageSize).limit(pageSize).get()
  return {
    success: true,
    data: { list: list.data, total: totalRes.total, page, pageSize }
  }
}

async function getUserDetail(OPENID, myRole, event) {
  const targetOpenid = event.openid
  if (!targetOpenid) return { success: false, error: '缺少 openid' }
  const u = await db.collection('users').where({ _openid: targetOpenid }).limit(1).get()
  if (!u.data || u.data.length === 0) return { success: false, error: '用户不存在' }
  const memberOf = await db.collection('team_members').where({ memberOpenId: targetOpenid }).limit(100).get()
  const owned = await db.collection('teams').where({ ownerOpenId: targetOpenid }).limit(100).get()
  return {
    success: true,
    data: { user: u.data[0], memberOf: memberOf.data, ownedTeams: owned.data }
  }
}

async function listTeams() {
  const teams = await db.collection('teams').limit(100).get()
  const list = (teams.data || []).map(t => ({
    _id: t._id,
    name: t.name,
    ownerOpenId: t.ownerOpenId,
    memberCount: (t.memberCount) || 0,
    allowDirectoryShare: !!t.allowDirectoryShare
  }))
  return { success: true, data: { list } }
}

async function setUserRole(OPENID, myRole, event) {
  const targetOpenid = event.openid
  const newRole = event.role
  if (!targetOpenid || !newRole) return { success: false, error: '缺少参数' }
  if (newRole === 'root') return { success: false, error: '晋升 root 请使用 transferRoot' }
  if (['admin', 'user'].indexOf(newRole) === -1) return { success: false, error: '非法角色' }
  // 不能把自己降级（root 必须先转让）
  if (targetOpenid === OPENID && newRole !== 'root') {
    return { success: false, error: '不能修改自己的角色，请先转让 root' }
  }
  await db.collection('users').where({ _openid: targetOpenid }).limit(1).update({
    data: { role: newRole, updatedAt: Date.now() }
  })
  await writeAudit(OPENID, 'set_user_role', { target: targetOpenid, role: newRole })
  return { success: true }
}

async function transferRoot(OPENID, myRole, event) {
  const newOpenid = event.openid
  if (!newOpenid) return { success: false, error: '缺少目标 openid' }
  if (newOpenid === OPENID) return { success: false, error: '不能转让给自己' }
  const newUser = await db.collection('users').where({ _openid: newOpenid }).limit(1).get()
  if (!newUser.data || newUser.data.length === 0) return { success: false, error: '目标用户不存在' }
  const newId = newUser.data[0]._id
  const oldRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  if (!oldRes.data || oldRes.data.length === 0) return { success: false, error: '当前用户不存在' }
  const oldId = oldRes.data[0]._id

  // 事务保证唯一 root：新 root 置位 + 旧 root 降级原子完成，杜绝零/双 root
  const transaction = await db.startTransaction()
  try {
    await transaction.collection('users').doc(newId).update({ data: { role: 'root', updatedAt: Date.now() } })
    await transaction.collection('users').doc(oldId).update({ data: { role: 'admin', updatedAt: Date.now() } })
    await transaction.commit()
  } catch (e) {
    await transaction.rollback()
    throw e
  }
  await writeAudit(OPENID, 'transfer_root', { from: OPENID, to: newOpenid })
  return { success: true }
}

async function disbandTeam(OPENID, myRole, event) {
  const teamId = event.teamId
  if (!teamId) return { success: false, error: '缺少 teamId' }
  const team = await db.collection('teams').doc(teamId).get()
  if (!team.data) return { success: false, error: '团队不存在' }
  await db.collection('teams').doc(teamId).remove()
  await db.collection('team_members').where({ teamId }).remove()
  await db.collection('team_invites').where({ teamId }).remove()
  await writeAudit(OPENID, 'disband_team', { teamId, name: team.data.name })
  return { success: true }
}

/**
 * 批量归档「未命名」用户（仅 root）
 * 仅把 nickname='' 且 status='active' 的普通用户（排除 root/admin、排除操作者本人）置为 status='deleted'。
 * 默认 dryRun=true：只返回候选清单，不动库，避免误清。
 * 真实模式：逐用户归档 + 单条审计日志。
 */
async function batchArchiveUnnamed(OPENID, myRole, event) {
  const dryRun = event.dryRun !== false // 默认 true，必须显式传 false 才真跑
  const PAGE = 1000

  // 候选筛选：未命名 + 活跃 + 非运营角色；调用者本人单独排除在循环内
  const where = {
    nickname: '',
    status: 'active',
    role: _.neq('admin') // 直接排除 admin/root 角色（role 字段存字符串）
  }
  // 注意：role 可能是 'user'/'admin'/'root' 字符串，_.neq('admin') 仍会命中 root；
  // 为安全起见循环内再显式跳过 root，双保险。
  const candidates = []
  let skip = 0
  while (true) {
    const page = await db.collection('users').where(where).skip(skip).limit(PAGE).get()
    const rows = page.data || []
    for (const u of rows) {
      if (u._openid === OPENID) continue       // 不归档自己
      if (u.role === 'root' || u.role === 'admin') continue // 双保险排除运营账号
      candidates.push({
        _id: u._id,
        openid: u._openid,
        role: u.role || 'user',
        loginCount: u.loginCount || 0,
        registeredAt: u.registeredAt || 0,
        lastLoginAt: u.lastLoginAt || 0
      })
    }
    if (rows.length < PAGE) break
    skip += PAGE
  }

  if (dryRun) {
    return { success: true, data: { dryRun: true, count: candidates.length, candidates } }
  }

  // 真实归档：逐用户 status='deleted' + 审计
  let archived = 0
  const failed = []
  for (const c of candidates) {
    try {
      await db.collection('users').doc(c._id).update({
        data: { status: 'deleted', deletedAt: Date.now(), updatedAt: Date.now() }
      })
      await writeAudit(OPENID, 'archive_unnamed', { target: c.openid, role: c.role })
      archived++
    } catch (e) {
      failed.push({ openid: c.openid, error: (e && e.message) || String(e) })
    }
  }
  return { success: true, data: { dryRun: false, archived, total: candidates.length, failed } }
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
