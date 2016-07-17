var xtend = require('xtend')
var inherits = require('util').inherits
var queue = require('async-depth-first')
var abs = require('abstract-leveldown')
var streamIterate = require('stream-iterate')
var createRBT = require('functional-red-black-tree')

var END = '\uffff'
var BATCH_TTL = 20 * 1000

// ltgt.compare
function compare (a, b) {
  if (Buffer.isBuffer(a)) {
    var l = Math.min(a.length, b.length)
    for (var i = 0; i < l; i++) {
      var cmp = a[i] - b[i]
      if (cmp) return cmp
    }
    return a.length - b.length
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function concat (prefix, key) {
  if (typeof key === 'string') {
    return prefix + key
  }
  if (Buffer.isBuffer(key)) {
    return Buffer.concat([Buffer(prefix), key])
  }
  return prefix + String(key)
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
function noop () { return true }

function ltgtPrefix (prefix, options) {
  var x = xtend(options)
  var r = !!x.reverse
  var at = {}

  ;['lte', 'gte', 'lt', 'gt', 'start', 'end'].forEach(function (key) {
    at[key] = x[key]
    delete x[key]
  })
  delete x.limit // dont set limit on iterate stream

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

function treeIterate (tree, options) {
  var reverse = !!options.reverse
  var test = noop
  var next

  if (!reverse) {
    next = function () {
      tree.next()
    }
    if (options.gt) {
      tree = tree.gt(options.gt)
    } else if (options.gte) {
      tree = tree.ge(options.gte)
    } else {
      tree = tree.begin
    }
    if (options.lt) {
      test = function (key) {
        return compare(key, options.lt) < 0
      }
    } else if (options.lte) {
      test = function (key) {
        return compare(key, options.lte) <= 0
      }
    }
  } else {
    next = function () {
      tree.prev()
    }
    if (options.lt) {
      tree = tree.lt(options.lt)
    } else if (options.lte) {
      tree = tree.le(options.lte)
    } else {
      tree = tree.end
    }
    if (options.gt) {
      test = function (key) {
        return compare(key, options.gt) > 0
      }
    } else if (options.gte) {
      test = function (key) {
        return compare(key, options.gte) >= 0
      }
    }
  }

  return function (cb) {
    if (!tree.valid) return cb()
    var key = tree.key
    var value = tree.value
    if (!test(key)) return cb()

    cb(null, { key: key, value: value }, next)
  }
}

function TxIterator (db, tree, prefix, options) {
  abs.AbstractIterator.call(this)

  var opts = ltgtPrefix(prefix, encoding(options))

  // should emit key value object
  opts.keys = true
  opts.values = true

  this._opts = opts
  this.keyAsBuffer = options.keyAsBuffer !== false
  this.valueAsBuffer = options.valueAsBuffer !== false
  this._reverse = !!options.reverse
  this._stream = db.createReadStream(opts)
  this._streamIterate = streamIterate(this._stream)
  this._treeIterate = treeIterate(tree, opts)
  this._len = prefix.length
  this._count = 0
  this._limit = options.limit === -1 ? Infinity : options.limit
}

inherits(TxIterator, abs.AbstractIterator)

TxIterator.prototype._next = function (callback) {
  var self = this
  function toKey (data) {
    var key = data.key.slice(self._len)
    if (self.keyAsBuffer) key = new Buffer(key)
    return key
  }

  function toValue (data) {
    var value = data.value
    if (value === false) return false
    if (self.valueAsBuffer) value = new Buffer(value)
    return value
  }

  function cb (err, data) {
    if (err) return callback(err)
    if (!data) return callback()
    var key = toKey(data)
    var value = toValue(data)
    if (value === false) return loop() // skip if deleted
    self._count++
    callback(null, key, value)
  }

  function loop () {
    if (self._count >= self._limit) return cb()
    self._treeIterate(function (err, dataT, nextT) {
      if (err) return cb(err)
      self._streamIterate(function (err, dataS, nextS) {
        if (err) return cb(err)
        if (!dataT && !dataS) return cb()
        if (!dataT) {
          nextS()
          return cb(null, dataS)
        }
        if (!dataS) {
          nextT()
          return cb(null, dataT)
        }
        var comp = compare(toKey(dataT), toKey(dataS))
        if (comp === 0) {
          nextS()
          nextT()
          // both exists, tree override stream
          return cb(null, dataT)
        } else if ((comp < 0 && !self._reverse) || (comp > 0 && self._reverse)) {
          // tree less than stream, pick tree
          nextT()
          return cb(null, dataT)
        } else {
          // tree greater than stream, pick stream
          nextS()
          return cb(null, dataS)
        }
      })
    })
  }

  loop()
}

TxIterator.prototype._end = function (cb) {
  if (this._stream && this._stream.destroy) {
    this._stream.destroy()
    delete this._stream
    delete this._streamIterate
    delete this._treeIterate
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

  this._store = createRBT(compare)
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
      if (err) return done(err)
      fn(next)
    })
  })
}

TxDown.prototype._put = function (key, value, options, cb) {
  var self = this
  key = concat(this._getPrefix(options), key)

  if (value === null || value === undefined) {
    value = options.asBuffer ? Buffer(0) : ''
  }
  if (!options.asBuffer && typeof value !== 'string') {
    value = String(value)
  }
  this._keyLock(key, function (next) {
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

  this._keyLock(key, function (next) {
    var value = self._store.get(key)
    if (typeof value !== 'undefined') {
      if (value === false) {
        next(new Error('NotFound'))
      } else if (value === 'null' || value === 'undefined') {
        next(null, options.asBuffer ? Buffer(0) : '')
      } else if (options.asBuffer && !Buffer.isBuffer(value)) {
        next(null, new Buffer(value))
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

  this._keyLock(key, function (next) {
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
  var tree = this._store
  operations.forEach(function (o) {
    var key = concat(self._getPrefix(o), o.key)
    var isKeyBuf = Buffer.isBuffer(o.key)
    if (o.type === 'put') {
      var isValBuf = Buffer.isBuffer(o.value)
      var value = o.value
      if (value === null || value === undefined) {
        value = isValBuf ? Buffer(0) : ''
      }
      if (!isValBuf && typeof value !== 'string') value = String(value)
      self._keyLock(key, function (next) {
        self._writes.push({
          type: 'put',
          key: key,
          value: value,
          keyEncoding: isKeyBuf ? 'binary' : 'utf8',
          valueEncoding: isValBuf ? 'binary' : 'utf8'
        })
        var iter = tree.find(key)
        tree = iter.valid ? iter.update(value) : tree.insert(key, value)

        next()
      }, null, options.unsafe)
    } else if (o.type === 'del') {
      self._keyLock(key, function (next) {
        self._writes.push({
          type: 'del',
          key: key,
          keyEncoding: isKeyBuf ? 'binary' : 'utf8'
        })
        var iter = tree.find(key)
        tree = iter.valid ? iter.update(false) : tree.insert(key, false)

        next()
      }, null, options.unsafe)
    }
  })
  self._queue.defer(function (done) {
    self._store = tree
    cb()
    done()
  })
}

TxDown.prototype._iterator = function (options) {
  return new TxIterator(this.db, this._store, this._getPrefix(options), options)
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
  this._keyLock(key, function (next) {
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
