import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{},Intl,Date};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../team-board.js',import.meta.url),'utf8'),context);
const select=context.window.WWTeamBoardUtils.selectTasks;
const tasks=[
 {id:'a',assignee_id:'video',creator_id:'brand',status:'in_progress',due_date:'2026-11-12',blocked_reason:'Need footage'},
 {id:'b',assignee_id:'social',reviewer_id:'artist',creator_id:'brand',status:'review',due_date:'2026-11-13'},
 {id:'c',assignee_id:'video',status:'done',due_date:'2026-11-12',blocked_reason:'Old blocker'},
 {id:'d',assignee_id:null,status:'open',due_date:'2026-11-13'},
 {id:'e',assignee_id:'social',creator_id:'artist',status:'review'},
 {id:'f',assignee_id:'social',reviewer_id:'brand',creator_id:'artist',status:'review'},
];
const ids=opts=>Array.from(select(tasks,{today:'2026-11-13',...opts}),t=>t.id);
test('My work includes owned tasks and explicit or fallback reviews',()=>{
 assert.deepEqual(ids({actor:'artist',filter:'mine'}),['b','e']);
});
test('Owner, personal and focus filters intersect',()=>{
 assert.deepEqual(ids({actor:'artist',filter:'mine',assignee:'social',focus:'review'}),['b','e']);
 assert.deepEqual(ids({assignee:'video',focus:'overdue'}),['a']);
 assert.deepEqual(ids({actor:'artist',filter:'mine',assignee:'video'}),[]);
});
test('Due today, overdue and blocked exclude completed tasks',()=>{
 assert.deepEqual(ids({focus:'today'}),['b','d']);
 assert.deepEqual(ids({focus:'overdue'}),['a']);
 assert.deepEqual(ids({focus:'blocked'}),['a']);
});
test('Unassigned work remains visible and filters do not mutate source',()=>{
 assert.deepEqual(ids({assignee:'unassigned'}),['d']);
 assert.deepEqual(ids({}),['a','b','c','d','e','f']);
 assert.equal(tasks.length,6);
});
