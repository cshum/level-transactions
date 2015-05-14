var setImmediate = global.setImmediate || process.nextTick;

function Semaphpre(n){
  if(!(this instanceof Semaphpre))
    return new Semaphpre(n);
  this._q = [];
  this._taken = 0;
  this._n = n || 1;
}
var s = Semaphpre.prototype;
s.take = function(fn){
  if(this._taken < this._n){
    this._taken++;
    setImmediate(fn);
  }else
    this._q.push(fn);
  return this;
};
s.leave = function(){
  if(this._q.length > 0){
    setImmediate(this._q.shift());
  }else{
    if(this._taken === 0)
      throw new Error('leave called too many times.');
    this._taken--;
  }
  return this;
};
s.empty = function(){
  return this._taken === 0;
};

module.exports = Semaphpre;
