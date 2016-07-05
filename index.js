var txdown = require('./txdown.js')
var xtend = require('xtend')
var inherits = require('util').inherits
var LevelUP = require('levelup')
var lockCreator = require('2pl').creator

function isLevelUP (db) {
  return db && (
    db.toString() === 'LevelUP' ||
    typeof db.sublevel === 'function'
  )
}
function isFunction (val) {
  return typeof val === 'function'
}

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

Transaction.prototype.commit = function (cb) {
  this.db.commit(cb)
}

Transaction.prototype.rollback = function (err, cb) {
  this.db.rollback(err, cb)
}
Transaction.prototype.defer = function (fn) {
  this.db._queue.defer(fn)
}

module.exports = Transaction
