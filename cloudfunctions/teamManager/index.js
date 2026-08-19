/**
 * teamManager 云函数 —— 团队租户（Phase 1 MVP）
 *
 * 单一云函数 + action 路由。所有读写经此函数（admin 上下文），客户端不直接写库。
 *
 * 安全铁律：
 *  - cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) 必须在 db 之前
 *  - 所有 action 开头即取 OPENID = cloud.getWXContext().OPENID（可信身份）
 *  - 绝不读 event.openid（防伪造）
 *  - 统一返回 { success, data, error }
 *
 * 参考：getOpenId 风格（init → db → switch(action) → 统一返回 → try/catch 兜底）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 先 init 再 database（铁律）
const db = cloud.database()
const _ = db.command

const MAX_TEAMS_PER_USER = 5

// ============ 统一入口 ============
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext() // 可信身份，绝不读 event.openid
  try {
    switch (event.action) {
      case 'createTeam': return await createTeam(event, OPENID)
      case 'getMyTeams': return await getMyTeams(OPENID)
      case 'getTeam': return await getTeam(event, OPENID)
      case 'searchTeam': return await searchTeam(event)
      case 'createInvite': return await createInvite(event, OPENID)
      case 'joinByInvite': return await joinByInvite(event, OPENID)
      case 'revokeInvite': return await revokeInvite(event, OPENID)
      case 'listMembers': return await listMembers(event, OPENID)
      case 'updateMemberFields': return await updateMemberFields(event, OPENID)
      case 'removeMember': return await removeMember(event, OPENID)
      case 'leaveTeam': return await leaveTeam(event, OPENID)
      // 解散团队（仅 owner，破坏性操作）：级联清理成员/名片关联/邀请码
      case 'disbandTeam': return await disbandTeam(event, OPENID)
      // 公开团队目录（只读公开接口，无需也不依赖 OPENID）
      case 'getTeamPublicDirectory': return await getTeamPublicDirectory(event)
      // 设置目录公开开关（owner，需 OPENID 鉴权）
      case 'setDirectoryShare': { const { OPENID } = cloud.getWXContext(); return await setDirectoryShare(event, OPENID) }
      // 跨用户读（admin 上下文）：供 preview 展示团队徽章（团队名片视图）
      case 'getCardTeams': return await getCardTeams(event)
      default: return { success: false, error: 'UNKNOWN_ACTION' }
    }
  } catch (e) {
    return { success: false, error: (e && e.message) || String(e) }
  }
}

// ============ 创建团队（含 L0–L3 查重）============
async function createTeam(event, OPENID) {
  const { name, description = '', openJoin = false, inviteEnabled = true } = event
  if (!name || !name.trim()) return { success: false, error: 'NAME_REQUIRED' }
  const norm = normalizeName(name)

  // L3 配额
  const cnt = await db.collection('teams').where({ ownerOpenId: OPENID }).count()
  if (cnt.total >= MAX_TEAMS_PER_USER) return { success: false, error: 'TEAM_LIMIT' }

  // L1 本人同名硬拦截
  const dup = await db.collection('teams').where({ ownerOpenId: OPENID, nameNorm: norm }).get()
  if (dup.data.length) return { success: false, error: 'OWN_DUP_NAME', teamId: dup.data[0]._id }

  // L0 shortId 唯一
  let shortId
  let attempts = 0
  do {
    shortId = genShortId()
    attempts++
    if (attempts > 20) return { success: false, error: 'GEN_SHORT_ID_FAIL' }
  } while ((await db.collection('teams').where({ shortId }).count()).total > 0)

  const now = Date.now()
  const teamRes = await db.collection('teams').add({
    data: {
      _openid: OPENID, // 显式写入，匹配「仅创建者可读写」
      shortId,
      name: name.trim(),
      nameNorm: norm,
      ownerOpenId: OPENID,
      description: description || '',
      logoUrl: '',
      openJoin: !!openJoin, // v1 默认 false，不被消费（前向兼容）
      inviteEnabled: inviteEnabled !== false, // 默认 true
      allowDirectoryShare: false, // 默认关闭公开目录（D 阶段新增）
      cardSchema: defaultCardSchema(), // 团队名片字段配置（可见/必填/预填）
      memberCount: 1,
      createdAt: now
    }
  })

  // 创建即 owner 且首个 active 成员
  await db.collection('team_members').add({
    data: {
      _openid: OPENID,
      teamId: teamRes._id,
      memberOpenId: OPENID,
      cardId: '', // owner 建卡后可空
      role: 'owner',
      status: 'active',
      invitedBy: '',
      managedFields: emptyFields(),
      isPrimary: true,
      avatarPublic: false, // 默认不对外公开头像（D 阶段新增）
      joinedAt: now
    }
  })

  // L2 软提示兜底：返回同名（nameNorm 相同）团队供前端二次确认
  const similar = await db.collection('teams')
    .where({ nameNorm: norm, _id: _.neq(teamRes._id) })
    .limit(10)
    .get()

  return { success: true, data: { teamId: teamRes._id, shortId, existingSimilar: similar.data } }
}

// ============ 生成邀请码（owner）============
async function createInvite(event, OPENID) {
  const { teamId, expiresAt, maxUses = 0, singleUse = false } = event
  if (!teamId) return { success: false, error: 'TEAM_NOT_FOUND' }

  const teamRes = await db.collection('teams').doc(teamId).get()
  const team = teamRes && teamRes.data
  if (!team) return { success: false, error: 'TEAM_NOT_FOUND' }
  if (team.ownerOpenId !== OPENID) return { success: false, error: 'NO_PERMISSION' }
  if (!team.inviteEnabled) return { success: false, error: 'INVITE_DISABLED' }

  let code
  let attempts = 0
  do {
    code = genInviteCode()
    attempts++
    if (attempts > 20) return { success: false, error: 'GEN_CODE_FAIL' }
  } while ((await db.collection('team_invites').where({ code }).count()).total > 0)

  const token = genToken()
  const res = await db.collection('team_invites').add({
    data: {
      _openid: OPENID,
      teamId,
      code,
      token,
      createdBy: OPENID,
      expiresAt: expiresAt || Date.now() + 7 * 86400000, // 默认 7 天
      maxUses: maxUses || 0, // 0 = 不限
      usedCount: 0,
      singleUse: !!singleUse
    }
  })

  return { success: true, data: { inviteId: res._id, code, token, teamId } }
}

// ============ 生成「空名片」邀请（owner，kind='card'）============
async function createCardInvite(event, OPENID) {
  const { teamId, prefill = {}, expiresAt, singleUse = true } = event
  if (!teamId) return { success: false, error: 'TEAM_NOT_FOUND' }

  const teamRes = await db.collection('teams').doc(teamId).get()
  const team = teamRes && teamRes.data
  if (!team) return { success: false, error: 'TEAM_NOT_FOUND' }
  if (team.ownerOpenId !== OPENID) return { success: false, error: 'NO_PERMISSION' }
  if (!team.inviteEnabled) return { success: false, error: 'INVITE_DISABLED' }

  const prefillClean = sanitizePrefill(prefill)

  let code
  let attempts = 0
  do {
    code = genInviteCode()
    attempts++
    if (attempts > 20) return { success: false, error: 'GEN_CODE_FAIL' }
  } while ((await db.collection('team_invites').where({ code }).count()).total > 0)

  const token = genToken()
  const res = await db.collection('team_invites').add({
    data: {
      _openid: OPENID,
      teamId,
      code,
      token,
      createdBy: OPENID,
      kind: 'card', // 空名片邀请：成员需补全字段
      prefill: prefillClean,
      expiresAt: expiresAt || Date.now() + 7 * 86400000, // 默认 7 天
      maxUses: 0,
      usedCount: 0,
      singleUse: !!singleUse
    }
  })

  return { success: true, data: { inviteId: res._id, code, token, teamId } }
}

// ============ 保存团队名片字段配置（owner）============
async function saveTeamCardSchema(event, OPENID) {
  const { teamId, cardSchema } = event
  if (!teamId) return { success: false, error: 'TEAM_NOT_FOUND' }

  const teamRes = await db.collection('teams').doc(teamId).get()
  const team = teamRes && teamRes.data
  if (!team || team.ownerOpenId !== OPENID) return { success: false, error: 'NO_PERMISSION' }

  const schema = sanitizeCardSchema(cardSchema)
  await db.collection('teams').doc(teamId).update({ data: { cardSchema: schema } })
  return { success: true, data: { cardSchema: schema } }
}

// ============ 凭邀请码/分享 token 加入（D8 需 card）============
async function joinByInvite(event, OPENID) {
  const { code, token } = event
  let inv = null
  if (code) {
    const r = await db.collection('team_invites').where({ code }).get()
    inv = r.data && r.data[0]
  } else if (token) {
    // 分享卡片形态（P1）：携带 teamId+token 直接加入
    const r = await db.collection('team_invites').where({ token }).get()
    inv = r.data && r.data[0]
  }
  if (!inv) return { success: false, error: 'INVITE_NOT_FOUND' }

  // 过期校验
  if (inv.expiresAt && Date.now() > inv.expiresAt) return { success: false, error: 'INVITE_EXPIRED' }
  // 限额校验
  if (inv.maxUses && inv.usedCount >= inv.maxUses) return { success: false, error: 'INVITE_USED_UP' }
  if (inv.singleUse && inv.usedCount >= 1) return { success: false, error: 'INVITE_USED_UP' } // BUG-02 修复：单次邀请码不可复用（usedCount 已自增，>=1 即失效）

  const teamRes = await db.collection('teams').doc(inv.teamId).get()
  if (!teamRes || !teamRes.data) return { success: false, error: 'TEAM_NOT_FOUND' }

  const exist = await db.collection('team_members').where({ teamId: inv.teamId, memberOpenId: OPENID }).get()
  if (exist.data.length) return { success: false, error: 'ALREADY_MEMBER' }

  // D8：加入需先有个人名片（云函数按 _openid 自动定位，防伪造）
  const cardRes = await db.collection('cards').where({ _openid: OPENID }).orderBy('createdAt', 'desc').limit(1).get()
  const card = cardRes.data && cardRes.data[0]
  if (!card) return { success: false, error: 'NO_CARD', hint: '请先创建个人名片' }

  // 计算最终托管字段；空名片邀请需合并 owner 预填 + 成员填写 + 必填校验
  let finalMF = emptyFields()
  if (inv.kind === 'card') {
    const schema = (teamRes.data && teamRes.data.cardSchema) || defaultCardSchema()
    const userMF = sanitizeManagedFields(event.managedFields || {})
    const prefill = inv.prefill || {}
    const requiredKeys = schema.filter(f => f.required).map(f => f.key)
    schema.forEach(f => {
      const def = (prefill[f.key] || '').trim()
      const usr = (userMF[f.key] || '').trim()
      // 成员填了用成员的，未填回退 owner 预填（预填可改：成员可覆盖）
      finalMF[f.key] = usr || def
    })
    const missing = requiredKeys.filter(k => !(finalMF[k] || '').trim())
    if (missing.length) return { success: false, error: 'MISSING_REQUIRED', fields: missing }
  }

  const now = Date.now()
  await db.collection('team_members').add({
    data: {
      _openid: OPENID,
      teamId: inv.teamId,
      memberOpenId: OPENID,
      cardId: card._id,
      role: 'member',
      status: 'active',
      invitedBy: inv.createdBy,
      managedFields: finalMF,
      isPrimary: false,
      avatarPublic: false, // 默认不对外公开头像（D 阶段新增）
      joinedAt: now
    }
  })

  // 维护卡片 teamIds（冗余）+ 团队 memberCount + 邀请 usedCount
  await db.collection('cards').doc(card._id).update({ data: { teamIds: _.push(inv.teamId) } })
  await db.collection('teams').doc(inv.teamId).update({ data: { memberCount: _.inc(1) } })
  await db.collection('team_invites').doc(inv._id).update({ data: { usedCount: _.inc(1) } })

  return { success: true, data: { teamId: inv.teamId } }
}

// ============ 成员列表（成员/owner）============
async function listMembers(event, OPENID) {
  const { teamId } = event
  if (!teamId) return { success: false, error: 'TEAM_NOT_FOUND' }

  const me = await db.collection('team_members').where({ teamId, memberOpenId: OPENID, status: 'active' }).get()
  if (!me.data.length) return { success: false, error: 'NOT_MEMBER' }

  const list = await db.collection('team_members').where({ teamId }).orderBy('joinedAt', 'asc').get()
  return { success: true, data: { members: list.data, role: me.data[0].role } }
}

// ============ 管理员更新成员组织字段（仅 D2 七个字段）============
async function updateMemberFields(event, OPENID) {
  const { teamId, memberOpenId, managedFields } = event
  if (!teamId || !memberOpenId) return { success: false, error: 'MEMBER_NOT_FOUND' }

  const teamRes = await db.collection('teams').doc(teamId).get()
  const team = teamRes && teamRes.data
  if (!team || team.ownerOpenId !== OPENID) return { success: false, error: 'NO_PERMISSION' }

  const mem = await db.collection('team_members').where({ teamId, memberOpenId }).get()
  if (!mem.data.length) return { success: false, error: 'MEMBER_NOT_FOUND' }

  const patch = sanitizeManagedFields(managedFields) // 仅放行 D2 七个组织字段
  await db.collection('team_members').doc(mem.data[0]._id).update({ data: { managedFields: patch } })
  return { success: true }
}

// ============ 移除成员（owner，不可移除 owner）============
async function removeMember(event, OPENID) {
  const { teamId, memberOpenId } = event
  if (!teamId || !memberOpenId) return { success: false, error: 'MEMBER_NOT_FOUND' }

  const teamRes = await db.collection('teams').doc(teamId).get()
  const team = teamRes && teamRes.data
  if (!team || team.ownerOpenId !== OPENID) return { success: false, error: 'NO_PERMISSION' }
  if (memberOpenId === OPENID) return { success: false, error: 'CANNOT_REMOVE_OWNER' }

  const mem = await db.collection('team_members').where({ teamId, memberOpenId }).get()
  if (!mem.data.length) return { success: false, error: 'MEMBER_NOT_FOUND' }

  const m = mem.data[0]
  await db.collection('team_members').doc(m._id).remove()
  if (m.cardId) await db.collection('cards').doc(m.cardId).update({ data: { teamIds: _.pull(teamId) } })
  await db.collection('teams').doc(teamId).update({ data: { memberCount: _.inc(-1) } })
  return { success: true }
}

// ============ 退出团队（owner 受保护）============
async function leaveTeam(event, OPENID) {
  const { teamId } = event
  if (!teamId) return { success: false, error: 'TEAM_NOT_FOUND' }

  const mem = await db.collection('team_members').where({ teamId, memberOpenId: OPENID }).get()
  if (!mem.data.length) return { success: false, error: 'NOT_MEMBER' }

  const m = mem.data[0]
  // v1 owner 须先转让/解散（Phase 2），不可退
  if (m.role === 'owner') return { success: false, error: 'OWNER_CANNOT_LEAVE' }

  await db.collection('team_members').doc(m._id).remove()
  if (m.cardId) await db.collection('cards').doc(m.cardId).update({ data: { teamIds: _.pull(teamId) } })
  await db.collection('teams').doc(teamId).update({ data: { memberCount: _.inc(-1) } })
  return { success: true }
}

// ============ 解散团队（仅 owner，破坏性操作）============
async function disbandTeam(event, OPENID) {
  const { teamId } = event
  if (!teamId) return { success: false, error: 'TEAM_NOT_FOUND' }

  const teamRes = await db.collection('teams').doc(teamId).get()
  if (!teamRes.data) return { success: false, error: 'TEAM_NOT_FOUND' }
  // 安全：仅创始人可解散（OPENID 来自云端，绝不读 event.openid）
  if (teamRes.data.ownerOpenId !== OPENID) return { success: false, error: 'NOT_OWNER' }

  // 取成员（用于清理各名片上的 teamIds 关联）
  const memRes = await db.collection('team_members').where({ teamId }).get()
  const cardIds = [...new Set((memRes.data || []).map(m => m.cardId).filter(Boolean))]

  const tasks = []
  // 1) 各成员名片 pull 掉该 teamId（解除名片托管关联）；个别名片缺失不阻断整体解散
  cardIds.forEach(cid => {
    tasks.push(db.collection('cards').doc(cid).update({ data: { teamIds: _.pull(teamId) } }).catch(() => {}))
  })
  // 2) 删除全部成员记录
  tasks.push(db.collection('team_members').where({ teamId }).remove())
  // 3) 删除该团队所有邀请码（使其立即失效）
  tasks.push(db.collection('team_invites').where({ teamId }).remove())
  // 4) 删除团队本身
  tasks.push(db.collection('teams').doc(teamId).remove())
  await Promise.all(tasks)

  return { success: true }
}

// ============ 我的团队（含角色/状态/托管字段）============
async function getMyTeams(OPENID) {
  const mem = await db.collection('team_members').where({ memberOpenId: OPENID }).get()
  const teamIds = mem.data.map(m => m.teamId)
  if (!teamIds.length) return { success: true, data: { teams: [] } }

  const teams = await db.collection('teams').where({ _id: _.in(teamIds) }).get()
  const map = {}
  mem.data.forEach(m => {
    map[m.teamId] = {
      role: m.role,
      status: m.status,
      isPrimary: m.isPrimary,
      managedFields: m.managedFields || emptyFields()
    }
  })
  const result = teams.data.map(t => ({
    ...t,
    myRole: map[t._id].role,
    myStatus: map[t._id].status,
    isPrimary: map[t._id].isPrimary,
    managedFields: map[t._id].managedFields
  }))
  return { success: true, data: { teams: result } }
}

// ============ 团队标识解析（shortId 优先，兼容 teamId 实则为 shortId）============
// 返回 teams 文档或 null。统一供 getTeam / getTeamPublicDirectory 复用。
async function resolveTeamRef(event) {
  const { teamId, shortId } = event
  // 1) 显式 shortId：where 命中取其 _id
  if (shortId) {
    const r = await db.collection('teams').where({ shortId }).limit(1).get()
    return (r.data && r.data[0]) || null
  }
  if (!teamId) return null
  // 2) teamId：先按 _id 直查；未命中再按 shortId 回退（兼容详情页传 rawId）
  try {
    const d = await db.collection('teams').doc(teamId).get()
    if (d && d.data) return d.data
  } catch (e) { /* 非法 id 形态，走下面 shortId 回退 */ }
  const r = await db.collection('teams').where({ shortId: teamId }).limit(1).get()
  return (r.data && r.data[0]) || null
}

