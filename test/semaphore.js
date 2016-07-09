var test = require('tape')
var sema = require('../semaphore')

test('exclusive lock', function (t) {
  var lock = sema()
  var num = 5
  var start = 0
  var curr = 0

  while (start++ < num) {
    lock.acquire(start === num - 1 ? sema.SHARED : sema.EXCLUSIVE, function () {
      curr++
      if (curr === num - 1) t.equal(lock.mode(), sema.SHARED, 'shared mode after acquired at num - 1')
      else t.equal(lock.mode(), sema.EXCLUSIVE, 'exclusive mode after acquired')
      setTimeout(function () {
        lock.release()
        if (curr === num) {
          t.equal(lock.mode(), sema.FREE, 'free after all released')
          t.throws(function () {
            t.release()
          }, 'Too many release')
          t.end()
        }
      })
    })
    if (start > 1) t.equal(lock.mode(), sema.WAIT, 'wait mode before acquired')
    else t.equal(lock.mode(), sema.EXCLUSIVE, 'exclusive right after if no wait')
  }
})

test('shared-exclusive lock', function (t) {
  var lock = sema()
  var num = 5
  var start = 0
  var curr = 0
  var unlocked = 0

  while (start++ < num) {
    lock.acquire(sema.SHARED, function () {
      curr++
      t.equal(lock.mode(), sema.SHARED, 'shared mode after acquired')
      if (curr === num) {
        lock.acquire(function () { // defaults to exclusive mode
          t.equal(unlocked, num, 'exclusive unlock last')
          t.equal(lock.mode(), sema.EXCLUSIVE, 'exclusive acquired after all share mode released')
          t.throws(function () {
            t.release()
          }, 'Too many release')
          t.end()
        })
        t.equal(lock.mode(), sema.WAIT, 'wait mode before exclusive acquired')
        for (var i = 0; i < num; i++) {
          setTimeout(function () {
            lock.release()
            unlocked++
          }, i * 10)
        }
      }
    })
    // if (start >= num) t.equal(lock.mode(), sema.WAIT, 'wait mode before shared-exclusive acquired')
    if (start < num) t.equal(lock.mode(), sema.SHARED, 'shared mode acquired without wait')
  }
})
