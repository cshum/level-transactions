function error(status, name, message){
  if(!(this instanceof error))
    return new error(status, name, message);

  Error.call(message);

  this.status = status;
  this.name = name;
  this.message = message;
  this[name] = true;
  this.error = true;
}

error.prototype = new Error();

error.prototype.toString = function(){
  return JSON.stringify({
    status: this.status,
    name: this.name,
    message: this.message
  });
};

error.TX_TIMEOUT = error(408, 'txTimeout', 'Transaction timeout.');
error.TX_RELEASED = error(408, 'txReleased', 'Transaction released.');

module.exports = error;