// ============ 团队详情（含我的角色/状态）============
async function getTeam(event, OPENID) {
  const team = await resolveTeamRef(event)
  if (!team) return { success: false, error: 'TEAM_NOT_FOUND' }
  const teamId = team._id

  const mem = await db.collection('team_members').where({ teamId, memberOpenId: OPENID }).get()
  // BUG-03 修复：非成员读（join 页预填所需，逻辑正确）时收窄字段，避免外泄 _openid/ownerOpenId 等敏感信息
  const isMember = mem.data.length > 0
  // 团队名片字段 schema（仅字段定义，不含敏感数据，成员/非成员均可下发）
  const cardSchema = team.cardSchema || defaultCardSchema()
  const safeTeam = isMember
    ? Object.assign({}, team, {
        // 成员可见「是否公开目录」开关
        allowDirectoryShare: !!team.allowDirectoryShare,
        cardSchema
      })
    : {
        // 非成员白名单分支：仅含基础公开字段，绝不返回 allowDirectoryShare（避免泄漏是否公开）
        _id: team._id,
        shortId: team.shortId,
        name: team.name,
        description: team.description,
        logoUrl: team.logoUrl,
        memberCount: team.memberCount,
        cardSchema
      }
  return {
    success: true,
    data: {
      team: safeTeam,
      myRole: isMember ? mem.data[0].role : null,
      myStatus: isMember ? mem.data[0].status : null
    }
  }
}

