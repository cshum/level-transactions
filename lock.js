var xtend = require('xtend')
var sema = require('./sema')
var Err = require('./error')
var noop = function () {}

var defaults = {
  ttl: 20 * 1000
}

function Lock (shared, opts) {
  if (!(this instanceof Lock)) return new Lock(shared, opts)
  this.options = xtend(defaults, opts)

  this._shared = shared
  this._locked = {}
  this._released = false
  this._start = Date.now()
  this._ttl = this.options.ttl
  this._error = Err.RELEASED
  this._q = sema()

  var self = this
  this._timeout = setTimeout(function () {
    self._error = Err.TIMEOUT
    self.release()
  }, this._ttl)
}

Lock.prototype.acquire = function (key, cb) {
  cb = typeof cb === 'function' ? cb : noop

  if (!key) return cb(Err.INVALID_KEY)
  if (this._released) return cb(this._error)

  key = String(key)

  var self = this
  var mutex = this._shared[key] = this._shared[key] || sema()
  this._q.acquire(function () {
    if (self._released) return cb(self._error)
    if (self._locked[key]) {
      cb()
    } else {
      mutex.acquire(function () {
        if (self._released) {
          mutex.release()
          cb(self._error)
          return
        }
        self._locked[key] = true
        cb()
      })
    }
    if (!self._released) self._q.release()
  })
}

Lock.prototype.lock = Lock.prototype.acquire

Lock.prototype.extend = function (ttl, cb) {
  cb = typeof cb === 'function' ? cb : noop

  if (this._released) return cb(this._error)

  ttl = Number(ttl) || 0
  var self = this
  var elasped = Date.now() - this._start

  clearTimeout(this._timeout)

  this._timeout = setTimeout(function () {
    self._error = Err.TIMEOUT
    self.release()
  }, ttl + this._ttl - elasped)

  this._ttl += ttl

  cb()
}

Lock.prototype.release = function (cb) {
  cb = typeof cb === 'function' ? cb : noop

  if (this._released) return cb(this._error)

  this._released = true
  clearTimeout(this._timeout)

  for (var key in this._locked) {
    if (this._shared[key]) {
      this._shared[key].release()
      if (!this._shared[key].mode()) delete this._shared[key]
    }
  }

  delete this.options
  delete this._shared
  delete this._locked
  delete this._start
  delete this._ttl
  delete this._q

  cb()
}

Lock.creator = function (opts) {
  var shared = {}
  return function create (_opts) {
    return Lock(shared, xtend(opts, _opts))
  }
}

module.exports = Lock
