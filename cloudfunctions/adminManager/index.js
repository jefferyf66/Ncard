const cloud = require('wx-server-sdk')
const CloudBase = require('@cloudbase/manager-node')
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
    batchArchiveUnnamed: batchArchiveUnnamed,
    storageAudit: storageAudit,
    storagePurge: storagePurge
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
  const needRoot = ['setUserRole', 'transferRoot', 'batchArchiveUnnamed', 'storageAudit', 'storagePurge']
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

/**
 * 存储对账（仅 root，只报告不删除 — B1）
 * 扫描云存储 avatars/ 与 sharecards/ 全量文件，与数据库引用源比对，
 * 输出「无引用孤儿清单」与「DB 引用但文件缺失的悬空引用清单」。
 * 删除动作不在本 action 内：人工确认清单后另行处理（分批小步删除）。
 *
 * 引用源（avatars 归属）：cards.avatar、users.avatarUrl、visitor_profiles.avatarUrl
 *   注：visits.visitorAvatar 是快照冗余，现有设计本就容忍其失效，不纳入保留集
 * 引用源（sharecards 归属）：cards.shareImageFileID / shareImageUrl（HTTPS 反解）
 *   + 由存活 cardId 确定性推导的 sharecards/card_<id>.jpg
 */
const AUDIT_CAP = 300 // 返回清单上限，超出仅返回前 300 条并标记 truncated

/**
 * 构造 manager-node 实例。deleteFile 等管理端 API 的请求域名是
 * `<envId>.internal.<region>.tcb-api.tencentcloudapi.com`，
 * 空构造 new CloudBase({}) 拿不到 envId → 域名缺 env 段 → ENOTFOUND。
 * 必须显式传 envId（云函数运行时从 TCB_ENV / getWXContext().ENV 获取）。
 */
function getManager() {
  const envId = process.env.TCB_ENV || process.env.SCF_NAMESPACE
  if (!envId) {
    const ctx = cloud.getWXContext() || {}
    const fallback = ctx.ENV || ctx.environ
    if (fallback && fallback.indexOf('$') !== 0) return new CloudBase({ envId: fallback })
    throw new Error('无法确定环境 ID（TCB_ENV 为空），manager-node 管理端 API 需要 envId')
  }
  return new CloudBase({ envId })
}

