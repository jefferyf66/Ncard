const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event, context) => {
  console.log('[getOpenId] 开始执行，event:', JSON.stringify(event))
  
  const wxContext = cloud.getWXContext()
  console.log('[getOpenId] 获取到的 wxContext:', JSON.stringify({
    OPENID: wxContext.OPENID,
    APPID: wxContext.APPID,
    UNIONID: wxContext.UNIONID
  }))

  const result = {
    success: true,
    data: {
      openid: wxContext.OPENID,
      appid: wxContext.APPID,
      unionid: wxContext.UNIONID
    }
  }
  
  console.log('[getOpenId] 执行完成，返回:', JSON.stringify(result))
  return result
}