// ============ 公开团队目录（只读公开接口，无需/不依赖 OPENID）============
// 用于分享链接 / 公众号菜单直达，仅返回白名单六字段，剔除一切私人联系方式与 openid。
async function getTeamPublicDirectory(event) {
  const { teamId, shortId } = event
  if (!teamId && !shortId) return { success: false, error: 'INVALID_PARAM' }

  const team = await resolveTeamRef(event)
  if (!team) return { success: false, error: 'TEAM_NOT_FOUND' }

  // 未开启公开目录 → 拒绝（即便非成员也不得窥探）
  if (team.allowDirectoryShare !== true) return { success: false, error: 'TEAM_NOT_PUBLIC' }

  // 仅取 active 成员
  const memRes = await db.collection('team_members').where({ teamId: team._id, status: 'active' }).get()
  const members = memRes.data || []

  // 批量取 cards：db.command.in 单次上限 20，必须按 20 一组循环
  const cardIds = members.map(m => m.cardId).filter(Boolean)
  const cardsMap = {}
  for (let i = 0; i < cardIds.length; i += 20) {
    const chunk = cardIds.slice(i, i + 20)
    const r = await db.collection('cards').where({ _id: _.in(chunk) }).get()
    ;(r.data || []).forEach(c => { cardsMap[c._id] = c })
  }

  // 仅以白名单六字段构造每个成员的组织名片（绝不原样下发文档）
  const ALLOWED_KEYS = ['memberId', 'name', 'position', 'company', 'department', 'avatarUrl']
  // 按 cardSchema.visible 过滤展示字段；phone/email/address/website 即便 visible 也绝不进公开目录（安全边界）
  const schema = team.cardSchema || defaultCardSchema()
  const visMap = {}
  schema.forEach(f => { visMap[f.key] = f.visible })
  const PUBLIC_SAFE = { position: true, company: true, department: true }
  const directory = members.map(m => {
    const card = (m.cardId && cardsMap[m.cardId]) || null
    const mf = m.managedFields || {}
    const out = {
      memberId: m._id,
      name: (card && card.name) || '匿名成员',
      position: (visMap.position && PUBLIC_SAFE.position) ? ((mf.position) || (card && card.position) || '') : '',
      company: (visMap.company && PUBLIC_SAFE.company) ? ((mf.company) || (card && card.company) || '') : '',
      department: (visMap.department && PUBLIC_SAFE.department) ? ((mf.department) || (card && card.department) || '') : '',
      avatarUrl: (m.avatarPublic === true && card && card.avatarUrl) ? card.avatarUrl : ''
    }
    return out
  })

  // team 仅返回 6 个基础公开字段（剔除 _openid/ownerOpenId/memberOpenId/cardId 等敏感字段）
  const safeTeam = {
    _id: team._id,
    shortId: team.shortId,
    name: team.name,
    description: team.description,
    logoUrl: team.logoUrl,
    memberCount: team.memberCount
  }

  return {
    success: true,
    data: {
      team: safeTeam,
      members: directory
    }
  }
}

