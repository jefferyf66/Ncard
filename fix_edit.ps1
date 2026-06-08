$filePath = "\\z4pro-rgh5\nvme12-185XXXX0907\文档同步\双向同步\#个人\我的代码\Ncard\miniprogram\pages\edit\index.js"
$content = Get-Content $filePath -Raw

# 修复 chooseAvatar 方法的缩进问题
$oldChooseAvatar = @"
chooseAvatar() {
    console.log('[Edit] chooseAvatar 瑙﹀彂')
    // 鍏堢'淇濋殣绉佹巿鏉冨凡閫氳繃锛屽啀鎵撳紑鍥剧墖閫夋嫨鍣?
  this._ensurePrivacyAuth(() => {
      this._openImagePicker()
    })
  },
"@

$newChooseAvatar = @"
chooseAvatar() {
    console.log('[Edit] chooseAvatar 触发')
    this._ensurePrivacyAuth(() => {
      this._openImagePicker()
    })
  },
"@

$content = $content.Replace($oldChooseAvatar, $newChooseAvatar)

# 修复 saveCard 方法中缺少的 const data = {
$oldSaveCard = @"
    this.setData({ isSaving: true })
    app.showLoading('淇濆瓨涓?..')

      name: this.data.name,
"@

$newSaveCard = @"
    this.setData({ isSaving: true })
    app.showLoading('淇濆瓨中...')

    const data = {
      name: this.data.name,
"@

$content = $content.Replace($oldSaveCard, $newSaveCard)

Set-Content -Path $filePath -Value $content -NoNewline
Write-Host "修复完成"
