var semaphore = require('./semaphore');

function Queue(){
  this._q = this._q || [semaphore(1)];
  this._error = null;
}

Queue.prototype.defer = function(fn){
  var self = this;
  var sema = this._q[this._q.length - 1];
  function callback(){
    self._q.pop();
    sema.leave();
  }
  sema.take(function(){
    if(self._error)
      return sema.leave();
    self._q.push(semaphore(1));
    fn(function(err){
      //notFound err wont block queue
      if(err && !err.notFound)
        self._error = err;
      var sema2 = self._q.pop();
      sema2.take(function(){
        sema2.leave();
        sema.leave();
      });
    });
  });
  return this;
};

Queue.prototype.done = function(fn, err){
  var self = this;
  var sema = this._q[0];
  sema.take(function(){
    self._q.pop();
    fn(self._error);
    sema.leave();
  });
  return this;
};

Queue.prototype.error = function(err){
  this._error = err;
  return this;
};

module.exports = Queue;
