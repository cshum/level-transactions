var xtend = require('xtend')
var inherits = require('util').inherits
var queue = require('async-depth-first')
var abs = require('abstract-leveldown')
var iterate = require('stream-iterate')
var createRBT = require('functional-red-black-tree')
var ltgt = require('ltgt')

var END = '\uffff'
var BATCH_TTL = 20 * 1000

function concat (prefix, key) {
  if (typeof key === 'string') {
    return prefix + key
  }
  if (Buffer.isBuffer(key)) {
    return Buffer.concat([Buffer(prefix), key])
  }
  return prefix + String(key)
}

function mapkey (key) {
  return '!' + (key || '').toString()
}

function encoding (o) {
  return xtend(o, {
    keyEncoding: o.keyAsBuffer ? 'binary' : 'utf8',
    valueEncoding: (o.asBuffer || o.valueAsBuffer) ? 'binary' : 'utf8'
  })
}

function isNotFoundError (err) {
  return err && ((/notfound/i).test(err) || err.notFound)
}

function ltgtOptions (prefix, x) {
  var r = !!x.reverse
  var at = {}

  ;['lte', 'gte', 'lt', 'gt', 'start', 'end'].forEach(function (key) {
    at[key] = x[key]
    delete x[key]
  })

  if (at.gte) x.gte = concat(prefix, at.gte)
  else if (at.gt) x.gt = concat(prefix, at.gt)
  else if (at.start && !r) x.gte = concat(prefix, at.start)
  else if (at.end && r) x.gte = concat(prefix, at.end)
  else x.gte = at.keyAsBuffer ? Buffer(prefix) : prefix

  if (at.lte) x.lte = concat(prefix, at.lte)
  else if (at.lt) x.lt = concat(prefix, at.lt)
  else if (at.end && !r) x.lte = concat(prefix, at.end)
  else if (at.start && r) x.lte = concat(prefix, at.start)
  else x.lte = concat(prefix, at.keyAsBuffer ? Buffer(END) : END)

  return x
}

function TxIterator (db, prefix, options) {
  abs.AbstractIterator.call(this)

  var opts = ltgtOptions(prefix, encoding(options))

  // should emit key value object
  opts.keys = true
  opts.values = true

  this._opts = opts
  this._stream = db.createReadStream(opts)
  this._iterate = iterate(this._stream)
  this._len = prefix.length
}

inherits(TxIterator, abs.AbstractIterator)

TxIterator.prototype._next = function (cb) {
  var self = this
  this._iterate(function (err, data, next) {
    if (err) return cb(err)
    if (!data) return cb()
    next()
    var key = data.key.slice(self._len)
    var value = data.value
    if (typeof key === 'string' && self._opts.keyAsBuffer) {
      key = new Buffer(key)
    }
    if (typeof key === 'string' && self._opts.valueAsBuffer) {
      value = new Buffer(value)
    }
    cb(err, key, value)
  })
}

TxIterator.prototype._end = function (cb) {
  if (this._stream && this._stream.destroy) {
    this._stream.destroy()
    delete this._stream
    delete this._iterate
  }
  process.nextTick(cb)
}

function isLevelUP (db) {
  return db && (
    db.toString() === 'LevelUP' ||
    typeof db.sublevel === 'function'
  )
}

function TxDown (db, createLock, location) {
  if (!isLevelUP(db)) {
    throw new Error('db must be a levelup instance')
  }
  if (arguments.length < 3) {
    // LeveUP defined factory
    return function (location) {
      return new TxDown(db, createLock, location)
    }
  }
  if (!(this instanceof TxDown)) {
    return new TxDown(db, createLock, location)
  }

  this.db = db

  this._store = createRBT(ltgt.compare)
  this._writes = []
  this._createLock = createLock

  this._queue = queue()
  this._error = null

  abs.AbstractLevelDOWN.call(this, location)
}

inherits(TxDown, abs.AbstractLevelDOWN)

TxDown.prototype._open = function (options, callback) {
  this._lock = this._lock || this._createLock(options)
  process.nextTick(callback)
}

TxDown.prototype._getPrefix = function (options) {
  // handle prefix options
  if (options && options.prefix) {
    var prefix = options.prefix
    // no prefix for root db
    if (prefix === this.db) return ''
    // string prefix
    if (typeof prefix === 'string') return prefix
    // levelup of prefixdown prefix
    if (isLevelUP(prefix)) {
      // levelup v2
      // if (prefix._db instanceof TxDown) return prefix._db.location
      // levelup v1
      if (prefix.options && prefix.options.db) return prefix.location
    }
  }
  return this.location
}

TxDown.prototype._keyLock = function (key, fn, cb, unsafe) {
  var self = this
  this._queue.defer(function (done) {
    function next (err) {
      if (err && !isNotFoundError(err)) {
        self._error = err
        // error breaks queue except notFoud err
        if (cb) cb(err)
        done(err)
      } else {
        if (cb) cb.apply(self, arguments)
        done()
      }
    }
    if (unsafe) return fn(next)
    self._lock.acquire(key, function (err) {
      if (err && err.released) return
      if (err) return done(err)
      fn(next)
    })
  })
}

