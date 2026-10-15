import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import { mutationSchema } from '../lib/model';
import { tableNames } from '../lib/table-names';

test('team roster and actual room seats persist without changing scores', () => {
  const e=createEvent({name:'隊員名單測試',kind:'teams',date:'2026-10-16',venue:'',names:['A','B','C','D'],rounds:1,boardsPerRound:2});
  let stored={event:e,projection:project(e),requests:[] as string[]};
  const patch=(data:object)=>{stored=applyMutation(stored,mutationSchema.parse({...data,revision:stored.event.revision,requestId:randomUUID(),reason:'測試名單'}));};
  for(const p of e.participants)patch({action:'team-roster',participantId:p.id,players:[p.id+'甲',p.id+'乙',p.id+'丙',p.id+'丁'],captain:'非上場隊長'});
  const a=e.assignments[0];
  const names={N:a.ns+'甲',S:a.ns+'乙',E:a.ew+'甲',W:a.ew+'乙'};
  patch({action:'table-lineup',assignmentId:a.id,playerNames:names});
  assert.deepEqual(tableNames('teams',stored.event.participants,stored.event.assignments[0]),names);
  assert.deepEqual(stored.event.results,{});
  assert.throws(()=>patch({action:'table-lineup',assignmentId:a.id,playerNames:{...names,N:'別隊賽員'}}),/不在該隊/);
  assert.throws(()=>patch({action:'table-lineup',assignmentId:a.id,playerNames:{...names,N:names.S}}),/不可重複/);
  const closed=e.assignments.find(x=>x.matchId===a.matchId&&x.room==='closed')!;
  assert.throws(()=>patch({action:'table-lineup',assignmentId:closed.id,playerNames:{N:names.E,S:names.W,E:names.N,W:names.S}}),/其他桌/);
  assert.throws(()=>patch({action:'team-roster',participantId:a.ns,players:[],captain:''}),/先更新/);
});
