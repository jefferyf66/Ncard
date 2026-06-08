const app = getApp()

Page({
  data: {
    mode: "create",
    cardId: null,
    isLoading: false,
    avatarUrl: "",
    attachments: [],
    formData: {
      name: "",
      company: "",
      position: "",
      phone: "",
      email: "",
      address: "",
      website: "",
      wechat: "",
      intro: ""
    },
    errors: {}
  },

  onLoad(options) {
    console.log("[Edit] onLoad", options)
    if (options.id) {
      this.setData({ mode: "edit", cardId: options.id })
      wx.setNavigationBarTitle({ title: "编辑名片" })
      this.loadCard(options.id)
    } else {
      wx.setNavigationBarTitle({ title: "创建名片" })
    }
  },

  loadCard(id) {
    this.setData({ isLoading: true })
    wx.cloud.database().collection("cards").doc(id).get()
      .then(res => {
        const card = res.data
        if (card) {
          this.setData({
            formData: {
              name: card.name || "",
              company: card.company || "",
              position: card.position || "",
              phone: card.phone || "",
              email: card.email || "",
              address: card.address || "",
              website: card.website || "",
              wechat: card.wechat || "",
              intro: card.intro || ""
            },
            avatarUrl: card.avatarUrl || "",
            attachments: card.attachments || [],
            isLoading: false
          })
        }
      })
      .catch(err => {
        console.error("[Edit] load failed", err)
        this.setData({ isLoading: false })
        app.showError("Load failed, please retry")
      })
  },

  onNameInput(e) { this.setData({ "formData.name": e.detail.value }) },
  onCompanyInput(e) { this.setData({ "formData.company": e.detail.value }) },
  onPositionInput(e) { this.setData({ "formData.position": e.detail.value }) },
  onPhoneInput(e) { this.setData({ "formData.phone": e.detail.value }) },
  onEmailInput(e) { this.setData({ "formData.email": e.detail.value }) },
  onAddressInput(e) { this.setData({ "formData.address": e.detail.value }) },
  onWebsiteInput(e) { this.setData({ "formData.website": e.detail.value }) },
  onWechatInput(e) { this.setData({ "formData.wechat": e.detail.value }) },
  onIntroInput(e) { this.setData({ "formData.intro": e.detail.value }) },

  validate() {
    const { name, company, phone, email } = this.data.formData
    const errors = {}
    if (!name) errors.name = "Please input name"
    if (!company) errors.company = "Please input company"
    if (phone && !app.isValidPhone(phone)) errors.phone = "Invalid phone"
    if (email && !app.isValidEmail(email)) errors.email = "Invalid email"
    this.setData({ errors })
    return Object.keys(errors).length === 0
  },

  _openImagePicker() {
    wx.showActionSheet({
      itemList: ["Camera", "Album"],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ["camera"] : ["album"]
        wx.chooseImage({
          count: 1,
          sizeType: ["compressed"],
          sourceType,
          success: (res) => {
            const tempFilePath = res.tempFilePaths[0]
            if (!tempFilePath) return
            this.compressAndUpload(tempFilePath, "avatar")
          },
          fail: (err) => {
            const errMsg = err.errMsg || ""
            if (errMsg.indexOf("cancel") > -1) return
            app.showError("Operation failed")
          }
        })
      }
    })
  },

  compressAndUpload(filePath, type) {
    app.showLoading(type === "avatar" ? "Uploading avatar..." : "Uploading attachment...")
    wx.cloud.uploadFile({
      cloudPath: type + "/" + Date.now() + ".jpg",
      filePath,
      success: (res) => {
        const fileId = res.fileID
        console.log("[Edit] upload success", fileId)
        if (type === "avatar") {
          this.setData({ avatarUrl: fileId })
          app.showSuccess("Avatar uploaded")
        } else {
          const attachments = [...this.data.attachments, { url: fileId, name: "attachment" }]
          this.setData({ attachments })
          app.showSuccess("Attachment uploaded")
        }
      },
      fail: (err) => {
        console.error("[Edit] upload failed", err)
        app.showError("Upload failed")
      }
    })
  },

  addAttachment() {
    wx.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0]
        if (!tempFilePath) return
        this.compressAndUpload(tempFilePath, "attachment")
      },
      fail: (err) => {
        const errMsg = err.errMsg || ""
        if (errMsg.indexOf("cancel") > -1) return
        app.showError("Operation failed")
      }
    })
  },

  previewAttachment(e) {
    const index = e.currentTarget.dataset.index
    const url = this.data.attachments[index].url
    wx.previewImage({ urls: [url], current: url })
  },

  deleteAttachment(e) {
    const index = e.currentTarget.dataset.index
    wx.showModal({
      title: "Confirm",
      content: "Delete this attachment?",
      success: (res) => {
        if (res.confirm) {
          const attachments = this.data.attachments.filter((_, i) => i !== index)
          this.setData({ attachments })
        }
      }
    })
  },

  submit() {
    if (!this.validate()) return
    this.setData({ isLoading: true })
    const { formData, avatarUrl, attachments } = this.data
    const data = { ...formData, avatarUrl, attachments, updateTime: Date.now() }
    const db = wx.cloud.database()
    if (this.data.mode === "edit" && this.data.cardId) {
      db.collection("cards").doc(this.data.cardId).update({ data })
        .then(() => {
          this.setData({ isLoading: false })
          app.showSuccess("Card updated")
          app.setCache("lastCardUpdate", 0)
          setTimeout(() => wx.navigateBack(), 1500)
        })
        .catch(err => {
          console.error("[Edit] update failed", err)
          this.setData({ isLoading: false })
          app.showError("Save failed")
          setTimeout(() => wx.navigateBack(), 1500)
        })
    } else {
      data.createTime = Date.now()
      db.collection("cards").add({ data })
        .then(() => {
          this.setData({ isLoading: false })
          app.showSuccess("Card created")
          app.setCache("lastCardUpdate", 0)
          setTimeout(() => wx.navigateBack(), 1500)
        })
        .catch(err => {
          console.error("[Edit] create failed", err)
          this.setData({ isLoading: false })
          app.showError("Save failed")
          setTimeout(() => wx.navigateBack(), 1500)
        })
    }
  },

  delete() {
    wx.showModal({
      title: "Confirm",
      content: "Delete this card?",
      success: (res) => {
        if (res.confirm && this.data.cardId) {
          this.setData({ isLoading: true })
          wx.cloud.database().collection("cards").doc(this.data.cardId).remove()
            .then(() => {
              app.showSuccess("Card deleted")
              app.setCache("lastCardUpdate", 0)
              setTimeout(() => wx.navigateBack(), 1500)
            })
            .catch(err => {
              console.error("[Edit] delete failed", err)
              this.setData({ isLoading: false })
              app.showError("Delete failed")
            })
        }
      }
    })
  }
})
