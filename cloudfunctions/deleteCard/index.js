// 云函数：级联删除名片（数据库 + 云存储）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
  if (card._openid && card._openid !== openid) {
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

  // 3. 并行执行所有清理操作（allSettled 避免单点失败阻塞）
  var tasks = []

  // 删除 cards 文档
  tasks.push(
    db.collection('cards').doc(cardId).remove()
      .then(function () { return { step: 'cards', ok: true } })
      .catch(function (e) { return { step: 'cards', ok: false, error: e.errCode } })
  )

  // 清理所有用户的保存记录
  tasks.push(
    db.collection('user_save_cards').where({ cardId: cardId }).remove()
      .then(function (res) { return { step: 'user_save_cards', ok: true, deleted: (res.stats && res.stats.removed) || 0 } })
      .catch(function (e) { return { step: 'user_save_cards', ok: false, error: e.errCode } })
  )

  // 清理访客记录
  tasks.push(
    db.collection('visits').where({ cardId: cardId }).remove()
      .then(function (res) { return { step: 'visits', ok: true, deleted: (res.stats && res.stats.removed) || 0 } })
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
