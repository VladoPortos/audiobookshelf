const express = require('express')
const Path = require('path')
const fs = require('fs-extra')
const Logger = require('./Logger')
const User = require('./objects/User')
const { isObject, isAcceptableCoverMimeType } = require('./utils/index')
const { CoverDestination } = require('./utils/constants')

class ApiController {
  constructor(MetadataPath, db, scanner, auth, streamManager, rssFeeds, downloadManager, emitter, clientEmitter) {
    this.db = db
    this.scanner = scanner
    this.auth = auth
    this.streamManager = streamManager
    this.rssFeeds = rssFeeds
    this.downloadManager = downloadManager
    this.emitter = emitter
    this.clientEmitter = clientEmitter
    this.MetadataPath = MetadataPath

    this.router = express()
    this.init()
  }

  init() {
    this.router.get('/find/covers', this.findCovers.bind(this))
    this.router.get('/find/:method', this.find.bind(this))

    this.router.get('/audiobooks', this.getAudiobooks.bind(this))
    this.router.delete('/audiobooks', this.deleteAllAudiobooks.bind(this))
    this.router.post('/audiobooks/delete', this.batchDeleteAudiobooks.bind(this))
    this.router.post('/audiobooks/update', this.batchUpdateAudiobooks.bind(this))

    this.router.get('/audiobook/:id', this.getAudiobook.bind(this))
    this.router.delete('/audiobook/:id', this.deleteAudiobook.bind(this))
    this.router.patch('/audiobook/:id/tracks', this.updateAudiobookTracks.bind(this))
    this.router.post('/audiobook/:id/cover', this.uploadAudiobookCover.bind(this))
    this.router.patch('/audiobook/:id', this.updateAudiobook.bind(this))

    this.router.get('/metadata/:id/:trackIndex', this.getMetadata.bind(this))
    this.router.patch('/match/:id', this.match.bind(this))

    this.router.delete('/user/audiobook/:id', this.resetUserAudiobookProgress.bind(this))
    this.router.patch('/user/audiobook/:id', this.updateUserAudiobookProgress.bind(this))
    this.router.patch('/user/audiobooks', this.batchUpdateUserAudiobooksProgress.bind(this))

    this.router.patch('/user/password', this.userChangePassword.bind(this))
    this.router.patch('/user/settings', this.userUpdateSettings.bind(this))
    this.router.get('/users', this.getUsers.bind(this))
    this.router.post('/user', this.createUser.bind(this))
    this.router.patch('/user/:id', this.updateUser.bind(this))
    this.router.delete('/user/:id', this.deleteUser.bind(this))

    this.router.patch('/serverSettings', this.updateServerSettings.bind(this))

    this.router.post('/authorize', this.authorize.bind(this))

    this.router.get('/genres', this.getGenres.bind(this))

    this.router.post('/feed', this.openRssFeed.bind(this))

    this.router.get('/download/:id', this.download.bind(this))
  }

  find(req, res) {
    this.scanner.find(req, res)
  }

  findCovers(req, res) {
    this.scanner.findCovers(req, res)
  }

  async getMetadata(req, res) {
    var metadata = await this.scanner.fetchMetadata(req.params.id, req.params.trackIndex)
    res.json(metadata)
  }

  authorize(req, res) {
    if (!req.user) {
      Logger.error('Invalid user in authorize')
      return res.sendStatus(401)
    }
    res.json({ user: req.user })
  }

  getAudiobooks(req, res) {
    var audiobooks = []
    if (req.query.q) {
      audiobooks = this.db.audiobooks.filter(ab => {
        return ab.isSearchMatch(req.query.q)
      }).map(ab => ab.toJSONMinified())
    } else {
      audiobooks = this.db.audiobooks.map(ab => ab.toJSONMinified())
    }
    res.json(audiobooks)
  }

  async deleteAllAudiobooks(req, res) {
    if (!req.user.isRoot) {
      Logger.warn('User other than root attempted to delete all audiobooks', req.user)
      return res.sendStatus(403)
    }
    Logger.info('Removing all Audiobooks')
    var success = await this.db.recreateAudiobookDb()
    if (success) res.sendStatus(200)
    else res.sendStatus(500)
  }

  getAudiobook(req, res) {
    var audiobook = this.db.audiobooks.find(a => a.id === req.params.id)
    if (!audiobook) return res.sendStatus(404)
    res.json(audiobook.toJSONExpanded())
  }

