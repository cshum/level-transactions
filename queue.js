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
  if(q.length > 0 && !err){
    //todo: prepare nested queue
    this._q.push([]);
    q.shift()(function(err){
      if(err)
        return self.start(fn, err);
      process.nextTick(function(){
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