// ============ 设置目录公开开关（owner）============
async function setDirectoryShare(event, OPENID) {
  const { teamId, allow } = event
  if (!teamId) return { success: false, error: 'TEAM_NOT_FOUND' }

  const teamRes = await db.collection('teams').doc(teamId).get()
  const team = teamRes && teamRes.data
  if (!team) return { success: false, error: 'TEAM_NOT_FOUND' }
  // 仅 owner（OPENID 来自云端，绝不读 event.openid）可操作
  if (team.ownerOpenId !== OPENID) return { success: false, error: 'NO_PERMISSION' }

  await db.collection('teams').doc(teamId).update({ data: { allowDirectoryShare: !!allow } })
  return { success: true, data: { allowDirectoryShare: !!allow } }
}

// ============ 搜索团队（v1 仅创建期 L2 软提示；exact 同名）============
async function searchTeam(event) {
  const { keyword, exact = false, limit = 10 } = event
  if (!keyword || !keyword.trim()) return { success: false, error: 'KEYWORD_REQUIRED' }

  const norm = normalizeName(keyword)
  const cond = exact
    ? { nameNorm: norm }
    : { nameNorm: db.RegExp({ regexp: escapeRegExp(norm), options: 'i' }) }

  const list = await db.collection('teams').where(cond).limit(limit).get()

  // L2 展示创建者昵称（来自 users，Phase B 才填充，v1 可能为空 → 兜底空串）
  const ownerIds = [...new Set(list.data.map(t => t.ownerOpenId))]
  const users = ownerIds.length
    ? (await db.collection('users').where({ _openid: _.in(ownerIds) }).get()).data
    : []
  const nickMap = {}
  users.forEach(u => { nickMap[u._openid] = u.nickname || '' })

  const teams = list.data.map(t => ({
    _id: t._id,
    shortId: t.shortId,
    name: t.name,
    ownerOpenId: t.ownerOpenId,
    ownerNick: nickMap[t.ownerOpenId] || '',
    memberCount: t.memberCount
  }))
  return { success: true, data: { teams } }
}

