/**
 * QA 临时单测脚本 —— Phase 1 团队租户 MVP 纯函数验证
 * 运行：node artifacts/qa-phase1-team-unit-test.js
 * 覆盖：normalizeName / sanitizeManagedFields / genShortId / genInviteCode / mergeCardWithTeam
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

// ---- 从 teamManager/index.js 抽取「工具函数」段（因 wx-server-sdk 未安装，不能直接 require）----
const src = fs.readFileSync(path.join(ROOT, 'cloudfunctions/teamManager/index.js'), 'utf8')
const MARK = '// ============ 工具函数 ============'
const idx = src.indexOf(MARK)
if (idx < 0) { console.error('FATAL: 未找到工具函数段落标记'); process.exit(1) }
const utilSrc = src.slice(idx)
const sandbox = {}
// eslint-disable-next-line no-new-func
new Function('exports', utilSrc + '\n;Object.assign(exports,{normalizeName,genShortId,genInviteCode,genToken,emptyFields,sanitizeManagedFields,escapeRegExp});')(sandbox)
const { normalizeName, genShortId, genInviteCode, genToken, emptyFields, sanitizeManagedFields } = sandbox

// ---- team.js 可直接 require（顶层无 wx/getApp 引用）----
const teamUtil = require(path.join(ROOT, 'miniprogram/utils/team.js'))
const { mergeCardWithTeam, errMsg } = teamUtil

let pass = 0, fail = 0
const failures = []
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('  PASS  ' + name) }
  else { fail++; failures.push(name + '\n        expected: ' + e + '\n        actual:   ' + a); console.log('  FAIL  ' + name + '  exp=' + e + ' act=' + a) }
}
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name) }
  else { fail++; failures.push(name + (detail ? '\n        ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  ' + detail : '')) }
}

// ==================== 1. normalizeName ====================
console.log('\n[1] normalizeName（D12c 归一化）')
eq(normalizeName('  科博名片  '), '科博名片', '去首尾空格')
eq(normalizeName('科博  名片'), '科博 名片', '折叠内部空格')
eq(normalizeName('ＡＢＣ１２３'), 'abc123', '全角字母数字转半角 + 小写')
eq(normalizeName('AbC Corp'), 'abc corp', 'toLowerCase')
// ↓↓ BUG-01 追踪：设计 §3.2 尾注要求「中文标点归一」，但实现把「全角转半角」放在前面，
//    导致 ，；：！？（） 先被转成半角 ,;:!?() 后再也匹配不到标点归一正则 → 该步对这些字符失效。
//    修复后此两条应转为 PASS。
eq(normalizeName('科博，名片'), '科博 名片', 'BUG-01 中文逗号归一为空格')
eq(normalizeName('科博（北京）'), '科博 北京', 'BUG-01 中文括号归一为空格')
// 仍生效的 CJK 标点（不在 U+FF01-FF5E 区间）作为对照组
eq(normalizeName('科博、名片'), '科博 名片', '对照：、(U+3001) 归一正常')
eq(normalizeName('科博【北京】'), '科博 北京', '对照：【】(U+3010/1) 归一正常')
eq(normalizeName('A-B_C'), 'a b c', '连字符/下划线归一')
eq(normalizeName(''), '', '空串')
eq(normalizeName(null), '', 'null 兜底')
eq(normalizeName(undefined), '', 'undefined 兜底')
// L1 等价性：同名不同写法应归一为同值
ok(normalizeName('科博 名片') === normalizeName('科博　名片'.replace('　', ' ')), 'L1 等价：半角空格')
ok(normalizeName('ABC Ltd') === normalizeName('  abc   ltd '), 'L1 等价：大小写+多空格')
// 已知边界：全角空格 U+3000 不在 ！-～ 区间
console.log('  INFO  全角空格 U+3000 归一结果: ' + JSON.stringify(normalizeName('科博\u3000名片')))

// ==================== 2. genShortId ====================
console.log('\n[2] genShortId（TB 前缀 + 无混淆字符）')
const ids = []
for (let i = 0; i < 5000; i++) ids.push(genShortId())
ok(ids.every(s => s.startsWith('TB')), 'TB 前缀 (5000/5000)')
ok(ids.every(s => s.length === 8), '长度 8 = TB + 6')
const badChar = ids.find(s => /[0O1I]/.test(s.slice(2)))
ok(!badChar, '无 0/O/1/I 混淆字符', badChar ? '出现: ' + badChar : '')
ok(ids.every(s => /^TB[A-Z2-9]{6}$/.test(s)), '字符集仅大写字母+2-9')
const uniq = new Set(ids).size
ok(uniq / ids.length > 0.99, '5000 次生成碰撞率 <1% (unique=' + uniq + ')')
console.log('  INFO  样例: ' + ids.slice(0, 5).join(', '))

// ==================== 3. genInviteCode / genToken ====================
console.log('\n[3] genInviteCode / genToken')
const codes = []
for (let i = 0; i < 5000; i++) codes.push(genInviteCode())
ok(codes.every(c => /^[A-Z2-9]{6}$/.test(c)), '邀请码 6 位易读字符集')
ok(codes.every(c => !/[0O1I]/.test(c)), '邀请码无 0/O/1/I')
console.log('  INFO  邀请码空间 32^6 = ' + Math.pow(32, 6).toLocaleString() + '，样例: ' + codes.slice(0, 5).join(', '))
const tk = genToken()
ok(/^[0-9a-f]{32}$/.test(tk), 'token 32 位 hex', 'got=' + tk)
ok(new Set([genToken(), genToken(), genToken(), genToken()]).size === 4, 'token 不重复')

// ==================== 4. emptyFields / sanitizeManagedFields ====================
console.log('\n[4] sanitizeManagedFields（仅放行 D2 七字段）')
const D2 = ['company', 'department', 'position', 'companyPhone', 'companyAddress', 'companyWebsite', 'workEmail']
eq(Object.keys(emptyFields()).sort(), D2.slice().sort(), 'emptyFields 恰好 7 个 D2 字段')
eq(Object.values(emptyFields()).every(v => v === ''), true, 'emptyFields 全为空串')

// 4.1 越权字段必须被丢弃（安全关键）
const evil = sanitizeManagedFields({
  company: '科博', name: '黑客改名', phone: '13800000000', wechat: 'evil',
  email: 'evil@x.com', address: '伪造地址', role: 'owner', _openid: 'fake',
  teamIds: ['x'], avatar: 'http://evil', __proto__: { polluted: 1 }
})
eq(Object.keys(evil).sort(), D2.slice().sort(), '安全：仅返回 7 个字段，越权字段全部丢弃')
ok(evil.name === undefined, '安全：name（个人字段）未被写入')
ok(evil.phone === undefined, '安全：phone（个人字段）未被写入')
ok(evil.role === undefined, '安全：role（提权字段）未被写入')
ok(evil._openid === undefined, '安全：_openid 未被写入')
eq(evil.company, '科博', '合法字段正常写入')

// 4.2 类型兜底
eq(sanitizeManagedFields(null), emptyFields(), 'null → emptyFields')
eq(sanitizeManagedFields(undefined), emptyFields(), 'undefined → emptyFields')
eq(sanitizeManagedFields('str'), emptyFields(), '字符串 → emptyFields')
eq(sanitizeManagedFields(123), emptyFields(), '数字 → emptyFields')
eq(sanitizeManagedFields([]).company, '', '数组 → 空串')
eq(sanitizeManagedFields({ company: '  科博  ' }).company, '科博', 'trim 生效')
eq(sanitizeManagedFields({ company: 123 }).company, '123', '数字转字符串')
eq(sanitizeManagedFields({ company: null }).company, '', 'null → 空串')
eq(sanitizeManagedFields({ company: { a: 1 } }).company, '[object Object]',
  '对象 → String() （已知弱点，见报告）')
eq(sanitizeManagedFields({ department: '研发' }).company, '', '未传字段被重置为空串（全量覆盖语义）')

// ==================== 5. mergeCardWithTeam ====================
console.log('\n[5] mergeCardWithTeam（override 合并 §8.5）')
const card = {
  name: '张三', phone: '13800001111', wechat: 'zhangsan',
  email: 'personal@me.com', address: '个人住址',
  company: '个人公司', department: '个人部门', position: '个人职位',
  companyPhone: '010-0000', companyAddress: '个人公司地址',
  companyWebsite: { url: 'https://me.com', title: '我的站' },
  workEmail: 'me@work.com'
}

// 5.1 个人字段永不被覆盖（D2 铁律）
const m1 = mergeCardWithTeam(card, {
  company: '科博', name: '李四', phone: '13900002222',
  wechat: 'lisi', email: 'evil@t.com', address: '团队地址'
})
eq(m1.name, '张三', '安全：姓名永不被团队覆盖')
eq(m1.phone, '13800001111', '安全：私人手机永不被覆盖')
eq(m1.wechat, 'zhangsan', '安全：微信永不被覆盖')
eq(m1.email, 'personal@me.com', '安全：私人邮箱永不被覆盖')
eq(m1.address, '个人住址', '安全：地址永不被覆盖')
eq(m1.company, '科博', '组织字段被非空托管值覆盖')

// 5.2 非空覆盖 / 空值不覆盖
const full = {
  company: 'T公司', department: 'T部门', position: 'T职位',
  companyPhone: '010-9999', companyAddress: 'T地址',
  companyWebsite: 'https://t.com', workEmail: 't@t.com'
}
const m2 = mergeCardWithTeam(card, full)
eq(m2.company, 'T公司', '覆盖 company')
eq(m2.department, 'T部门', '覆盖 department')
eq(m2.position, 'T职位', '覆盖 position')
eq(m2.companyPhone, '010-9999', '覆盖 companyPhone')
eq(m2.companyAddress, 'T地址', '覆盖 companyAddress')
eq(m2.workEmail, 't@t.com', '覆盖 workEmail')
eq(m2.companyWebsite, { url: 'https://t.com', title: '我的站' },
  'companyWebsite 覆盖 url 且保留原 title（结构兼容）')
eq(m2.teamManaged, true, 'teamManaged 标记为 true')

const m3 = mergeCardWithTeam(card, emptyFields())
eq(m3.company, '个人公司', '空值不覆盖 company')
eq(m3.department, '个人部门', '空值不覆盖 department')
eq(m3.position, '个人职位', '空值不覆盖 position')
eq(m3.companyPhone, '010-0000', '空值不覆盖 companyPhone')
eq(m3.companyAddress, '个人公司地址', '空值不覆盖 companyAddress')
eq(m3.companyWebsite, { url: 'https://me.com', title: '我的站' }, '空值不覆盖 companyWebsite')
eq(m3.workEmail, 'me@work.com', '空值不覆盖 workEmail')
eq(m3.teamManaged, false, '全空 → teamManaged=false')

// 5.3 部分覆盖
const m4 = mergeCardWithTeam(card, { company: '科博', position: '', department: '新部门' })
eq(m4.company, '科博', '部分覆盖：company 生效')
eq(m4.department, '新部门', '部分覆盖：department 生效')
eq(m4.position, '个人职位', '部分覆盖：position 空 → 保留个人值')
eq(m4.teamManaged, true, '部分覆盖 → teamManaged=true')

// 5.4 边界
eq(mergeCardWithTeam(null, null).teamManaged, false, 'null/null 不抛错')
eq(mergeCardWithTeam(undefined, undefined).teamManaged, false, 'undefined 不抛错')
eq(mergeCardWithTeam({}, { company: 'X' }).company, 'X', '空 card + 托管值')
ok(mergeCardWithTeam(card, full) !== card, '不修改原 card（返回新对象）')
eq(card.company, '个人公司', '原 card 未被污染')
// companyWebsite 原为字符串时的行为
const m5 = mergeCardWithTeam({ companyWebsite: 'https://old.com' }, { companyWebsite: 'https://new.com' })
eq(m5.companyWebsite, { url: 'https://new.com' }, 'card.companyWebsite 为字符串时被替换为对象')

// ==================== 6. 错误码中文映射完整性 ====================
console.log('\n[6] 错误码 → 中文映射（云函数返回码全覆盖）')
const cloudCodes = [...new Set((src.match(/error:\s*'([A-Z_]+)'/g) || [])
  .map(s => s.replace(/error:\s*'/, '').replace(/'$/, '')))]
const missing = cloudCodes.filter(c => !teamUtil.TEAM_ERROR_MESSAGES[c])
ok(missing.length === 0, '云函数所有 ' + cloudCodes.length + ' 个错误码均有中文映射',
  missing.length ? '缺失: ' + missing.join(', ') : '')
ok(errMsg('SOME_UNKNOWN_CODE') === '操作失败，请重试', '未知错误码有兜底文案')
ok(!/undefined|null/.test(errMsg('TEAM_LIMIT')), '不透传原始 error 给用户')
console.log('  INFO  云函数错误码: ' + cloudCodes.join(', '))

// ==================== 7. 源码契约静态检查（非纯函数逻辑的回归钩子）====================
console.log('\n[7] 源码契约静态检查')
const joinFn = src.slice(src.indexOf('async function joinByInvite'), src.indexOf('async function listMembers'))
ok(/inv\.maxUses/.test(joinFn), 'joinByInvite 校验 maxUses')
ok(/inv\.expiresAt/.test(joinFn), 'joinByInvite 校验 expiresAt（过期）')
ok(/ALREADY_MEMBER/.test(joinFn), 'joinByInvite 校验 ALREADY_MEMBER')
ok(/where\(\{\s*_openid:\s*OPENID\s*\}\)/.test(joinFn), '安全：joinByInvite 按 _openid 定位 card（防伪造 cardId）')
ok(!/event\.cardId|const\s*\{[^}]*cardId[^}]*\}\s*=\s*event/.test(joinFn), '安全：joinByInvite 不接受前端传入 cardId')
// BUG-02 追踪：createInvite 写入 singleUse，但 joinByInvite 从不校验 → 单次邀请码可无限使用
ok(/inv\.singleUse/.test(joinFn), 'BUG-02 joinByInvite 应校验 singleUse（当前缺失）')

const gct = src.slice(src.indexOf('async function getCardTeams'), src.indexOf('// ============ 工具函数'))
// BUG-03 追踪：getCardTeams 无鉴权（设计允许，preview 跨用户读），但不应外泄团队 owner 的原始 openid
ok(!/ownerOpenId/.test(gct), 'BUG-03 getCardTeams 不应返回 ownerOpenId（原始 openid 外泄，preview 未使用）')

// 全局安全铁律
// 注：必须先剥离注释再匹配，否则会误命中源码注释里的「绝不读 event.openid」说明文字（QA 自修：TEST-FIX-01）
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
  .replace(/^\s*\/\/.*$/gm, '')       // 整行行注释
  .replace(/\/\/[^\n'"]*$/gm, '')     // 行尾注释
ok(!/event\s*\.\s*(openid|openId|OPENID|_openid)/.test(codeOnly),
  '安全铁律：可执行代码中无 event.openid（注释已剥离）')
ok(/const \{ OPENID \} = cloud\.getWXContext\(\)/.test(src), '安全铁律：OPENID 来自 getWXContext()')
ok(src.indexOf('cloud.init(') < src.indexOf('cloud.database()'), '铁律：cloud.init 在 database 之前')
const writeActions = ['createTeam', 'createInvite', 'joinByInvite', 'revokeInvite', 'updateMemberFields', 'removeMember', 'leaveTeam']
const noOpenidArg = writeActions.filter(a => !new RegExp('case \'' + a + '\':[^\\n]*OPENID').test(src))
ok(noOpenidArg.length === 0, '所有 7 个写 action 均传入云端 OPENID',
  noOpenidArg.length ? '缺失: ' + noOpenidArg.join(', ') : '')

// ==================== 汇总 ====================
console.log('\n' + '='.repeat(64))
console.log('总计: ' + (pass + fail) + '  通过: ' + pass + '  失败: ' + fail +
  '  通过率: ' + (pass / (pass + fail) * 100).toFixed(1) + '%')
if (failures.length) {
  console.log('\n失败明细:')
  failures.forEach((f, i) => console.log('  ' + (i + 1) + ') ' + f))
}
console.log('='.repeat(64))
process.exit(fail ? 1 : 0)
