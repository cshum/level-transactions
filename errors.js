var createError = require('errno').create

var TimeoutError = createError('TimeoutError')
TimeoutError.prototype.timeout = true
TimeoutError.prototype.status = 408

var ReleasedError = createError('ReleasedError')
ReleasedError.prototype.released = true
ReleasedError.prototype.status = 408

exports.Timeout = TimeoutError
exports.Released = ReleasedError