// ============ 撤销邀请（owner）============
async function revokeInvite(event, OPENID) {
  const { inviteId } = event
  if (!inviteId) return { success: false, error: 'NO_PERMISSION' }

  const invRes = await db.collection('team_invites').doc(inviteId).get()
  const inv = invRes && invRes.data
  if (!inv || inv.createdBy !== OPENID) return { success: false, error: 'NO_PERMISSION' }

  await db.collection('team_invites').doc(inviteId).remove()
  return { success: true }
}

// ============ 名片所属团队 + 托管字段（跨用户读，admin 上下文）============
// 用于 preview 页展示团队徽章与「团队名片视图」覆盖层合并
async function getCardTeams(event) {
  const { cardId } = event
  if (!cardId) return { success: false, error: 'CARD_NOT_FOUND' }

  const mem = await db.collection('team_members').where({ cardId, status: 'active' }).get()
  if (!mem.data.length) return { success: true, data: { teams: [] } }

  const teamIds = mem.data.map(m => m.teamId)
  const teams = await db.collection('teams').where({ _id: _.in(teamIds) }).get()
  const teamMap = {}
  teams.data.forEach(t => { teamMap[t._id] = t })

  const result = mem.data
    .map(m => ({
      teamId: m.teamId,
      team: teamMap[m.teamId]
        ? {
            _id: teamMap[m.teamId]._id,
            name: teamMap[m.teamId].name,
            shortId: teamMap[m.teamId].shortId,
            memberCount: teamMap[m.teamId].memberCount
          }
        : null,
      managedFields: m.managedFields || emptyFields(),
      cardSchema: (teamMap[m.teamId] && teamMap[m.teamId].cardSchema) || defaultCardSchema()
    }))
    .filter(r => r.team)

  return { success: true, data: { teams: result } }
}

