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
  if (typeof options.createLock === 'function') {
    // custom lock factory exists
    createLock = options.createLock
  } else if (typeof db.sublevel === 'function' && db.options.db) {
    // all sublevels share same leveldown constructor
    createLock = db.options.db._createLock = db.options.db._createLock || lockCreator()
  } else {
    // create and attach lock at levelup
    createLock = db._createLock = db._createLock || lockCreator()
  }

  // init txdown
  if (db instanceof Transaction) {
    // db is Transaction, get its levelup
    options.db = txdown(db.options.db.db, createLock(options))
  } else {
    // db is LevelUP, wrap txdown
    options.db = txdown(db, createLock(options))
  }

  var location = db.location
  // LevelUP.call(this, options.db(location), options)
  LevelUP.call(this, location, options)
}

inherits(Transaction, LevelUP)

Transaction.prototype.commit = function (cb) {
  this.db.commit(cb)
}

Transaction.prototype.rollback = function (err, cb) {
  this.db.rollback(err, cb)
}
Transaction.prototype.defer = function (cb) {
  this.db._queue.defer(cb)
}

module.exports = Transaction