TxDown.prototype._put = function (key, value, options, cb) {
  var self = this
  key = concat(this._getPrefix(options), key)
  var mapped = mapkey(key)

  if (value === null || value === undefined) {
    value = options.asBuffer ? Buffer(0) : ''
  }

  this._keyLock(mapped, function (next) {
    self._writes.push(xtend({
      type: 'put',
      key: key,
      value: value
    }, encoding(options)))

    var iter = self._store.find(key)
    self._store = iter.valid ? iter.update(value) : self._store.insert(key, value)

    next()
  }, cb, options.unsafe)
}

TxDown.prototype._get = function (key, options, cb) {
  var self = this
  key = concat(this._getPrefix(options), key)
  var mapped = mapkey(key)

  this._keyLock(mapped, function (next) {
    var value = self._store.get(key)
    if (value !== undefined) {
      if (value === false) {
        next(new Error('NotFound'))
      } else if (value === 'null' || value === 'undefined') {
        next(null, options.asBuffer ? Buffer(0) : '')
      } else if (options.asBuffer && !Buffer.isBuffer(value)) {
        next(null, new Buffer(value))
      } else if (!options.asBuffer && Buffer.isBuffer(value)) {
        next(null, String(value))
      } else {
        next(null, value)
      }
    } else {
      self.db.get(key, encoding(options), function (err, value) {
        if (err && err.notFound) {
          self._store = self._store.insert(key, false)
        } else if (!err) {
          self._store = self._store.insert(key, value)
        }
        next.apply(self, arguments)
      })
    }
  }, cb, options.unsafe)
}

TxDown.prototype._del = function (key, options, cb) {
  var self = this
  key = concat(this._getPrefix(options), key)
  var mapped = mapkey(key)

  this._keyLock(mapped, function (next) {
    self._writes.push(xtend({
      type: 'del',
      key: key
    }, encoding(options)))

    var iter = self._store.find(key)
    self._store = iter.valid ? iter.update(false) : self._store.insert(key, false)

    next()
  }, cb, options.unsafe)
}

TxDown.prototype._batch = function (operations, options, cb) {
  if (arguments.length === 0) {
    return new abs.AbstractChainedBatch(this)
  }
  if (!Array.isArray(operations)) {
    return this.db.batch.apply(null, arguments)
  }
  var self = this
  operations.forEach(function (o) {
    var key = concat(self._getPrefix(o), o.key)
    var mapped = mapkey(key)
    var isKeyBuf = Buffer.isBuffer(o.key)
    if (o.type === 'put') {
      var isValBuf = Buffer.isBuffer(o.value)
      var value = o.value
      if (value === null || value === undefined) {
        value = isValBuf ? Buffer(0) : ''
      }
      self._keyLock(mapped, function (next) {
        self._writes.push({
          type: 'put',
          key: key,
          value: value,
          keyEncoding: isKeyBuf ? 'binary' : 'utf8',
          valueEncoding: isValBuf ? 'binary' : 'utf8'
        })
        var iter = self._store.find(key)
        self._store = iter.valid ? iter.update(value) : self._store.insert(key, value)

        next()
      }, null, options.unsafe)
    } else if (o.type === 'del') {
      self._keyLock(mapped, function (next) {
        self._writes.push({
          type: 'del',
          key: key,
          keyEncoding: isKeyBuf ? 'binary' : 'utf8'
        })
        var iter = self._store.find(key)
        self._store = iter.valid ? iter.update(false) : self._store.insert(key, false)

        next()
      }, null, options.unsafe)
    }
  })
  self._queue.defer(function (done) {
    cb()
    done()
  })
}

TxDown.prototype._iterator = function (options) {
  return new TxIterator(this.db, this._getPrefix(options), options)
}

TxDown.prototype._isBuffer = function (obj) {
  return Buffer.isBuffer(obj)
}

TxDown.prototype.defer = function (fn) {
  var self = this
  this._queue.defer(function (cb) {
    fn(function (err) {
      // notFound error wont block async
      if (!err || isNotFoundError(err)) return cb()
      self._error = err
      cb(err)
    })
  })
  return this
}

TxDown.prototype.lock = function (key, options, cb) {
  key = concat(this._getPrefix(options), key)
  var mapped = mapkey(key)
  this._keyLock(mapped, function (next) {
    next()
  })
}

TxDown.prototype._close = function (cb) {
  this._lock.release(cb)
}

TxDown.prototype._commit = function (cb) {
  var self = this
  this._queue.done(function (err) {
    if (err) return cb(err)
    self._lock.extend(BATCH_TTL, function (err) {
      if (err) return cb(err)
      self.db.batch(self._writes, cb)
    })
  })
}

TxDown.prototype._rollback = function (err, cb) {
  if (err) this._error = err
  process.nextTick(cb)
}

module.exports = TxDown
