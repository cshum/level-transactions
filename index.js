var txdown = require('./txdown.js')
var xtend = require('xtend')
var inherits = require('util').inherits
var LevelUP = require('levelup')
var lockCreator = require('./lock').creator

function isLevelUP (db) {
  return db && (
    db.toString() === 'LevelUP' ||
    typeof db.sublevel === 'function'
  )
}
function isFunction (val) {
  return typeof val === 'function'
}

function noop () {}

// todo getCallback()
// todo getOptions()

function Transaction (db, options) {
  if (!isLevelUP(db)) {
    throw new Error('db must be a levelup instance')
  }
  if (!(this instanceof Transaction)) {
    return new Transaction(db, options)
  }

  options = xtend({
    ttl: 20 * 1000
  }, db.options, options)

  // get lock creator
  var createLock
  if (isFunction(options.createLock)) {
    // custom lock factory exists
    createLock = options.createLock
  } else if (isFunction(db.sublevel) && isFunction(db.levelup)) {
    // sublevelup, attach to its base levelup
    var levelup = db.levelup()
    createLock = levelup._createLock = levelup._createLock || lockCreator()
  } else {
    // db is levelup, attach to db
    createLock = db._createLock = db._createLock || lockCreator()
  }

  // init txdown
  if (db instanceof Transaction) {
    // db is Transaction, get its levelup
    this._levelup = db._levelup
    options.db = txdown(db._levelup, createLock(options))
  } else if (isFunction(db.sublevel) && isFunction(db.levelup)) {
    // db is sublevelup, get its levelup
    this._levelup = db.levelup()
    options.db = txdown(db.levelup(), createLock(options))
  } else {
    // db is LevelUP, wrap txdown
    this._levelup = db
    options.db = txdown(db, createLock(options))
  }

  var location = db.location
  // LevelUP.call(this, options.db(location), options)
  LevelUP.call(this, location, options)

  var self = this
  this.on('closed', function () {
    self.emit('end', self.db._error)
    self.emit('release', self.db._error)
  })
}

inherits(Transaction, LevelUP)

// override to bypass opening state and deferred
Transaction.prototype.open = function (cb) {
  var self = this
  function callback () {
    if (isFunction(cb)) {
      process.nextTick(function () { callback(null, self) })
    }
    return this
  }
  if (this.isOpen()) return callback()
  this.db = this.options.db(this.location)
  this._status = 'open'
  this.emit('open')
  this.emit('ready')
  return callback()
}

// override to bypass opening state and deferred
Transaction.prototype.close = function (cb) {
  var self = this
  if (this.isOpen()) {
    this._status = 'closing'
    this.db.close(function () {
      self._status = 'closed'
      self.emit('closed')
      if (cb) cb.apply(null, arguments)
    })
    this.emit('closing')
  } else if (this._status === 'closed' && cb) {
    return process.nextTick(cb)
  } else if (this._status === 'closing' && cb) {
    this.once('closed', cb)
  } else if (this._isOpening()) {
    this.once('open', function () {
      self.close(cb)
    })
  }
}

Transaction.prototype._getOptions = function (opts) {
  return xtend(
    this.options,
    opts && !isFunction(opts) ? opts : {}
  )
}

Transaction.prototype._getCallback = function () {
  if (isFunction(arguments[arguments.length - 1])) {
    return arguments[arguments.length - 1]
  }
  return noop
}

Transaction.prototype.commit = function (cb) {
  cb = this._getCallback(cb)
  var self = this
  var isClosed = this.isClosed()
  if (isClosed) return cb(this.db._error)

  var isCommitted = false
  this.once('closed', function () {
    if (!isCommitted) cb(self.db._error)
  })
  this.db._commit(function (err) {
    isCommitted = true
    self.close(function (errClose) {
      cb(err || errClose || null)
    })
  })
  return this
}

Transaction.prototype.rollback = function (err, cb) {
  var self = this
  err = err && !isFunction(err)
    ? err
    : new Error('Transaction Rollback')
  cb = this._getCallback(err, cb)
  this.db._rollback(err, function (err) {
    self.close(function (errClose) {
      cb(err || errClose || null)
    })
  })
  return this
}

Transaction.prototype.lock = function (key, options, cb) {
  this.db.lock(
    key,
    this._getOptions(options),
    this._getCallback(options, cb)
  )
  return this
}

Transaction.prototype.defer = function (fn) {
  this.db.defer(fn)
  return this
}

module.exports = Transaction