// ============ 工具函数 ============

/**
 * normalizeName：比对归一化（D12c）
 * 去首尾空格 → 折叠内部空格 → 全角转半角 → 中文标点归一 → toLowerCase
 * 仅用于 nameNorm 比对；存储保留用户原样
 */
function normalizeName(name) {
  if (!name) return ''
  let s = String(name).trim()
  // 全角转半角（！-～ → !-~）
  s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  // 中文标点/半角标点/特殊符号一并归一为空格（全角已在上一行转半角，故半角也要纳入字符类，见 BUG-01）
  s = s.replace(/[。、「」‘’《》【】「」,;:!?()<>\[\]{}"'`~@#￥$%^&*+=\-_/\\|．·]/g, ' ')
  // 折叠内部空白
  s = s.replace(/\s+/g, ' ')
  s = s.toLowerCase()
  return s.trim()
}

// shortId 字符集：TB 前缀 + 易读大写字母数字（去 0/O/1/I 混淆）
const SHORT_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function genShortId() {
  let s = 'TB'
  for (let i = 0; i < 6; i++) {
    s += SHORT_ID_ALPHABET[Math.floor(Math.random() * SHORT_ID_ALPHABET.length)]
  }
  return s
}

// 邀请码：6 位易读字符
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function genInviteCode() {
  let s = ''
  for (let i = 0; i < 6; i++) {
    s += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)]
  }
  return s
}

