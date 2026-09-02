// 云函数：级联删除名片（数据库 + 云存储）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 批量安全删除（突破 where().remove() 单次约 1000 条上限）
// 循环 limit(1000).remove() 直到本次删除数为 0，返回累计删除条数
async function removeAll(collectionName, where) {
  let total = 0
  while (true) {
    const res = await db.collection(collectionName).where(where).limit(1000).remove()
    const removed = (res.stats && res.stats.removed) || 0
    total += removed
    if (removed === 0) break
  }
  return total
}

exports.main = async (event, context) => {
  const { cardId } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!cardId) {
    return { ok: false, message: '参数不完整：缺少 cardId' }
  }

  // 1. 获取名片记录，校验所有权 + 收集文件 ID
  var card
  try {
    const cardRes = await db.collection('cards').doc(cardId).get()
    card = cardRes.data
    if (!card) {
      return { ok: false, message: '名片不存在' }
    }
  } catch (e) {
    return { ok: false, message: '名片不存在或已被删除', code: e.errCode }
  }

  // 校验所有权：只有名片创建者才能删除
  // F12 修复：改严格校验（卡片均由客户端 add 自动注入 _openid，_openid 缺失也拒绝，杜绝空值放行）
  if (card._openid !== openid) {
    return { ok: false, message: '无权删除此名片' }
  }

  // 2. 收集需要删除的云存储文件
  var filesToDelete = []
  if (card.avatar && card.avatar.indexOf('cloud://') === 0) {
    filesToDelete.push(card.avatar)
  }
  if (card.attachments && card.attachments.length > 0) {
    card.attachments.forEach(function (a) {
      if (a.url && a.url.indexOf('cloud://') === 0) {
        filesToDelete.push(a.url)
      }
    })
  }

  // 2.1 存储治理 A1：级联删除分享图（此前从不清理，是 sharecards/ 只增不减的主因）
  // sharecards 路径由 cardId 确定性推导：sharecards/card_<cardId>.jpg
  // fileID 前缀（cloud://<env>.<bucket>）从本名片任意已知 cloud:// 引用提取
  try {
    var shareFileIDs = {}
    var prefix = ''
    var probe = [card.avatar, card.shareImageFileID].concat((card.attachments || []).map(function (a) { return a.url }))
    for (var i = 0; i < probe.length; i++) {
      var p = String(probe[i] || '')
      var parts = p.split('/')
      if (p.indexOf('cloud://') === 0 && parts.length >= 3 && parts[2]) {
        prefix = parts[0] + '//' + parts[2] // cloud://<env>.<bucket>
        break
      }
    }
    if (card.shareImageFileID && String(card.shareImageFileID).indexOf('cloud://') === 0) {
      shareFileIDs[card.shareImageFileID] = true
    } else if (card.shareImageUrl && prefix) {
      // 兼容旧数据：shareImageUrl 存的是 HTTPS，反解路径后拼回 fileID
      var m = String(card.shareImageUrl).match(/^https:\/\/[^/]+\/(sharecards\/[^?#]+)/)
      if (m) shareFileIDs[prefix + '/' + m[1]] = true
    }
    if (prefix) {
      // 确定性兜底：即使 shareImageUrl 回写失败（上传成功但 DB 未落），也能清掉
      shareFileIDs[prefix + '/sharecards/card_' + cardId + '.jpg'] = true
    }
    Object.keys(shareFileIDs).forEach(function (fid) {
      if (filesToDelete.indexOf(fid) === -1) filesToDelete.push(fid)
    })
  } catch (e) { /* 分享图清理失败不阻断主删除流程 */ }

  // 3. 并行执行所有清理操作（allSettled 避免单点失败阻塞）
  var tasks = []

  // 删除 cards 文档
  tasks.push(
    db.collection('cards').doc(cardId).remove()
      .then(function () { return { step: 'cards', ok: true } })
      .catch(function (e) { return { step: 'cards', ok: false, error: e.errCode } })
  )

  // 清理所有用户的保存记录（LOG-02 修复：分页循环删除，突破单次 1000 条上限）
  tasks.push(
    removeAll('user_save_cards', { cardId: cardId })
      .then(function (deleted) { return { step: 'user_save_cards', ok: true, deleted: deleted } })
      .catch(function (e) { return { step: 'user_save_cards', ok: false, error: e.errCode } })
  )

  // 清理访客记录（LOG-02 修复：分页循环删除，突破单次 1000 条上限）
  tasks.push(
    removeAll('visits', { cardId: cardId })
      .then(function (deleted) { return { step: 'visits', ok: true, deleted: deleted } })
      .catch(function (e) { return { step: 'visits', ok: false, error: e.errCode } })
  )

  // 删除云存储文件
  if (filesToDelete.length > 0) {
    tasks.push(
      cloud.deleteFile({ fileList: filesToDelete })
        .then(function (res) {
          return {
            step: 'cloud_files',
            ok: true,
            total: filesToDelete.length,
            deleted: (res.fileList || []).filter(function (f) { return f.status === 0 }).length
          }
        })
        .catch(function (e) {
          return { step: 'cloud_files', ok: false, error: e.errCode || e.message }
        })
    )
  }

  // 2.5 清理引用该名片的团队关系：删除 team_members 中 cardId 指向本名片的记录，并回退团队 memberCount
  // 避免名片删除后残留悬空托管关系、团队人数虚高
  try {
    const memRes = await db.collection('team_members').where({ cardId: cardId }).get()
    const memTasks = (memRes.data || []).map(function (m) {
      const t = [db.collection('team_members').doc(m._id).remove().catch(function () {})]
      if (m.teamId) {
        t.push(db.collection('teams').doc(m.teamId).update({ data: { memberCount: _.inc(-1) } }).catch(function () {}))
      }
      return t
    })
    await Promise.all([].concat.apply([], memTasks))
  } catch (e) { /* 团队关系清理失败不阻断整体删除 */ }

  var results = await Promise.all(tasks)

  // 4. 汇总结果
  var allOk = results.every(function (r) { return r.ok })
  var failures = results.filter(function (r) { return !r.ok })

  return {
    ok: allOk,
    allSettled: true,
    results: results,
    failedCount: failures.length,
    message: allOk ? '名片及关联数据已全部清理' : '部分清理完成（' + failures.length + ' 项失败）'
  }
}
