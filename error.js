function Err (code, name, message) {
  if (!(this instanceof Err)) return new Err(code, name, message)

  Error.call(message)

  this.code = code
  this.name = name
  this.message = message
  this[name] = true
  this.error = true
}

Err.prototype = new Error()

Err.TIMEOUT = Err(408, 'TIMEOUT', 'Lock timeout.')
Err.RELEASED = Err(408, 'RELEASED', 'Lock released.')
Err.INVALID_KEY = Err(400, 'INVALID_KEY', 'Key must be a string or buffer.')

module.exports = Err
