var test = require('tape')
var lock = require('../lock')
var createLock = lock.creator()

test('lock', function (t) {
  var l1 = createLock()
  var l2 = createLock()
  var seq = []
  l1.acquire(new Buffer('foo'), function (err) {
    t.error(err, 'l1 lock success')
    seq.push(0)
  })
  l1.acquire(function (err) {
    t.ok(err.INVALID_KEY, 'invalid key')
  })
  l1.acquire(new Buffer('foo'), function (err) {
    t.error(err, 'l1 double lock success')
    seq.push(1)
    l2.acquire('foo', function (err) {
      t.error(err, 'l2 lock success')
      seq.push(3)
      t.deepEqual(seq, [0, 1, 2, 3], 'seq correct')
      l2.release(function () {
        l2.extend(167, function (err) {
          t.ok(err.released, 'cannot extend after released')
          t.end()
        })
      })
    })
    setTimeout(function () {
      l1.release(function () {
        seq.push(2)
        l1.acquire('foo', function (err) {
          t.ok(err.released, 'cannot lock after released')
        })
      })
    }, 10)
  })
})

test('timeout and extend', function (t) {
  t.plan(4)
  var l1 = createLock({ ttl: 100 })
  var l2 = createLock({ ttl: 100 })

  setTimeout(function () {
    l1.acquire('foo', function (err) {
      t.ok(err.timeout, 'Lock timeout')
      l1.extend(167, function (err) {
        t.ok(err.timeout, 'Cannot extend after timeout')
      })
    })
    l2.acquire('bar', function (err) {
      t.error(err, 'No timeout after extend')
      l2.release()
    })
  }, 200)

  setTimeout(function () {
    l2.extend(200, function (err) {
      t.error(err, 'extend no err')
    })
  }, 50)
})

test('TTL', function (t) {
  t.plan(6)

  var l1 = createLock({ ttl: 500 })
  var l2 = createLock({ ttl: 500 })
  var l3 = createLock() // ttl default 20 seconds

  l1.acquire('a', function (err) {
    t.error(err)
    setTimeout(function () {
      l1.acquire('b', function (err) {
        t.ok(err.timeout, 'Lock 1 timeout')
      })
    }, 10)
  })

  l2.acquire('b', function (err) {
    t.error(err)
    setTimeout(function () {
      l2.acquire('a', function (err) {
        t.ok(err.timeout, 'Lock 2 timeout')
      })
    }, 10)
  })

  setTimeout(function () {
    l3.acquire('a', function (err) {
      t.notOk(err, 'l3 lock a success')
      l3.acquire('b', function (err) {
        t.notOk(err, 'l3 lock b success')
        l3.release()
      })
    })
  }, 100)
})

test('Parallel', function (t) {
  var n = 100
  var acc = 0
  var locked = false
  var ok = true
  function add () {
    var l = createLock()
    l.acquire('k', function (err) {
      ok &= !locked && !err
      locked = true
      var _acc = acc
      _acc++
      setTimeout(function () {
        acc = _acc
        l.release(function () {
          locked = false
          if (acc === n) {
            t.ok(ok, 'lock free and no error')
            t.end()
          }
        })
      }, 10)
    })
  }
  for (var i = 0; i < n; i++) add()
})
