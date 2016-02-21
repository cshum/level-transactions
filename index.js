var ginga = require('ginga')
var xtend = require('xtend')
var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter
var depthFirst = require('async-depth-first')
var levelErrors = require('level-errors')
var Codec = require('level-codec')
var lockCreator = require('2pl').creator

function Transaction (db, opts) {
  if (!(this instanceof Transaction)) return new Transaction(db, opts)
  this.db = db

  var createLock
  if (typeof db.options.createLock === 'function') {
    // custom lock factory exists
    createLock = db.options.createLock
  } else if (typeof db.sublevel === 'function' && db.options.db) {
    // all sublevels share same leveldown constructor
    createLock = db.options.db._createLock = db.options.db._createLock || lockCreator()
  } else {
    createLock = db._createLock = db._createLock || lockCreator()
  }

  this.options = xtend({
    ttl: 20 * 1000
  }, db.options, opts)

  this._lock = createLock(this.options)

  this._codec = new Codec(this.options)
  this._taken = {}
  this._map = {}
  this._notFound = {}
  this._batch = []

  this._async = depthFirst()
  this._error = null

  EventEmitter.call(this)
  this.setMaxListeners(Infinity)
}

inherits(Transaction, EventEmitter)

Transaction.fn = ginga(Transaction.prototype)

// ginga params middleware
function params () {
  var names = Array.prototype.slice.call(arguments)
  var len = names.length
  return function (ctx) {
    var l = Math.min(ctx.args.length, len)
    for (var i = 0; i < l; i++) ctx[names[i]] = ctx.args[i]
  }
}

function lock (ctx, next) {
  var self = this

  ctx.on('end', function (err) {
    // rollback on error except notFound
    if (err && !err.notFound) self.rollback(err)
  })

  // options object
  ctx.options = xtend(this.options, ctx.options)
  ctx.key = String(this._codec.encodeKey(ctx.key, ctx.options))

  // key + sublevel prefix hash
  if (ctx.options && ctx.options.prefix &&
    typeof ctx.options.prefix.sublevel === 'function') {
    ctx.db = ctx.options.prefix
    ctx.hash = ctx.db.location + '\x00' + ctx.key
  } else {
    ctx.db = this.db
    ctx.hash = (this.db.location || '') + '\x00' + ctx.key
  }

  this.defer(function (cb) {
    ctx.on('end', cb)

    // unsafe: skip locking
    if (ctx.options.unsafe === true) return next()

    if (self._taken[ctx.hash]) {
      next()
    } else {
      // gain mutually exclusive access to transaction
      self._lock.acquire(ctx.hash, function (err) {
        // dont callback if released
        if (err && err.RELEASED) return
        if (err) return next(err)
        self._taken[ctx.hash] = true
        next()
      })
    }
  })
}

function get (ctx, done) {
  var self = this

  if (this._notFound[ctx.hash]) {
    return done(new levelErrors.NotFoundError(
      'Key not found in transaction [' + ctx.key + ']'
    ))
  }
  if (ctx.hash in this._map) {
    return done(null, this._codec.decodeValue(
      this._map[ctx.hash], ctx.options
    ))
  }
  // patch keyEncoding
  ctx.options.keyEncoding = 'utf8'

  ctx.db.get(ctx.key, ctx.options, function (err, val) {
    if (err && err.notFound) {
      self._notFound[ctx.hash] = true
      delete self._map[ctx.hash]
    } else {
      self._map[ctx.hash] = self._codec.encodeValue(val, ctx.options)
    }
    done(err, val)
  })
}

function put (ctx, done) {
  ctx.value = this._codec.encodeValue(ctx.value, ctx.options)
  this._batch.push(xtend(ctx.options, {
    type: 'put',
    key: ctx.key,
    value: ctx.value,
    keyEncoding: 'utf8',
    valueEncoding: 'utf8'
  }))

  this._map[ctx.hash] = ctx.value
  delete this._notFound[ctx.hash]

  this.emit('put', ctx.key, ctx.value)

  done(null)
}

function del (ctx, done) {
  this._batch.push(xtend(ctx.options, {
    type: 'del',
    key: ctx.key,
    keyEncoding: 'utf8'
  }))

  delete this._map[ctx.hash]
  this._notFound[ctx.hash] = true

  this.emit('del', ctx.key)

  done(null)
}

function commit (ctx, next) {
  var self = this
  var ended = false
  ctx.on('end', function (err) {
    // rollback on error except notFound
    if (err) self.rollback(err)
  })
  this.on('end', function (err) {
    // ended before commit
    if (!ended) next(err)
  })
  this._async.done(function (err) {
    ended = true
    // todo lock extend
    if (err) return next(err)
    self._lock.extend(self.options.ttl, function (err) {
      if (err) return next(err)
      // attempt to extend lock to ensure validity
      self.db.batch(self._batch, function (err, res) {
        if (err) next(err)
        else next()
      })
    })
  })
}

function rollback (ctx) {
  this._error = ctx.error
}

// release after rollback or commit
function release (ctx, done) {
  var self = this
  ctx.on('end', function (err) {
    if (err) return
    self.emit('close', self._error)
    self.emit('release', self._error)
    self.emit('end', self._error)
  })

  this._lock.release(done)
}

Transaction.fn.defer = function (fn) {
  var self = this
  this._async.defer(function (cb) {
    fn(function (err) {
      // notFound error wont block async
      if (!err || err.notFound) return cb()
      self._error = err
      cb(err)
    })
  })
  return this
}

Transaction.fn.define('lock', params('key', 'options'), lock)
Transaction.fn.define('get', params('key', 'options'), lock, get)
Transaction.fn.define('put', params('key', 'value', 'options'), lock, put)
Transaction.fn.define('del', params('key', 'options'), lock, del)
Transaction.fn.define('rollback', params('error'), rollback, release)
Transaction.fn.define('commit', commit, release)

module.exports = Transaction