  async handleDeleteAudiobook(audiobook) {
    // Remove audiobook from users
    for (let i = 0; i < this.db.users.length; i++) {
      var user = this.db.users[i]
      var madeUpdates = user.deleteAudiobookProgress(audiobook.id)
      if (madeUpdates) {
        await this.db.updateEntity('user', user)
      }
    }

    // remove any streams open for this audiobook
    var streams = this.streamManager.streams.filter(stream => stream.audiobookId === audiobook.id)
    for (let i = 0; i < streams.length; i++) {
      var stream = streams[i]
      var client = stream.client
      await stream.close()
      if (client && client.user) {
        client.user.stream = null
        client.stream = null
        this.db.updateUserStream(client.user.id, null)
      }
    }

    var audiobookJSON = audiobook.toJSONMinified()
    await this.db.removeEntity('audiobook', audiobook.id)
    this.emitter('audiobook_removed', audiobookJSON)
  }

  async deleteAudiobook(req, res) {
    if (!req.user.canDelete) {
      Logger.warn('User attempted to delete without permission', req.user)
      return res.sendStatus(403)
    }
    var audiobook = this.db.audiobooks.find(a => a.id === req.params.id)
    if (!audiobook) return res.sendStatus(404)

    await this.handleDeleteAudiobook(audiobook)
    res.sendStatus(200)
  }

  async batchDeleteAudiobooks(req, res) {
    if (!req.user.canDelete) {
      Logger.warn('User attempted to delete without permission', req.user)
      return res.sendStatus(403)
    }
    var { audiobookIds } = req.body
    if (!audiobookIds || !audiobookIds.length) {
      return res.sendStatus(500)
    }

    var audiobooksToDelete = this.db.audiobooks.filter(ab => audiobookIds.includes(ab.id))
    if (!audiobooksToDelete.length) {
      return res.sendStatus(404)
    }
    for (let i = 0; i < audiobooksToDelete.length; i++) {
      Logger.info(`[ApiController] Deleting Audiobook "${audiobooksToDelete[i].title}"`)
      await this.handleDeleteAudiobook(audiobooksToDelete[i])
    }
    res.sendStatus(200)
  }

  async batchUpdateAudiobooks(req, res) {
    if (!req.user.canUpdate) {
      Logger.warn('User attempted to batch update without permission', req.user)
      return res.sendStatus(403)
    }
    var audiobooks = req.body
    if (!audiobooks || !audiobooks.length) {
      return res.sendStatus(500)
    }

    var audiobooksUpdated = 0
    audiobooks = audiobooks.map((ab) => {
      var _ab = this.db.audiobooks.find(__ab => __ab.id === ab.id)
      if (!_ab) return null
      var hasUpdated = _ab.update(ab)
      if (!hasUpdated) return null
      audiobooksUpdated++
      return _ab
    }).filter(ab => ab)

    if (audiobooksUpdated) {
      Logger.info(`[ApiController] ${audiobooksUpdated} Audiobooks have updates`)
      for (let i = 0; i < audiobooks.length; i++) {
        await this.db.updateAudiobook(audiobooks[i])
        this.emitter('audiobook_updated', audiobooks[i].toJSONMinified())
      }
    }

    res.json({
      success: true,
      updates: audiobooksUpdated
    })
  }

  async updateAudiobookTracks(req, res) {
    if (!req.user.canUpdate) {
      Logger.warn('User attempted to update audiotracks without permission', req.user)
      return res.sendStatus(403)
    }
    var audiobook = this.db.audiobooks.find(a => a.id === req.params.id)
    if (!audiobook) return res.sendStatus(404)
    var orderedFileData = req.body.orderedFileData
    Logger.info(`Updating audiobook tracks called ${audiobook.id}`)
    audiobook.updateAudioTracks(orderedFileData)
    await this.db.updateAudiobook(audiobook)
    this.emitter('audiobook_updated', audiobook.toJSONMinified())
    res.json(audiobook.toJSON())
  }

