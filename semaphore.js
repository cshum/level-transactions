var setImmediate = global.setImmediate || process.nextTick

function Semaphore () {
  if (!(this instanceof Semaphore)) return new Semaphore()
  this._waitlist = []
  this._mode = Semaphore.FREE
  this._count = 0
}

Semaphore.FREE = 0
Semaphore.SHARED = 1
Semaphore.EXCLUSIVE = 2
Semaphore.WAIT = 3

/**
 * Acquire lock
 *
 * @param {?number} mode - lock mode
 * @param {function} fn - callback function
 */
Semaphore.prototype.acquire = function (mode, fn) {
  if (typeof mode === 'function') {
    fn = mode
    mode = null
  }
  mode = mode || Semaphore.EXCLUSIVE // default exclusive mode
  var self = this

  function invoke () {
    self._mode = mode
    fn()
  }
  if (
    this._mode === Semaphore.FREE ||
    mode === Semaphore.SHARED && this._mode === Semaphore.SHARED
  ) {
    // semaphore free or shared only
    this._count++
    invoke()
  } else {
    // require wait
    this._mode = Semaphore.WAIT
    this._waitlist.push(invoke)
  }
}

/**
 * Release lock
 */
Semaphore.prototype.release = function () {
  if (this._count === 1 && this._waitlist.length > 0) {
    setImmediate(this._waitlist.shift())
  } else {
    if (this._count === 0) {
      throw new Error('Too many release')
    }
    this._count--
    if (this._count === 0) {
      this._mode = Semaphore.FREE
    }
  }
}

/**
 * Lock mode
 *
 * @returns {number} mode constant
 */
Semaphore.prototype.mode = function () {
  return this._mode
}

Semaphore.prototype.take = Semaphore.prototype.acquire
Semaphore.prototype.leave = Semaphore.prototype.release

module.exports = Semaphore

