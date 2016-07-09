var setImmediate = global.setImmediate || process.nextTick

function Sema () {
  if (!(this instanceof Sema)) return new Sema()
  this._waitlist = []
  this._mode = Sema.FREE
  this._count = 0
}

Sema.FREE = 0
Sema.SHARED = 1
Sema.EXCLUSIVE = 2
Sema.WAIT = 3

/**
 * Acquire lock
 *
 * @param {?number} mode - lock mode
 * @param {function} fn - callback function
 */
Sema.prototype.acquire = function (mode, fn) {
  if (typeof mode === 'function') {
    fn = mode
    mode = null
  }
  mode = mode || Sema.EXCLUSIVE // default exclusive mode
  var self = this

  function invoke () {
    self._mode = mode
    fn()
  }
  if (
    this._mode === Sema.FREE ||
    mode === Sema.SHARED && this._mode === Sema.SHARED
  ) {
    // semaphore free or shared only
    this._count++
    invoke()
  } else {
    // require wait
    this._mode = Sema.WAIT
    this._waitlist.push(invoke)
  }
}

/**
 * Release lock
 */
Sema.prototype.release = function () {
  if (this._count === 1 && this._waitlist.length > 0) {
    setImmediate(this._waitlist.shift())
  } else {
    if (this._count === 0) {
      throw new Error('Too many release')
    }
    this._count--
    if (this._count === 0) {
      this._mode = Sema.FREE
    }
  }
}

/**
 * Lock mode
 *
 * @returns {number} mode constant
 */
Sema.prototype.mode = function () {
  return this._mode
}

Sema.prototype.take = Sema.prototype.acquire
Sema.prototype.leave = Sema.prototype.release

module.exports = Sema