  async uploadAudiobookCover(req, res) {
    if (!req.user.canUpload || !req.user.canUpdate) {
      Logger.warn('User attempted to upload a cover without permission', req.user)
      return res.sendStatus(403)
    }
    if (!req.files || !req.files.cover) {
      return res.status(400).send('No files were uploaded')
    }
    var audiobookId = req.params.id
    var audiobook = this.db.audiobooks.find(ab => ab.id === audiobookId)
    if (!audiobook) {
      return res.status(404).send('Audiobook not found')
    }

    var coverFile = req.files.cover
    var mimeType = coverFile.mimetype
    var extname = Path.extname(coverFile.name.toLowerCase()) || '.jpg'
    if (!isAcceptableCoverMimeType(mimeType)) {
      return res.status(400).send('Invalid image file type: ' + mimeType)
    }

    var coverDestination = this.db.serverSettings ? this.db.serverSettings.coverDestination : CoverDestination.METADATA
    Logger.info(`[ApiController] Cover Upload destination ${coverDestination}`)

    var coverDirpath = audiobook.fullPath
    var coverRelDirpath = Path.join('/local', audiobook.path)
    if (coverDestination === CoverDestination.METADATA) {
      coverDirpath = Path.join(this.MetadataPath, 'books', audiobookId)
      coverRelDirpath = Path.join('/metadata', 'books', audiobookId)
      Logger.debug(`[ApiController] storing in metadata | ${coverDirpath}`)
      await fs.ensureDir(coverDirpath)
    } else {
      Logger.debug(`[ApiController] storing in audiobook | ${coverRelDirpath}`)
    }

    var coverFilename = `cover${extname}`
    var coverFullPath = Path.join(coverDirpath, coverFilename)
    var coverPath = Path.join(coverRelDirpath, coverFilename)

    // If current cover is a metadata cover and does not match replacement, then remove it
    var currentBookCover = audiobook.book.cover
    if (currentBookCover && currentBookCover.startsWith(Path.sep + 'metadata')) {
      Logger.debug(`Current Book Cover is metadata ${currentBookCover}`)
      if (currentBookCover !== coverPath) {
        Logger.info(`[ApiController] removing old metadata cover "${currentBookCover}"`)
        var oldFullBookCoverPath = Path.join(this.MetadataPath, currentBookCover.replace(Path.sep + 'metadata', ''))

        // Metadata path may have changed, check if exists first
        var exists = await fs.pathExists(oldFullBookCoverPath)
        if (exists) {
          try {
            await fs.remove(oldFullBookCoverPath)
          } catch (error) {
            Logger.error(`[ApiController] Failed to remove old metadata book cover ${oldFullBookCoverPath}`)
          }
        }
      }
    }

    var success = await coverFile.mv(coverFullPath).then(() => true).catch((error) => {
      Logger.error('Failed to move cover file', path, error)
      return false
    })

    if (!success) {
      return res.status(500).send('Failed to move cover into destination')
    }

    Logger.info(`[ApiController] Uploaded audiobook cover "${coverPath}" for "${audiobook.title}"`)

    audiobook.updateBookCover(coverPath)
    await this.db.updateAudiobook(audiobook)
    this.emitter('audiobook_updated', audiobook.toJSONMinified())
    res.json({
      success: true,
      cover: coverPath
    })
  }

  async updateAudiobook(req, res) {
    if (!req.user.canUpdate) {
      Logger.warn('User attempted to update without permission', req.user)
      return res.sendStatus(403)
    }
    var audiobook = this.db.audiobooks.find(a => a.id === req.params.id)
    if (!audiobook) return res.sendStatus(404)
    var hasUpdates = audiobook.update(req.body)
    if (hasUpdates) {
      await this.db.updateAudiobook(audiobook)
    }
    this.emitter('audiobook_updated', audiobook.toJSONMinified())
    res.json(audiobook.toJSON())
  }

  async match(req, res) {
    var body = req.body
    var audiobookId = req.params.id
    var audiobook = this.db.audiobooks.find(ab => ab.id === audiobookId)
    var bookData = {
      olid: body.id,
      publish_year: body.first_publish_year,
      description: body.description,
      title: body.title,
      author: body.author,
      cover: body.cover
    }
    audiobook.setBook(bookData)
    await this.db.updateAudiobook(audiobook)

    this.emitter('audiobook_updated', audiobook.toJSONMinified())

    res.sendStatus(200)
  }

  getUsers(req, res) {
    if (req.user.type !== 'root') return res.sendStatus(403)
    return res.json(this.db.users.map(u => u.toJSONForBrowser()))
  }

  async resetUserAudiobookProgress(req, res) {
    req.user.resetAudiobookProgress(req.params.id)
    await this.db.updateEntity('user', req.user)
    this.clientEmitter(req.user.id, 'user_updated', req.user.toJSONForBrowser())
    res.sendStatus(200)
  }

  async updateUserAudiobookProgress(req, res) {
    var wasUpdated = req.user.updateAudiobookProgress(req.params.id, req.body)
    if (wasUpdated) {
      await this.db.updateEntity('user', req.user)
      this.clientEmitter(req.user.id, 'user_updated', req.user.toJSONForBrowser())
    }
    res.sendStatus(200)
  }

  async batchUpdateUserAudiobooksProgress(req, res) {
    var abProgresses = req.body
    if (!abProgresses || !abProgresses.length) {
      return res.sendStatus(500)
    }

    var shouldUpdate = false
    abProgresses.forEach((progress) => {
      var wasUpdated = req.user.updateAudiobookProgress(progress.audiobookId, progress)
      if (wasUpdated) shouldUpdate = true
    })

    if (shouldUpdate) {
      await this.db.updateEntity('user', req.user)
      this.clientEmitter(req.user.id, 'user_updated', req.user.toJSONForBrowser())
    }

    res.sendStatus(200)
  }

