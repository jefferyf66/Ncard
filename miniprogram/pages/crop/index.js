var app = getApp()

Page({
  data: {
    previewSrc: '',
    isLoading: true,
    moveX: 0,
    moveY: 0,
    currentScale: 1,
    minScale: 0.3,
    maxScale: 3,
    imgDisplayW: 300,
    imgDisplayH: 300,
    imgNaturalW: 0,
    imgNaturalH: 0,
    cropSize: 280,
    outputSize: 400
  },

  _realX: 0,
  _realY: 0,
  _realScale: 1,

  onLoad: function(options) {
    // 优先从 globalData 获取（绕过 URL 编码问题）
    var rawSrc = (app.globalData && app.globalData.cropImageSrc) || ''
    // 清理标记
    if (app.globalData) app.globalData.cropImageSrc = null
    // 兜底：从 URL 参数获取
    if (!rawSrc) {
      rawSrc = (options && options.src) || ''
    }

    if (!rawSrc) {
      app.showError('图片加载失败')
      setTimeout(function() { wx.navigateBack() }, 1200)
      return
    }

    this.setData({ previewSrc: rawSrc, isLoading: true })
  },

  // ===== 阶段 1：独立 <image> 加载成功，获取原始尺寸 =====
  onImageLoad: function(e) {
    var detail = e.detail || {}
    var imgW = detail.width || 0
    var imgH = detail.height || 0

    if (!imgW || !imgH) {
      this._failAndGoBack()
      return
    }

    var sysInfo = app.globalData.systemInfo || {}
    var screenWidth = sysInfo.screenWidth || 375

    // 裁切区为正方形，边长取屏幕宽度的 75%
    var cropSize = Math.floor(screenWidth * 0.75)
    var areaW = screenWidth
    var areaH = screenWidth

    // 约束图片显示尺寸上限（避免 movable-view 像素过大）
    var MAX_DISPLAY = 2000
    var displayW = imgW
    var displayH = imgH
    if (Math.max(displayW, displayH) > MAX_DISPLAY) {
      var ratio = MAX_DISPLAY / Math.max(displayW, displayH)
      displayW = Math.floor(displayW * ratio)
      displayH = Math.floor(displayH * ratio)
    }

    // 初始缩放：让图片短边刚好撑满裁切正方形
    var minDim = Math.min(displayW, displayH)
    var initialScale = minDim > 0 ? cropSize / minDim : 1

    // 初始偏移：居中
    var scaledW = displayW * initialScale
    var scaledH = displayH * initialScale
    var centerX = (areaW - scaledW) / 2
    var centerY = (areaH - scaledH) / 2

    // 最小缩放：让长边缩至裁切区大小
    var minScaleVal = cropSize / Math.max(displayW, displayH) * 0.4
    if (minScaleVal < 0.3) minScaleVal = 0.3

    this.setData({
      isLoading: false,
      imgNaturalW: displayW,
      imgNaturalH: displayH,
      imgDisplayW: displayW,
      imgDisplayH: displayH,
      cropSize: cropSize,
      outputSize: cropSize,
      currentScale: initialScale,
      moveX: centerX,
      moveY: centerY,
      minScale: minScaleVal,
      maxScale: 3
    })

    this._realX = centerX
    this._realY = centerY
    this._realScale = initialScale
  },

  onImageError: function() {
    this._failAndGoBack()
  },

  _failAndGoBack: function() {
    app.showError('图片加载失败')
    setTimeout(function() { wx.navigateBack() }, 1200)
  },

  // ===== 阶段 2：裁切交互 =====
  // 关键：不调用 setData 更新 x/y/scale-value
  // 一旦 setData 更新这些值，movable-view 变成受控组件，
  // 手势 → setData → 重渲染 → 再触发 bindscale → 反馈环路 → 图片回弹
  onScale: function(e) {
    var detail = e.detail
    this._realX = detail.x
    this._realY = detail.y
    this._realScale = detail.scale
  },

  onMove: function(e) {
    // bindchange 不含 scale 字段 — 只更新位置，不碰缩放值
    var detail = e.detail
    this._realX = detail.x
    this._realY = detail.y
  },

  onCancel: function() {
    wx.navigateBack()
  },

  onConfirm: function() {
    var data = this.data

    if (!data.previewSrc || !data.imgNaturalW || !data.imgNaturalH) {
      app.showError('图片数据异常')
      return
    }

    app.showLoading('处理中...')

    var sysInfo = app.globalData.systemInfo || {}
    var screenWidth = sysInfo.screenWidth || 375
    var cropSize = data.cropSize
    var currentScale = this._realScale || data.currentScale

    // 裁切正方形在 canvas 区域坐标中的位置
    var maskLeft = (screenWidth - cropSize) / 2
    var maskTop = (screenWidth - cropSize) / 2

    // 转换为原始图像坐标
    var srcX = (maskLeft - this._realX) / currentScale
    var srcY = (maskTop - this._realY) / currentScale
    var srcW = cropSize / currentScale
    var srcH = cropSize / currentScale

    var outputSize = data.outputSize

    this._doSquareCrop(srcX, srcY, srcW, srcH, outputSize)
  },

  // ===== Canvas 正方形裁切 =====
  _doSquareCrop: function(sx, sy, sw, sh, outputSize) {
    var self = this
    var src = self.data.previewSrc
    var imgNaturalW = self.data.imgNaturalW
    var imgNaturalH = self.data.imgNaturalH

    var query = wx.createSelectorQuery()
    query.select('#cropCanvas')
      .fields({ node: true, size: true })
      .exec(function(res) {
        if (!res || !res[0] || !res[0].node) {
          app.hideLoading()
          self._returnResult(src)
          return
        }

        var canvas = res[0].node
        var ctx = canvas.getContext('2d')
        var dpr = wx.getSystemInfoSync().pixelRatio

        canvas.width = outputSize * dpr
        canvas.height = outputSize * dpr
        ctx.scale(dpr, dpr)

        var img = canvas.createImage()
        img.src = src
        img.onload = function() {
          ctx.clearRect(0, 0, outputSize, outputSize)

          // 正方形裁切（无圆角，与名片头像一致）
          ctx.save()
          ctx.beginPath()
          ctx.rect(0, 0, outputSize, outputSize)
          ctx.clip()

          var scale = outputSize / sw
          var drawX = -sx * scale
          var drawY = -sy * scale
          var drawW = imgNaturalW * scale
          var drawH = imgNaturalH * scale

          ctx.drawImage(img, drawX, drawY, drawW, drawH)
          ctx.restore()

          wx.canvasToTempFilePath({
            canvas: canvas,
            x: 0,
            y: 0,
            width: outputSize,
            height: outputSize,
            destWidth: outputSize,
            destHeight: outputSize,
            success: function(canvasRes) {
              app.hideLoading()
              self._returnResult(canvasRes.tempFilePath)
            },
            fail: function() {
              app.hideLoading()
              self._returnResult(src)
            }
          })
        }
        img.onerror = function() {
          app.hideLoading()
          self._returnResult(src)
        }
      })
  },

  _returnResult: function(tempFilePath) {
    var pages = getCurrentPages()
    var prevPage = pages[pages.length - 2]
    if (prevPage && typeof prevPage.onCropResult === 'function') {
      prevPage.onCropResult(tempFilePath)
    }
    wx.navigateBack()
  }
})
