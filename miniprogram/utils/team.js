/**
 * utils/team.js —— 团队云函数调用封装 + 错误码中文映射 + override 合并
 *
 * 约定（见设计 §8）：
 *  - callTeamManager 统一封装 wx.cloud.callFunction（name='teamManager'）
 *  - 错误码 → 中文 toast（不把原始 error 透传用户）
 *  - 客户端 _openid 仅 UI 分支判断；写授权只信云端 OPENID
 *  - mergeCardWithTeam：个人 card 真相源 + team_members.managedFields 覆盖层合并
 */

// 错误码 → 中文提示
const TEAM_ERROR_MESSAGES = {
  NAME_REQUIRED: '请输入团队名称',
  TEAM_LIMIT: '团队数量已达上限（最多 5 个）',
  OWN_DUP_NAME: '你已创建过同名团队',
  GEN_SHORT_ID_FAIL: '创建失败，请重试',
  GEN_CODE_FAIL: '创建邀请失败，请重试',
  TEAM_NOT_FOUND: '团队不存在或已解散',
  NO_PERMISSION: '无权执行此操作',
  INVITE_DISABLED: '该团队已关闭邀请',
  INVITE_NOT_FOUND: '邀请码无效',
  INVITE_EXPIRED: '邀请码已过期',
  INVITE_USED_UP: '邀请码已使用完毕',
  ALREADY_MEMBER: '你已是该团队成员',
  NO_CARD: '请先创建个人名片',
  NOT_MEMBER: '你还不是该团队成员',
  MEMBER_NOT_FOUND: '成员不存在',
  CANNOT_REMOVE_OWNER: '不能移除团队创始人',
  NOT_OWNER: '仅团队创始人可解散团队',
  OWNER_CANNOT_LEAVE: '创始人不能退出，请先转让或解散',
  KEYWORD_REQUIRED: '请输入搜索关键词',
  CARD_NOT_FOUND: '名片不存在',
  UNKNOWN_ACTION: '未知操作',
  CLOUD_CALL_FAIL: '网络异常，请稍后重试'
}

/**
 * 统一调用 teamManager 云函数
 * @param {string} action - 小驼峰 action 名
 * @param {Object} data - 业务参数（不含 action）
 * @returns {Promise<{success:boolean, data?:any, error?:string}>}
 */
function callTeamManager(action, data) {
  return new Promise((resolve) => {
    if (!wx.cloud) {
      resolve({ success: false, error: 'CLOUD_CALL_FAIL' })
      return
    }
    wx.cloud.callFunction({
      name: 'teamManager',
      data: Object.assign({ action: action }, data || {}),
      success: (res) => {
        resolve(res.result || { success: false, error: 'CLOUD_CALL_FAIL' })
      },
      fail: () => {
        resolve({ success: false, error: 'CLOUD_CALL_FAIL' })
      }
    })
  })
}

/**
 * 错误码 → 中文文案
 */
function errMsg(code) {
  return TEAM_ERROR_MESSAGES[code] || '操作失败，请重试'
}

/**
 * 错误码 → 中文 toast
 */
function showTeamError(code) {
  const app = getApp()
  if (app && app.showError) {
    app.showError(errMsg(code))
  } else {
    wx.showToast({ title: errMsg(code), icon: 'none' })
  }
}

/**
 * override 合并：个人 card 真相源 + 托管组织字段覆盖层
 * 规则（见设计 §8.5）：
 *  - managedFields 中非空字段覆盖 card 同名字段；空值不覆盖
 *  - 个人字段（姓名/私人手机/微信/邮箱/地址）永不被团队覆盖
 * @param {Object} card - 个人名片（真相源）
 * @param {Object} managedFields - team_members.managedFields（D2 七个组织字段）
 * @returns {Object} 合并后的「团队名片视图」对象
 */
function mergeCardWithTeam(card, managedFields) {
  card = card || {}
  const mf = managedFields || {}
  const merged = Object.assign({}, card)

  // 仅当托管字段非空才覆盖同名组织字段（空值不覆盖，个人字段不在 managedFields 中自然不被覆盖，见设计 §8.5）
  if (mf.company) merged.company = mf.company
  if (mf.department) merged.department = mf.department
  if (mf.position) merged.position = mf.position
  if (mf.companyPhone) merged.companyPhone = mf.companyPhone
  if (mf.companyAddress) merged.companyAddress = mf.companyAddress
  if (mf.workEmail) merged.workEmail = mf.workEmail
  if (mf.companyWebsite) {
    const base = (typeof merged.companyWebsite === 'object' && merged.companyWebsite) || {}
    merged.companyWebsite = Object.assign({}, base, { url: mf.companyWebsite })
  }

  merged.teamManaged = !!(
    mf.company || mf.department || mf.position ||
    mf.companyPhone || mf.companyAddress || mf.companyWebsite || mf.workEmail
  )
  return merged
}

module.exports = {
  callTeamManager,
  errMsg,
  showTeamError,
  mergeCardWithTeam,
  TEAM_ERROR_MESSAGES
}
