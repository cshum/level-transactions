function Queue(){
  if(!(this instanceof Queue))
    return new Queue();
  this._q = [[]];
}
var q = Queue.prototype;
q.defer = function(fn){
  this._q[this._q.length - 1].push(fn);
  return this;
};
q.start = function(fn, err){
  var self = this;
  var q = this._q[this._q.length - 1];
  //notFound err wont block queue
  if(q.length > 0 && !(err && !err.notFound)){
    this._q.push([]);
    q.shift()(function(err){
      if(err)
        return self.start(fn, err);
      setImmediate(function(){
        self.start(function(err){
          self._q.pop();
          self.start(fn, err);
        });
      });
    });
  }else{
    fn(err);
  }
  return;
};
module.exports = Queue;