  userChangePassword(req, res) {
    this.auth.userChangePassword(req, res)
  }

  async openRssFeed(req, res) {
    var audiobookId = req.body.audiobookId
    var audiobook = this.db.audiobooks.find(ab => ab.id === audiobookId)
    if (!audiobook) return res.sendStatus(404)
    var feed = await this.rssFeeds.openFeed(audiobook)
    console.log('Feed open', feed)
    res.json(feed)
  }

  async userUpdateSettings(req, res) {
    var settingsUpdate = req.body
    if (!settingsUpdate || !isObject(settingsUpdate)) {
      return res.sendStatus(500)
    }
    var madeUpdates = req.user.updateSettings(settingsUpdate)
    if (madeUpdates) {
      await this.db.updateEntity('user', req.user)
    }
    return res.json({
      success: true,
      settings: req.user.settings
    })
  }

  async createUser(req, res) {
    if (!req.user.isRoot) {
      Logger.warn('Non-root user attempted to create user', req.user)
      return res.sendStatus(403)
    }
    var account = req.body
    account.id = (Math.trunc(Math.random() * 1000) + Date.now()).toString(36)
    account.pash = await this.auth.hashPass(account.password)
    delete account.password
    account.token = await this.auth.generateAccessToken({ userId: account.id })
    account.createdAt = Date.now()
    var newUser = new User(account)
    var success = await this.db.insertUser(newUser)
    if (success) {
      this.clientEmitter(req.user.id, 'user_added', newUser)
      res.json({
        user: newUser.toJSONForBrowser()
      })
    } else {
      res.json({
        error: 'Failed to save new user'
      })
    }
  }

  async updateUser(req, res) {
    if (!req.user.isRoot) {
      Logger.error('User other than root attempting to update user', req.user)
      return res.sendStatus(403)
    }

    var user = this.db.users.find(u => u.id === req.params.id)
    if (!user) {
      return res.sendStatus(404)
    }

    var account = req.body
    // Updating password
    if (account.password) {
      account.pash = await this.auth.hashPass(account.password)
      delete account.password
    }

    var hasUpdated = user.update(account)
    if (hasUpdated) {
      await this.db.updateEntity('user', user)
    }

    this.clientEmitter(req.user.id, 'user_updated', user.toJSONForBrowser())
    res.json({
      success: true,
      user: user.toJSONForBrowser()
    })
  }

  async deleteUser(req, res) {
    if (!req.user.isRoot) {
      Logger.error('User other than root attempting to delete user', req.user)
      return res.sendStatus(403)
    }
    if (req.params.id === 'root') {
      return res.sendStatus(500)
    }
    if (req.user.id === req.params.id) {
      Logger.error('Attempting to delete themselves...')
      return res.sendStatus(500)
    }
    var user = this.db.users.find(u => u.id === req.params.id)
    if (!user) {
      Logger.error('User not found')
      return res.json({
        error: 'User not found'
      })
    }

    // Todo: check if user is logged in and cancel streams

    var userJson = user.toJSONForBrowser()
    await this.db.removeEntity('user', user.id)
    this.clientEmitter(req.user.id, 'user_removed', userJson)
    res.json({
      success: true
    })
  }

  async updateServerSettings(req, res) {
    if (!req.user.isRoot) {
      Logger.error('User other than root attempting to update server settings', req.user)
      return res.sendStatus(403)
    }
    var settingsUpdate = req.body
    if (!settingsUpdate || !isObject(settingsUpdate)) {
      return res.sendStatus(500)
    }
    var madeUpdates = this.db.serverSettings.update(settingsUpdate)
    if (madeUpdates) {
      await this.db.updateEntity('settings', this.db.serverSettings)
    }
    return res.json({
      success: true,
      serverSettings: this.db.serverSettings
    })
  }

  async download(req, res) {
    if (!req.user.canDownload) {
      Logger.error('User attempting to download without permission', req.user)
      return res.sendStatus(403)
    }
    var downloadId = req.params.id
    Logger.info('Download Request', downloadId)
    var download = this.downloadManager.getDownload(downloadId)
    if (!download) {
      Logger.error('Download request not found', downloadId)
      return res.sendStatus(404)
    }

    var options = {
      headers: {
        'Content-Type': download.mimeType
      }
    }
    res.download(download.fullPath, download.filename, options, (err) => {
      if (err) {
        Logger.error('Download Error', err)
      }
    })
  }

  getGenres(req, res) {
    res.json({
      genres: this.db.getGenres()
    })
  }
}
module.exports = ApiController