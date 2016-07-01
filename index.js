var txdown = require('./txdown.js')
var xtend = require('xtend')
var inherits = require('util').inherits
var LevelUP = require('levelup')

function isLevelUP (db) {
  return db && (
    db.toString() === 'LevelUP' ||
    typeof db.sublevel === 'function'
  )
}

function Transaction (db, options) {
  if (!db || typeof db === 'string') {
    throw new Error('Missing base.')
  }

  if (db instanceof Transaction && typeof name !== 'string') {
    if (name) {
      // passing sublevel with options
      // new instance, same prefix, extended options
      return new Transaction(db, null, name)
    } else if (!options) {
      // Passing sublevel return sublevel
      return db
    }
  }

  if (!(this instanceof Transaction)) {
    // reuse sublevel
    if (db._sublevels && db._sublevels[name]) {
      return db._sublevels[name]
    }
    return new Transaction(db, name, options)
  }

  if (typeof name !== 'string' && !options) {
    // sublevel(db, options)
    options = name
    name = null
  }

  var defaults = {}
  var override = {}

  if (db instanceof Transaction) {
    override.db = db.options.db
    override.prefixEncoding = db.options.prefixEncoding
    if (name) {
      // memorize child
      db._sublevels[name] = this
    }
  } else if (
    db.toString() === 'LevelUP' || // levelup instance
    typeof db.sublevel === 'function' // level-sublevel instance
  ) {
    // root is LevelUP, prefix based
    defaults.prefixEncoding = prefixCodec
    override.db = prefixdown(db)
  } else {
    // root is leveldown, table based
    defaults.prefixEncoding = tableCodec
    override.db = db
  }

  // sublevel children
  this._sublevels = {}

  options = xtend(defaults, db.options, options, override)
  var c = options.prefixEncoding
  var location
  if (name) {
    if (db instanceof Transaction) {
      // concat sublevel prefix location with name
      location = c.encode(c.decode(db.location).concat(name))
    } else {
      // levelup/down with name argument
      location = c.encode([name])
    }
  } else {
    if (db instanceof Transaction) {
      // retain sublevel prefix location
      location = db.location
    } else {
      // levelup/down without name argument
      location = c.encode([])
    }
  }
  // LevelUP.call(this, options.db(location), options)
  LevelUP.call(this, location, options)
}

inherits(Transaction, LevelUP)

Transaction.prototype.commit = function (cb) {
  // todo
}

Transaction.prototype.rollback = function (err, cb) {
  // todo
}

module.exports = Transaction
