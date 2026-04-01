var c=document.getElementById('c'),x=c.getContext('2d'),
W=400,H=300,pw=60,ph=8,px=170,py=280,
bx=200,by=200,bdx=2.5,bdy=-2.5,br=4,
sc=0,lv=3,run=0,cols=8,rows=4,bw=46,bh=12,bp=2,
bricks=[];
function init(){bricks=[];for(var r=0;r<rows;r++)for(var c2=0;c2<cols;c2++)bricks.push({x:c2*(bw+bp)+8,y:r*(bh+bp)+20,h:1,c:['#0f0','#4f8','#0af','#f4a'][r]});
bx=200;by=200;bdx=2.5*(Math.random()>.5?1:-1);bdy=-2.5;sc=0;lv=3;upHud();}
function upHud(){document.getElementById('score').textContent=sc;document.getElementById('lives').textContent=lv;}
c.addEventListener('mousemove',function(e){var r=c.getBoundingClientRect();px=e.clientX-r.left-pw/2;if(px<0)px=0;if(px>W-pw)px=W-pw;});
c.addEventListener('click',function(){if(!run){run=1;document.getElementById('msg').textContent='';loop();}});
function loop(){if(!run)return;x.clearRect(0,0,W,H);
x.fillStyle='#1a3';x.fillRect(px,py,pw,ph);
x.fillStyle='#fff';x.beginPath();x.arc(bx,by,br,0,Math.PI*2);x.fill();
for(var i=0;i<bricks.length;i++){var b=bricks[i];if(!b.h)continue;x.fillStyle=b.c;x.fillRect(b.x,b.y,bw,bh);
if(bx+br>b.x&&bx-br<b.x+bw&&by+br>b.y&&by-br<b.y+bh){b.h=0;bdy=-bdy;sc+=10;upHud();}}
bx+=bdx;by+=bdy;
if(bx<br||bx>W-br)bdx=-bdx;
if(by<br)bdy=-bdy;
if(by>py-br&&by<py+ph&&bx>px&&bx<px+pw){bdy=-Math.abs(bdy);bdx+=(bx-(px+pw/2))*0.05;}
if(by>H){lv--;upHud();if(lv<=0){run=0;document.getElementById('msg').textContent='Game Over! Score: '+sc+' - Click to retry';init();return;}
bx=200;by=200;bdx=2.5*(Math.random()>.5?1:-1);bdy=-2.5;}
if(bricks.every(function(b2){return!b2.h;})){run=0;document.getElementById('msg').textContent='You Win! Score: '+sc+' - Click to play again';init();return;}
requestAnimationFrame(loop);}
init();
