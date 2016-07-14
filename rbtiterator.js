/*
var ltgt = require('ltgt')

module.exports = function (tree, options) {
  var limit = options.limit
  if (limit === -1) limit = Infinity

  var keyAsBuffer = options.keyAsBuffer !== false
  var valueAsBuffer = options.valueAsBuffer !== false
  var reverse = options.reverse
  var done = 0
  var incr, start, end, test

  function gt(value) {
    return ltgt.compare(value, end) > 0
  }
  function gte(value) {
    return ltgt.compare(value, end) >= 0
  }
  function lt(value) {
    return ltgt.compare(value, end) < 0
  }
  function lte(value) {
    return ltgt.compare(value, end) <= 0
  }

  if (!reverse) {
    incr = 'next'
    start = ltgt.lowerBound(options)
    end = ltgt.upperBound(options)

    if (typeof start === 'undefined') {
      tree = tree.begin
    } else if (ltgt.lowerBoundInclusive(options)) {
      tree = tree.ge(start)
    } else {
      tree = tree.gt(start)
    }
    if (end) {
      if (ltgt.upperBoundInclusive(options)) {
        test = lte
      } else {
        test = lt
      }
    }

  } else {
    incr = 'prev'
    start = ltgt.upperBound(options)
    end = ltgt.lowerBound(options)

    if (typeof start === 'undefined') {
      tree = tree.end
    } else if (ltgt.upperBoundInclusive(options)) {
      tree = tree.le(start)
    } else {
      tree = tree.lt(start)
    }
    if (end) {
      if (ltgt.lowerBoundInclusive(options)) {
        test = gte
      } else {
        test = gt
      }
    }
  }

  return function loop (fn) {
  }
}
*/