// 分享卡片校验串：16 字节随机 → 32 位 hex
function genToken() {
  try {
    const crypto = require('crypto')
    return crypto.randomBytes(16).toString('hex')
  } catch (e) {
    // 降级方案
    const a = 'abcdef0123456789'
    let s = ''
    for (let i = 0; i < 32; i++) s += a[Math.floor(Math.random() * a.length)]
    return s
  }
}

// 空托管字段（七个组织字段，统一 phone/email/address/website 命名，消除 companyPhone/workEmail 分裂）
function emptyFields() {
  return {
    company: '',
    department: '',
    position: '',
    phone: '',
    address: '',
    website: '',
    email: ''
  }
}

// 仅放行七个组织字段，其余忽略；统一 trim 为字符串
function sanitizeManagedFields(raw) {
  const out = emptyFields()
  if (!raw || typeof raw !== 'object') return out
  const keys = ['company', 'department', 'position', 'phone', 'address', 'website', 'email']
  keys.forEach(k => {
    const v = raw[k]
    out[k] = (typeof v === 'string') ? v.trim() : (v == null ? '' : String(v).trim())
  })
  return out
}

// 团队名片字段 schema：定义「团队名片」上显示哪些字段、是否必填、owner 预填默认值
// 字段 key 与 managedFields 完全一致，确保可写入/读出
function defaultCardSchema() {
  return [
    { key: 'company', label: '公司', visible: true, required: false, defaultValue: '' },
    { key: 'department', label: '部门', visible: false, required: false, defaultValue: '' },
    { key: 'position', label: '职位', visible: true, required: false, defaultValue: '' },
    { key: 'phone', label: '电话', visible: true, required: false, defaultValue: '' },
    { key: 'email', label: '邮箱', visible: false, required: false, defaultValue: '' },
    { key: 'address', label: '地址', visible: false, required: false, defaultValue: '' },
    { key: 'website', label: '网址', visible: false, required: false, defaultValue: '' }
  ]
}

// 校验并规整 owner 提交过来的 cardSchema：仅保留合法 key，字段结构归一
const CARD_SCHEMA_KEYS = ['company', 'department', 'position', 'phone', 'address', 'website', 'email']
function sanitizeCardSchema(raw) {
  const base = defaultCardSchema()
  const baseMap = {}
  base.forEach(f => { baseMap[f.key] = f })
  if (!Array.isArray(raw)) return base
  const out = base.map(f => {
    const src = raw.find(r => r && r.key === f.key)
    if (!src) return f
    return {
      key: f.key,
      label: src.label || f.label,
      visible: src.visible === true,
      required: src.required === true,
      defaultValue: (typeof src.defaultValue === 'string') ? src.defaultValue.trim().slice(0, 200) : ''
    }
  })
  // 防御：若 raw 含未知 key，忽略（不写入）
  return out.filter(f => CARD_SCHEMA_KEYS.indexOf(f.key) >= 0)
}

// 规整预填值：仅保留合法 key，统一 trim 截断
function sanitizePrefill(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  CARD_SCHEMA_KEYS.forEach(k => {
    const v = raw[k]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 200)
  })
  return out
}

// 转义正则特殊字符
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
