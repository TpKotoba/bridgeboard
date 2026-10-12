import { BridgeEvent, Projection, ResultInput, Standing, Vulnerability, resultKey } from './model';
const thresholds=[20,50,90,130,170,220,270,320,370,430,500,600,750,900,1100,1300,1500,1750,2000,2250,2500,3000,3500,4000];
export function imps(difference:number) { return Math.sign(difference)*thresholds.filter(t=>Math.abs(difference)>=t).length; }
export function contractScore(r:ResultInput,vulnerability:Vulnerability):number {
  if(r.level===0) return 0;
  const ns=r.declarer==='N'||r.declarer==='S';
  const vul=vulnerability==='All'||vulnerability===(ns?'NS':'EW');
  const over=r.tricks-r.level-6;
  let score:number;
  if(over<0) {
    const down=-over;
    let penalty=down*(vul?100:50);
    if(r.doubled>1) penalty=(vul?200+Math.max(0,down-1)*300:100+Math.min(2,down-1)*200+Math.max(0,down-3)*300)*(r.doubled/2);
    score=-penalty;
  } else {
    const minor=r.strain==='C'||r.strain==='D';
    const trickPoints=(r.level*(minor?20:30)+(r.strain==='NT'?10:0))*r.doubled;
    score=trickPoints+(trickPoints>=100?(vul?500:300):50);
    score+=r.doubled===1?over*(minor?20:30):over*(vul?200:100)*(r.doubled/2);
    if(r.doubled>1) score+=50*(r.doubled/2);
    if(r.level===6) score+=vul?750:500;
    if(r.level===7) score+=vul?1500:1000;
  }
  return score*(ns?1:-1);
}
const vpTables=new Map<number,number[]>();
// WBF continuous 20–0 scale, including the official 0.01 concavity correction.
// https://www.worldbridge.org/wp-content/uploads/2019/06/VP-Scale-Functiondetails.pdf
export function vp(margin:number,boards:number):number {
  if(boards<1) throw new Error('牌數必須大於零');
  if(!vpTables.has(boards)) {
    const tau=(Math.sqrt(5)-1)/2, blitz=15*Math.sqrt(boards);
    const table=Array.from({length:Math.ceil(blitz)+2},(_,i)=>Math.round(Math.min(20,10+10*(1-tau**(3*i/blitz))/(1-tau**3))*100));
    for(let pass=0;pass<100;pass++) {
      let changed=false;
      for(let i=1;i<table.length-1;i++) if(table[i+1]-table[i]>table[i]-table[i-1]) {table[i]++;changed=true;}
      if(!changed) break;
    }
    vpTables.set(boards,table);
  }
  const table=vpTables.get(boards)!;
  const win=table[Math.min(Math.abs(margin),table.length-1)]/100;
  return margin>=0?win:Math.round((20-win)*100)/100;
}
export function project(e:BridgeEvent):Projection {
  const standing:Standing[]=e.participants.map(p=>({...p,rank:0,score:e.kind==='teams'?0:null,secondary:0,played:0,total:0}));
  const byId=Object.fromEntries(standing.map(s=>[s.id,s]));
  const projection:Projection={standings:standing,matches:[],pairScores:{},received:Object.keys(e.results).length,expected:e.assignments.reduce((n,a)=>n+a.boards.length,0)};
  for(const a of e.assignments) for(const id of [a.ns,a.ew]) byId[id].total+=a.boards.length;
  if(e.kind==='teams') {
    for(const open of e.assignments.filter(a=>a.room==='open')) {
      const closed=e.assignments.find(a=>a.matchId===open.matchId&&a.room==='closed');
      if(!closed) continue;
      const match={id:open.matchId,round:open.round,a:open.ns,b:open.ew,impsA:0,impsB:0,completed:0,total:open.boards.length,vpA:null as number|null,vpB:null as number|null};
      for(const board of open.boards) {
        const x=e.results[resultKey(open.id,board)],y=e.results[resultKey(closed.id,board)];
        if(!x||!y) continue;
        const imp=imps(x.nsScore+y.nsScore);
        match.impsA+=Math.max(0,imp);match.impsB+=Math.max(0,-imp);match.completed++;
      }
      for(const id of [match.a,match.b]) byId[id].played+=match.completed;
      if(match.completed===match.total) {
        match.vpA=vp(match.impsA-match.impsB,match.total);match.vpB=vp(match.impsB-match.impsA,match.total);
        byId[match.a].score!+=match.vpA; byId[match.b].score!+=match.vpB;
        byId[match.a].secondary+=match.impsA-match.impsB;byId[match.b].secondary+=match.impsB-match.impsA;
      }
      projection.matches.push(match);
    }
    for(const row of standing) row.total/=2;
  } else {
    const totals:Record<string,{mp:number;top:number}> = Object.fromEntries(standing.map(s=>[s.id,{mp:0,top:0}]));
    for(const board of e.boards) {
      const assignments=e.assignments.filter(a=>a.boards.includes(board.number));
      const entries=assignments.map(a=>({a,r:e.results[resultKey(a.id,board.number)]})).filter(x=>x.r);
      const top=2*(entries.length-1);
      for(const {a,r} of entries) {
        byId[a.ns].played++;byId[a.ew].played++;
        const ns=top<=0?null:entries.reduce((mp,x)=>mp+(r.nsScore>x.r.nsScore?2:r.nsScore===x.r.nsScore?1:0),-1);
        const ew=ns===null?null:top-ns;
        projection.pairScores[resultKey(a.id,board.number)]={ns,ew,top:Math.max(0,top),provisional:entries.length<assignments.length};
        if(ns!==null&&ew!==null) { totals[a.ns].mp+=ns;totals[a.ns].top+=top;totals[a.ew].mp+=ew;totals[a.ew].top+=top; }
      }
    }
    for(const row of standing) { const t=totals[row.id];row.score=t.top?100*t.mp/t.top:null;row.secondary=t.mp; }
  }
  // Tied scores share ranks; names only provide stable display order.
  standing.sort((a,b)=>(b.score??-1)-(a.score??-1)||a.name.localeCompare(b.name,'zh-Hant'));
  let rank=0;
  for(let i=0;i<standing.length;i++) {const s=standing[i];if(i===0||Math.abs((s.score??-1)-(standing[i-1].score??-1))>1e-8) rank=i+1;s.rank=rank;}
  return projection;
}
