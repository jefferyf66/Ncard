const cloud = require('wx-server-sdk')
cloud.init()

function extractCardInfo(text) {
  console.log('[parseCard] 开始解析名片文本:', text)
  
  const lines = text.split('\n').map(l => l.trim()).filter(l => l)
  const result = { name: '', position: '', company: '', phone: '', email: '', address: '' }
  
  const phoneRegex = /(?:(?:\+|00)86)?1[3-9]\d{9}/
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
  const positionKeywords = ['经理', '总监', '主管', '工程师', '顾问', '专员', '助理', 'CEO', 'CTO', 'COO', 'CFO']
  const companyKeywords = ['公司', '有限公司', '集团', '科技', '网络', '软件', 'Co.', 'Ltd.', 'Inc.', 'Corp.']

  for (const line of lines) {
    if (!result.phone) {
      const phoneMatch = line.match(phoneRegex)
      if (phoneMatch) {
        result.phone = phoneMatch[0]
        console.log('[parseCard] 匹配到电话:', result.phone)
      }
    }
    if (!result.email) {
      const emailMatch = line.match(emailRegex)
      if (emailMatch) {
        result.email = emailMatch[0]
        console.log('[parseCard] 匹配到邮箱:', result.email)
      }
    }
  }

  const nameCandidates = lines.filter(line => {
    if (phoneRegex.test(line) || emailRegex.test(line) || line.length > 20) return false
    return !positionKeywords.some(k => line.includes(k)) && !companyKeywords.some(k => line.includes(k))
  })
  if (nameCandidates.length > 0 && !result.name) {
    result.name = nameCandidates[0].replace(/[^\u4e00-\u9fa5a-zA-Z]/g, '')
    console.log('[parseCard] 匹配到姓名:', result.name)
  }

  for (const line of lines) {
    if (positionKeywords.some(k => line.includes(k)) && !result.position) {
      result.position = line.replace(/[^\u4e00-\u9fa5a-zA-Z\s]/g, '').trim()
      console.log('[parseCard] 匹配到职位:', result.position)
      break
    }
  }

  for (const line of lines) {
    if (companyKeywords.some(k => line.includes(k)) && !result.company) {
      result.company = line.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s公司集团科技网络软件]/g, '').trim()
      console.log('[parseCard] 匹配到公司:', result.company)
      break
    }
  }

  console.log('[parseCard] 名片信息解析完成:', JSON.stringify(result))
  return result
}

exports.main = async (event, context) => {
  console.log('[parseCard] 开始执行，event:', JSON.stringify(event))
  
  const { fileID } = event
  
  if (!fileID) {
    const errorResult = {
      success: false,
      error: '缺少图片fileID参数',
      errCode: 10001
    }
    console.error('[parseCard] 参数错误:', errorResult)
    return errorResult
  }

  try {
    const wxContext = cloud.getWXContext()
    console.log('[parseCard] 用户openid:', wxContext.OPENID)

    let ocrText = ''
    let ocrSource = 'fallback'

    try {
      console.log('[parseCard] 尝试调用名片OCR...')
      const cardResult = await cloud.openapi.ocr.businessCard({
        type: 'photo',
        img: { fileID }
      })
      console.log('[parseCard] 名片OCR成功:', JSON.stringify(cardResult))
      if (cardResult && cardResult.text) {
        ocrText = typeof cardResult.text === 'string' ? cardResult.text : JSON.stringify(cardResult.text)
        ocrSource = 'businessCard'
      }
    } catch (ocrErr) {
      console.warn('[parseCard] 名片OCR失败:', ocrErr)
    }

    if (!ocrText) {
      try {
        console.log('[parseCard] 尝试调用通用印刷体OCR...')
        const printResult = await cloud.openapi.ocr.printedText({
          type: 'photo',
          img: { fileID }
        })
        console.log('[parseCard] 通用印刷体OCR成功:', JSON.stringify(printResult))
        if (printResult && printResult.items) {
          ocrText = printResult.items.map(item => item.text).join('\n')
          ocrSource = 'printedText'
        }
      } catch (printErr) {
        console.warn('[parseCard] 通用印刷体OCR失败:', printErr)
      }
    }

    if (!ocrText) {
      console.error('[parseCard] 所有OCR方法均失败，无法识别名片内容')
      return {
        success: false,
        error: '名片识别失败，请确保图片清晰且包含名片信息',
        errCode: 10003
      }
    }

    console.log('[parseCard] OCR原始文本（', ocrSource, '）:', ocrText)

    const cardInfo = extractCardInfo(ocrText)

    try {
      const db = cloud.database()
      const scanRecord = {
        _openid: wxContext.OPENID,
        image: fileID,
        result: cardInfo,
        ocrSource: ocrSource,
        rawText: ocrText,
        createTime: new Date()
      }
      
      const dbResult = await db.collection('scans').add({ data: scanRecord })
      console.log('[parseCard] 保存识别记录成功，ID:', dbResult._id)
    } catch (dbErr) {
      console.error('[parseCard] 保存识别记录失败:', dbErr)
    }

    const successResult = {
      success: true,
      data: cardInfo,
      rawText: ocrText,
      ocrSource: ocrSource
    }
    console.log('[parseCard] 执行完成，返回:', JSON.stringify(successResult))
    return successResult

  } catch (err) {
    console.error('[parseCard] 执行异常:', err)
    const errorResult = {
      success: false,
      error: err.message || '名片解析失败',
      errCode: err.errCode || 10002
    }
    return errorResult
  }
}
