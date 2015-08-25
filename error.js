function TXError (status, name, message) {
  if (!(this instanceof TXError)) {
    return new TXError(status, name, message)
  }

  Error.call(message)

  this.status = status
  this.name = name
  this.message = message
  this[name] = true
  this.error = true
}

TXError.prototype = new Error()

TXError.TX_TIMEOUT = TXError(408, 'txTimeout', 'Transaction timeout.')
TXError.TX_RELEASED = TXError(408, 'txReleased', 'Transaction released.')

module.exports = TXError
