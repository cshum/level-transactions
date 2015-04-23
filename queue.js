function defer(fn){
  this._q = this._q || [[]];
  this._q[this._q.length - 1].push(fn);
  return this;
}
function start(fn, err){
  this._q = this._q || [[]];
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
  return this;
}

function Queue(q){
  if(!(this instanceof Queue))
    return new Queue(q);
  q = q || {};

  q.defer = defer;
  q.start = start;

  return q;
}
module.exports = Queue;
