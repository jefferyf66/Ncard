Page({
  data: {
    activeTab: 'privacy', // 'privacy' | 'service'
    privacyContent: '',
    serviceContent: ''
  },

  onLoad(options) {
    const tab = options?.tab || 'privacy'
    this.setData({ activeTab: tab })
    this.loadAgreementContent()
  },

  loadAgreementContent() {
    this.setData({
      privacyContent: this.getPrivacyContent(),
      serviceContent: this.getServiceContent()
    })
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab && tab !== this.data.activeTab) {
      this.setData({ activeTab: tab })
    }
  },

  getPrivacyContent() {
    return `<div style="padding:0 0 40rpx 0;line-height:1.8;font-size:28rpx;color:#334155;">
<h2 style="font-size:36rpx;color:#0F172A;font-weight:700;margin:40rpx 0 24rpx 0;">科博名片隐私政策</h2>
<p style="margin-bottom:16rpx;color:#64748B;">更新日期：2026年6月3日</p>
<p style="margin-bottom:16rpx;color:#64748B;">生效日期：2026年6月3日</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">引言</p>
<p style="margin-bottom:12rpx;">科博名片（以下简称"本小程序"）非常重视用户隐私保护。本隐私政策旨在向您说明我们如何收集、使用、存储和保护您的个人信息。请您在使用本小程序前仔细阅读本政策。</p>
<p style="margin-bottom:12rpx;">本小程序由【科博名片开发者团队】（以下简称"我们"）运营。如果您不同意本政策的任何内容，请立即停止使用本小程序。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">一、我们收集的信息</p>
<p style="font-weight:500;margin-bottom:8rpx;">1. 您主动提供的信息</p>
<p style="margin-bottom:8rpx;">当您使用本小程序创建和编辑名片时，我们收集您填写的信息，包括但不限于：</p>
<ul style="padding-left:40rpx;margin-bottom:16rpx;">
<li>姓名、职位、公司名称</li>
<li>手机号码</li>
<li>电子邮箱地址</li>
<li>通讯地址</li>
<li>个人介绍、业务介绍</li>
<li>工作经历信息</li>
<li>头像照片</li>
</ul>

<p style="font-weight:500;margin-bottom:8rpx;">2. 自动收集的信息</p>
<p style="margin-bottom:12rpx;">为保障小程序正常运行，我们可能会收集：</p>
<ul style="padding-left:40rpx;margin-bottom:16rpx;">
<li>设备型号、操作系统版本</li>
<li>微信开放标识（OpenID），用于区分用户身份</li>
</ul>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">二、信息收集的目的和使用方式</p>
<p style="margin-bottom:12rpx;">我们收集您的信息仅用于以下目的：</p>
<ul style="padding-left:40rpx;margin-bottom:16rpx;">
<li><b>名片管理：</b>创建、编辑、保存和展示您的电子名片，方便您与他人的商务社交</li>
<li><b>信息展示：</b>将您填写的名片信息展示给其他用户查看</li>
<li><b>通讯录保存：</b>在其他用户保存您的名片到手机通讯录时，提供必要的联系信息</li>
<li><b>访客统计：</b>记录名片被查看的次数和访客信息，帮助您了解名片的使用情况</li>
<li><b>服务优化：</b>分析使用情况以改进产品功能和用户体验</li>
</ul>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">三、手机号码的收集说明</p>
<p style="margin-bottom:12rpx;">手机号码是您在创建名片时<b>自愿填写</b>的信息，并非通过微信授权接口自动获取。收集和使用手机号码的目的为：</p>
<ul style="padding-left:40rpx;margin-bottom:16rpx;">
<li>展示在您的电子名片上，方便他人通过电话联系您</li>
<li>当其他用户选择保存名片到通讯录时，提供正确的联系电话</li>
</ul>
<p style="margin-bottom:12rpx;">您有权选择不填写手机号码，不填写不影响其他功能的使用。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">四、信息的存储</p>
<p style="margin-bottom:12rpx;">您的信息存储在腾讯微信云开发数据库中，存储期限为您使用本小程序期间。当您删除名片数据或注销账户后，相关个人信息将被及时删除或匿名化处理。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">五、信息的共享与披露</p>
<p style="margin-bottom:12rpx;">我们不会将您的个人信息出售或出租给任何第三方。仅在以下情况下可能共享：</p>
<ul style="padding-left:40rpx;margin-bottom:16rpx;">
<li>名片被其他用户查看时，名片上公开填写的信息会被展示</li>
<li>法律法规要求或政府主管部门要求</li>
<li>为维护社会公共利益</li>
</ul>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">六、信息的安全保护</p>
<p style="margin-bottom:12rpx;">我们采取合理的技术和管理措施保护您的信息安全，包括数据加密传输、访问权限控制等。但请理解，由于技术限制和网络环境，无法做到绝对安全。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">七、您的权利</p>
<p style="margin-bottom:12rpx;">您对您的个人信息享有以下权利：</p>
<ul style="padding-left:40rpx;margin-bottom:16rpx;">
<li><b>查看和修改：</b>您可以随时查看和修改您填写的信息</li>
<li><b>删除：</b>您可以删除已创建的名片信息</li>
<li><b>撤回同意：</b>您可以通过微信设置关闭相关权限授权</li>
</ul>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">八、未成年人保护</p>
<p style="margin-bottom:12rpx;">本小程序不面向未成年人提供服务。如果您是未满18周岁的未成年人，请在监护人的指导下使用，并在取得监护人同意后提供个人信息。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">九、隐私政策的更新</p>
<p style="margin-bottom:12rpx;">我们可能会不时更新本隐私政策。更新后的政策将在本小程序内公布。如政策变更对您的权利产生重大影响，我们将通过适当方式通知您。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">十、联系我们</p>
<p style="margin-bottom:12rpx;">如果您对本隐私政策有任何疑问或建议，请通过以下方式联系我们：</p>
<p style="margin-bottom:12rpx;">邮箱：jianf232323@163.com</p>
<p style="margin-bottom:24rpx;">感谢您使用科博名片！</p>
</div>`
  },

  getServiceContent() {
    return `<div style="padding:0 0 40rpx 0;line-height:1.8;font-size:28rpx;color:#334155;">
<h2 style="font-size:36rpx;color:#0F172A;font-weight:700;margin:40rpx 0 24rpx 0;">科博名片用户服务协议</h2>
<p style="margin-bottom:16rpx;color:#64748B;">更新日期：2026年6月3日</p>
<p style="margin-bottom:16rpx;color:#64748B;">生效日期：2026年6月3日</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">引言</p>
<p style="margin-bottom:12rpx;">欢迎使用科博名片小程序（以下简称"本服务"）。本协议是您与科博名片开发者团队之间关于使用本服务所订立的协议。请您仔细阅读本协议，在使用本服务前确保已充分理解并同意本协议的所有内容。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">一、服务内容</p>
<p style="margin-bottom:12rpx;">本服务为用户提供电子名片的创建、编辑、展示和管理功能，具体包括：</p>
<ul style="padding-left:40rpx;margin-bottom:16rpx;">
<li>创建和编辑个人电子名片</li>
<li>名片的预览和分享</li>
<li>查看名片访客记录</li>
<li>保存他人名片到手机通讯录</li>
</ul>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">二、用户注册与使用</p>
<p style="margin-bottom:12rpx;">1. 您使用本服务即表示您具备完全民事行为能力。</p>
<p style="margin-bottom:12rpx;">2. 您应确保所填写的信息真实、准确、完整，不得冒用他人身份或填写虚假信息。</p>
<p style="margin-bottom:12rpx;">3. 您的微信账号是使用本服务的唯一凭证，请妥善保管。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">三、用户行为规范</p>
<p style="margin-bottom:12rpx;">您在使用本服务时，应遵守以下规范：</p>
<ul style="padding-left:40rpx;margin-bottom:16rpx;">
<li>遵守中华人民共和国相关法律法规</li>
<li>不得利用本服务从事违法违规活动</li>
<li>不得侵犯他人的合法权益</li>
<li>不得填写含有违法违规、虚假欺诈、侮辱诽谤等内容</li>
<li>不得恶意干扰本服务的正常运行</li>
</ul>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">四、知识产权</p>
<p style="margin-bottom:12rpx;">本服务的所有内容，包括但不限于界面设计、图标、代码、文字等，均受知识产权法律保护。未经书面授权，不得复制、修改或传播。</p>
<p style="margin-bottom:12rpx;">您在本服务中创建的名片内容，其知识产权归您所有。您授权我们在提供名片展示功能时合理使用这些内容。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">五、免责声明</p>
<p style="margin-bottom:12rpx;">1. 本服务以"现状"提供，我们不对服务的及时性、安全性、准确性作任何保证。</p>
<p style="margin-bottom:12rpx;">2. 对于因不可抗力、系统故障、网络中断等原因导致的服务中断或数据丢失，我们不承担责任。</p>
<p style="margin-bottom:12rpx;">3. 您因使用本服务而产生的任何损失，在法律允许的最大范围内，我们的赔偿责任以您因使用本服务而向我们支付的费用（如有）为限。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">六、服务的变更和终止</p>
<p style="margin-bottom:12rpx;">1. 我们保留随时修改、暂停或终止本服务的权利。</p>
<p style="margin-bottom:12rpx;">2. 如本服务发生重大变更，我们将通过适当方式通知您。</p>
<p style="margin-bottom:12rpx;">3. 您可以随时停止使用本服务并删除您的数据。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">七、协议的修改</p>
<p style="margin-bottom:12rpx;">我们有权在必要时修改本协议内容。修改后的协议将在本小程序内公布。如您不同意修改后的内容，可以选择停止使用本服务；继续使用则视为同意修改后的协议。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">八、适用法律与争议解决</p>
<p style="margin-bottom:12rpx;">本协议适用中华人民共和国法律。如发生争议，双方应友好协商解决；协商不成的，任何一方可向有管辖权的人民法院提起诉讼。</p>

<p style="font-weight:600;margin:32rpx 0 16rpx 0;color:#0F172A;">九、联系方式</p>
<p style="margin-bottom:12rpx;">如您对本协议有任何疑问，请通过以下方式联系我们：</p>
<p style="margin-bottom:24rpx;">邮箱：jianf232323@163.com</p>
</div>`
  }
})