function extractCloudPath(ref) {
  if (!ref || typeof ref !== 'string') return ''
  if (ref.indexOf('cloud://') === 0) {
    return ref.replace('cloud://', '').split('/').slice(1).join('/')
  }
  const m = ref.match(/^https:\/\/[^/]+\/([^\s?#]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

async function scanAll(collectionName, fieldSpec) {
  const rows = []
  let skip = 0
  while (true) {
    const page = await db.collection(collectionName)
      .field(fieldSpec)
      .skip(skip).limit(1000).get()
    const data = page.data || []
    rows.push(...data)
    if (data.length < 1000) break
    skip += 1000
    if (skip > 100000) break // 硬上限保护
  }
  return rows
}

async function computeStorageRecon() {
  // 1. 列云存储文件（云函数环境内 manager-node 自动使用环境凭据，无需密钥）
  let avatarFiles, shareFiles
  try {
    const storage = getManager().storage
    ;[avatarFiles, shareFiles] = await Promise.all([
      storage.listDirectoryFiles('avatars/'),
      storage.listDirectoryFiles('sharecards/')
    ])
  } catch (e) {
    return { error: '云存储列举失败（检查 @cloudbase/manager-node 依赖是否随函数部署）: ' + ((e && e.message) || String(e)) }
  }

  // 2. 拉取 DB 引用源
  const [users, cards, profiles] = await Promise.all([
    scanAll('users', { avatarUrl: true }),
    scanAll('cards', { avatar: true, shareImageFileID: true, shareImageUrl: true }),
    scanAll('visitor_profiles', { avatarUrl: true })
  ])

  // 3. 构建保留集（cloudPath 集合）
  const keepAvatars = new Set()
  const keepShare = new Set()
  const refList = [] // { dir, path, source } 用于悬空引用报告

  const collect = (dir, raw, source) => {
    const p = extractCloudPath(raw)
    if (!p || p.indexOf(dir) !== 0) return
    if (dir === 'avatars/') keepAvatars.add(p)
    else keepShare.add(p)
    refList.push({ dir, path: p, source })
  }

  users.forEach(u => collect('avatars/', u.avatarUrl, 'users:' + (u._id || '')))
  profiles.forEach(p => collect('avatars/', p.avatarUrl, 'visitor_profiles:' + (p._id || '')))
  cards.forEach(c => {
    collect('avatars/', c.avatar, 'cards:' + c._id)
    collect('sharecards/', c.shareImageFileID, 'cards:' + c._id)
    collect('sharecards/', c.shareImageUrl, 'cards:' + c._id)
    keepShare.add('sharecards/card_' + c._id + '.jpg') // 确定性推导
  })

  // 4. 对账
  const normalize = (files) => (files || []).map(f => ({
    key: f.Key,
    sizeKB: Math.round((Number(f.Size) || 0) / 1024 * 10) / 10,
    lastModified: f.LastModified || ''
  }))

  const storageAvatars = normalize(avatarFiles)
  const storageShare = normalize(shareFiles)

  const orphanAvatars = storageAvatars.filter(f => !keepAvatars.has(f.key))
  const orphanShare = storageShare.filter(f => !keepShare.has(f.key))

  const storageKeySet = new Set([...storageAvatars, ...storageShare].map(f => f.key))
  const danglingAvatars = refList.filter(r => r.dir === 'avatars/' && !storageKeySet.has(r.path))
  const danglingShare = refList.filter(r => r.dir === 'sharecards/' && !storageKeySet.has(r.path))

  const sumKB = (list) => Math.round(list.reduce((s, f) => s + f.sizeKB, 0) * 10) / 10

  const summary = {
    generatedAt: Date.now(),
    avatars: {
      storageTotal: storageAvatars.length,
      storageSizeKB: sumKB(storageAvatars),
      keepRefs: keepAvatars.size,
      orphans: orphanAvatars.length,
      orphanSizeKB: sumKB(orphanAvatars),
      orphanList: orphanAvatars.slice(0, AUDIT_CAP),
      orphanTruncated: orphanAvatars.length > AUDIT_CAP
    },
    sharecards: {
      storageTotal: storageShare.length,
      storageSizeKB: sumKB(storageShare),
      keepRefs: keepShare.size,
      orphans: orphanShare.length,
      orphanSizeKB: sumKB(orphanShare),
      orphanList: orphanShare.slice(0, AUDIT_CAP),
      orphanTruncated: orphanShare.length > AUDIT_CAP
    },
    dangling: {
      avatars: danglingAvatars.slice(0, AUDIT_CAP),
      avatarsTruncated: danglingAvatars.length > AUDIT_CAP,
      sharecards: danglingShare.slice(0, AUDIT_CAP),
      sharecardsTruncated: danglingShare.length > AUDIT_CAP
    },
    note: '本 action 只报告不删除。清理请用 storagePurge（dryRun 预览，确认后 execute）或人工在控制台删除。'
  }

  return { summary, orphanAvatars, orphanShare }
}

async function storageAudit(OPENID, myRole, event) {
  const recon = await computeStorageRecon()
  if (recon.error) return { success: false, error: recon.error }

  await writeAudit(OPENID, 'storage_audit', {
    avatarsOrphans: recon.summary.avatars.orphans,
    sharecardsOrphans: recon.summary.sharecards.orphans
  })

  return { success: true, data: recon.summary }
}

/**
 * 存储清理（仅 root，B2）— 删前现算现复核
 * 与 storageAudit 共用同一套对账逻辑：每次调用都重新列举云存储 + 重新拉取
 * DB 引用集，只删「当下确认无任何引用」的孤儿文件，杜绝按旧清单误删。
 * 参数：event.dryRun（默认 true，只返回将删清单不执行）；event.execute=true 且
 * dryRun!==false 时才真正删除。每批 20 个分批调 deleteFile。
 */
const PURGE_BATCH = 20

async function storagePurge(OPENID, myRole, event) {
  const dryRun = !(event && event.execute === true && event.dryRun !== true)
  const recon = await computeStorageRecon()
  if (recon.error) return { success: false, error: recon.error }

  const { orphanAvatars, orphanShare } = recon
  const targets = [
    ...orphanAvatars.map(f => f.key),
    ...orphanShare.map(f => f.key)
  ]
  const totalKB = Math.round((recon.summary.avatars.orphanSizeKB + recon.summary.sharecards.orphanSizeKB) * 10) / 10

  if (dryRun || targets.length === 0) {
    await writeAudit(OPENID, 'storage_purge_dryrun', { count: targets.length, sizeKB: totalKB })
    return {
      success: true,
      data: {
        dryRun: true,
        wouldDelete: targets.length,
        wouldDeleteSizeKB: totalKB,
        avatars: orphanAvatars.map(f => f.key),
        sharecards: orphanShare.map(f => f.key),
        hint: '确认无误后传 { action: "storagePurge", execute: true } 执行删除'
      }
    }
  }

  // 真删除：分批执行
  const deleted = []
  const failed = []
  try {
    const storage = getManager().storage
    for (let i = 0; i < targets.length; i += PURGE_BATCH) {
      const batch = targets.slice(i, i + PURGE_BATCH)
      try {
        await storage.deleteFile(batch)
        deleted.push(...batch)
      } catch (e) {
        failed.push({ batch: batch[0] + ' ... (' + batch.length + ' files)', error: (e && e.message) || String(e) })
      }
    }
  } catch (e) {
    return { success: false, error: '删除初始化失败: ' + ((e && e.message) || String(e)), deletedSoFar: deleted }
  }

  await writeAudit(OPENID, 'storage_purge', {
    requested: targets.length,
    deleted: deleted.length,
    failedBatches: failed.length,
    keys: deleted.slice(0, AUDIT_CAP)
  })

  return {
    success: failed.length === 0,
    data: {
      requested: targets.length,
      deleted: deleted.length,
      failed: failed,
      keys: deleted.slice(0, AUDIT_CAP)
    }
  }
}
