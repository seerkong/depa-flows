import {describe,expect,test} from 'bun:test';
import type {ControlTaskRootCommand,TaskSpaceDefinition,TaskSpaceCommit} from 'task-manager-contract';
import {InMemoryTaskSpaceOwner,createTaskSpace,replanTask,controlTaskRoot,prepareTask,claimTask,startTask,settleTask,cancelTask,expireTaskClaim,validateTaskSpaceCommitAdmission} from '../src/index.js';

const at='2026-10-13T00:00:00.000Z';
const profile={kind:'task-profile' as const,profileKind:'test.task',schemaVersion:1,facts:{queue:'first'}};
const binding={bindingId:'binding-1',authorityRef:'owner://global',executionRef:'execution://root-1',digest:`sha256:${'a'.repeat(64)}` as const};
function definition():TaskSpaceDefinition{return {kind:'task-space-definition',taskSpaceId:'space',name:'Forest',schemaVersion:1,allowEmpty:true,tasks:[
  {kind:'task-group',taskId:'root',name:'Root',order:0,mode:'sequential',profile,inputArtifacts:[]},
  {kind:'task',taskId:'a',name:'A',order:0,profile,inputArtifacts:[]},
  {kind:'task',taskId:'b',name:'B',order:1,profile,inputArtifacts:[]},
  {kind:'task',taskId:'other',name:'Other root',order:1,profile,inputArtifacts:[]},
],relations:[
  {kind:'parent-child',relationId:'r',parentTaskId:null,childTaskId:'root',order:0},
  {kind:'parent-child',relationId:'a',parentTaskId:'root',childTaskId:'a',order:0},
  {kind:'parent-child',relationId:'b',parentTaskId:'root',childTaskId:'b',order:1},
  {kind:'parent-child',relationId:'other',parentTaskId:null,childTaskId:'other',order:1},
]};}
async function fixture(){const owner=new InMemoryTaskSpaceOwner();const runtime={owner};await createTaskSpace(runtime,{kind:'task-space.create',commandId:'create',taskSpaceId:'space',createdAt:at,definition:definition()},{});return runtime;}
function control(commandId:string,expectedRevision:number,expectedControlRevision:number,action:ControlTaskRootCommand['action'],taskId='root'):ControlTaskRootCommand{return {kind:'task.root-control',commandId,taskSpaceId:'space',taskId,expectedRevision,expectedControlRevision,occurredAt:at,action};}
function claim(commandId:string,expectedRevision:number,taskId='a'){return {kind:'task.claim' as const,commandId,taskSpaceId:'space',taskId,expectedRevision,assigneeRef:'worker',claimedAt:at,leaseDurationMs:60000};}

describe('canonical managed root control',()=>{
  test('managed lease loss cannot silently create a replacement attempt',async()=>{
    const runtime=await fixture();await controlTaskRoot(runtime,control('bind',0,0,{kind:'bind',binding}),{});await controlTaskRoot(runtime,control('resume',1,1,{kind:'resume',bindingId:binding.bindingId}),{});
    const claimed=await claimTask(runtime,claim('claim',2),{});
    await startTask(runtime,{kind:'task.start',commandId:'start',taskSpaceId:'space',expectedRevision:3,claim:claimed.receipt.claim,occurredAt:at},{});
    const expired=await expireTaskClaim(runtime,{kind:'task.claim-expire',commandId:'expire',taskSpaceId:'space',expectedRevision:4,claim:claimed.receipt.claim,observedAt:claimed.receipt.claim.expiresAt},{});
    await expect(claimTask(runtime,claim('automatic-replacement',5),{})).rejects.toMatchObject({code:'root-execution-unknown'});
    expect((await runtime.owner.readSnapshot('space'))?.tasks.find(t=>t.taskId==='a')?.attempt).toBe(expired.snapshot.tasks.find(t=>t.taskId==='a')?.attempt);
  });
  test('cascade cancellation admits one subtree atomically, rejects late results and preserves another root',async()=>{
    const runtime=await fixture(),claimed=await claimTask(runtime,claim('claim',0),{});
    await startTask(runtime,{kind:'task.start',commandId:'start',taskSpaceId:'space',expectedRevision:1,claim:claimed.receipt.claim,occurredAt:at},{});
    const input={kind:'task.cancel' as const,cascade:true as const,commandId:'cancel-root',taskSpaceId:'space',taskId:'root',expectedRevision:2,cancelledAt:at,reason:'Cancel selected root'};
    const cancelled=await cancelTask(runtime,input,{});
    expect(cancelled.snapshot.revision).toBe(3);
    expect(cancelled.snapshot.tasks.filter(t=>t.taskId!=='other').every(t=>t.status==='Cancelled'&&t.activeClaim===null)).toBe(true);
    expect(cancelled.snapshot.tasks.find(t=>t.taskId==='other')?.status).toBe('Ready');
    expect((await runtime.owner.readHistory('space')).filter(e=>e.kind==='task.cancelled')).toHaveLength(3);
    expect((await cancelTask(runtime,input,{})).replayed).toBe(true);
    await expect(settleTask(runtime,{kind:'task.settle',commandId:'late',taskSpaceId:'space',expectedRevision:3,claim:claimed.receipt.claim,occurredAt:at,result:{ok:true},outputArtifacts:[]},{})).rejects.toThrow();
    expect((await runtime.owner.readSnapshot('space'))?.revision).toBe(3);
  });
  test('prepares exactly one Ready leaf with a canonical receipt and preserves future safe editing',async()=>{
    const runtime=await fixture();await controlTaskRoot(runtime,control('bind',0,0,{kind:'bind',binding}),{});
    const input={kind:'task.prepare' as const,commandId:'prepare',taskSpaceId:'space',taskId:'a',rootBindingId:binding.bindingId,expectedRevision:1,preparedAt:at,profile:{...profile,facts:{queue:'admitted'}}};
    await expect(prepareTask(runtime,input,{})).rejects.toMatchObject({code:'root-paused'});
    await controlTaskRoot(runtime,control('resume',1,1,{kind:'resume',bindingId:binding.bindingId}),{});
    await expect(prepareTask(runtime,{...input,expectedRevision:2,rootBindingId:'foreign'},{})).rejects.toMatchObject({code:'root-binding-conflict'});
    await expect(prepareTask(runtime,{...input,expectedRevision:2,taskId:'b'},{})).rejects.toMatchObject({code:'task-not-ready'});
    const prepared=await prepareTask(runtime,{...input,expectedRevision:2},{});
    expect(prepared.snapshot.tasks.find(t=>t.taskId==='a')).toMatchObject({status:'Ready',attempt:0,activeClaim:null,profile:input.profile,preparationReceiptId:prepared.receipt.receiptId});
    expect(prepared.snapshot.definition).toEqual(definition());
    expect((await prepareTask(runtime,{...input,expectedRevision:2},{})).replayed).toBe(true);
    await expect(prepareTask(runtime,{...input,commandId:'prepare-twice',expectedRevision:3},{})).rejects.toMatchObject({code:'task-not-ready'});
    await controlTaskRoot(runtime,control('pause',3,2,{kind:'pause'}),{});
    await expect(controlTaskRoot(runtime,control('release',4,3,{kind:'release',bindingId:binding.bindingId}),{})).rejects.toMatchObject({code:'root-busy'});
    const changed=definition().tasks.map(t=>t.taskId==='b'?{...t,name:'Future editable'}:t);
    const replanned=await replanTask(runtime,{kind:'task.replan',commandId:'future-edit',taskSpaceId:'space',expectedRevision:4,replannedAt:at,plan:{kind:'task-plan',planId:'future',reason:'Edit future work',tasks:changed,relations:definition().relations}},{});
    expect(replanned.snapshot.tasks.find(t=>t.taskId==='a')?.profile).toEqual(input.profile);
    await expect(replanTask(runtime,{kind:'task.replan',commandId:'rewrite-admitted',taskSpaceId:'space',expectedRevision:5,replannedAt:at,plan:{kind:'task-plan',planId:'rewrite',reason:'Forbidden',tasks:changed.map(t=>t.taskId==='a'?{...t,name:'Rewrite admitted'}:t),relations:definition().relations}},{})).rejects.toMatchObject({code:'terminal-task-immutable'});
  });
  test('empty definition is explicit and can grow into the existing canonical forest',async()=>{
    const owner=new InMemoryTaskSpaceOwner();const empty={...definition(),tasks:[],relations:[]};
    const {allowEmpty,...legacy}=empty;
    await expect(createTaskSpace({owner},{kind:'task-space.create',commandId:'bad',taskSpaceId:'space',definition:legacy,createdAt:at},{})).rejects.toMatchObject({code:'invalid-task-definition'});
    const created=await createTaskSpace({owner},{kind:'task-space.create',commandId:'empty',taskSpaceId:'space',definition:empty,createdAt:at},{});
    expect(created.snapshot.tasks).toHaveLength(0);
    const grown=await replanTask({owner},{kind:'task.replan',commandId:'grow',taskSpaceId:'space',expectedRevision:0,replannedAt:at,plan:{kind:'task-plan',planId:'grow',reason:'Add roots',tasks:definition().tasks,relations:definition().relations}},{});
    expect(grown.snapshot.tasks).toHaveLength(4);
    expect(grown.snapshot.tasks.find(t=>t.taskId==='a')?.status).toBe('Ready');
  });
  test('implicit sequential prerequisites of an admitted leaf cannot be rewritten through a group mode',async()=>{
    const runtime=await fixture();await controlTaskRoot(runtime,control('bind',0,0,{kind:'bind',binding}),{});
    await controlTaskRoot(runtime,control('resume',1,1,{kind:'resume',bindingId:binding.bindingId}),{});
    const claimed=await claimTask(runtime,claim('claim-a',2),{});
    await startTask(runtime,{kind:'task.start',commandId:'start-a',taskSpaceId:'space',expectedRevision:3,claim:claimed.receipt.claim,occurredAt:at},{});
    await settleTask(runtime,{kind:'task.settle',commandId:'finish-a',taskSpaceId:'space',expectedRevision:4,claim:claimed.receipt.claim,occurredAt:at,result:{ok:true},outputArtifacts:[]},{});
    await prepareTask(runtime,{kind:'task.prepare',commandId:'prepare-b',taskSpaceId:'space',taskId:'b',rootBindingId:binding.bindingId,expectedRevision:5,preparedAt:at,profile},{});
    await controlTaskRoot(runtime,control('pause',6,2,{kind:'pause'}),{});
    await expect(replanTask(runtime,{kind:'task.replan',commandId:'rewrite-implicit',taskSpaceId:'space',expectedRevision:7,replannedAt:at,plan:{kind:'task-plan',planId:'rewrite',reason:'Change group mode',tasks:definition().tasks.map(t=>t.taskId==='root'&&t.kind==='task-group'?{...t,mode:'all' as const}:t),relations:definition().relations}},{})).rejects.toMatchObject({code:'terminal-task-immutable'});
    expect((await runtime.owner.readSnapshot('space'))?.revision).toBe(7);
  });
  test('bind, pause, resume and receipts gate only the selected root',async()=>{
    const runtime=await fixture();const cmd=control('bind',0,0,{kind:'bind',binding});
    const bound=await controlTaskRoot(runtime,cmd,{});
    expect(bound.receipt.control).toEqual({revision:1,paused:true,binding});
    expect((await controlTaskRoot(runtime,cmd,{})).replayed).toBe(true);
    await expect(claimTask(runtime,claim('blocked',1),{})).rejects.toMatchObject({code:'root-paused'});
    await expect(controlTaskRoot(runtime,control('duplicate',1,1,{kind:'bind',binding}),{})).rejects.toMatchObject({code:'root-binding-conflict'});
    await expect(controlTaskRoot(runtime,control('child',1,0,{kind:'pause'},'a'),{})).rejects.toMatchObject({code:'task-not-root'});
    await expect(controlTaskRoot(runtime,control('stale',1,0,{kind:'pause'}),{})).rejects.toMatchObject({code:'root-control-revision-conflict'});
    await expect(controlTaskRoot(runtime,control('foreign',1,1,{kind:'resume',bindingId:'foreign'}),{})).rejects.toMatchObject({code:'root-binding-conflict'});
    await claimTask(runtime,claim('other',1,'other'),{});
    await controlTaskRoot(runtime,control('resume',2,1,{kind:'resume',bindingId:binding.bindingId}),{});
    const claimed=await claimTask(runtime,claim('claim',3),{});
    await controlTaskRoot(runtime,control('pause',4,2,{kind:'pause'}),{});
    await expect(controlTaskRoot(runtime,control('release-busy',5,3,{kind:'release',bindingId:binding.bindingId}),{})).rejects.toMatchObject({code:'root-busy'});
    await startTask(runtime,{kind:'task.start',commandId:'start',taskSpaceId:'space',expectedRevision:5,claim:claimed.receipt.claim,occurredAt:at},{});
    const settled=await settleTask(runtime,{kind:'task.settle',commandId:'settle',taskSpaceId:'space',expectedRevision:6,claim:claimed.receipt.claim,occurredAt:at,result:{ok:true},outputArtifacts:[]},{});
    expect(settled.snapshot.tasks.find(t=>t.taskId==='b')?.status).toBe('Ready');
    await expect(claimTask(runtime,claim('blocked-next',7,'b'),{})).rejects.toMatchObject({code:'root-paused'});
    const history=await runtime.owner.readHistory('space');
    expect(history.filter(e=>e.kind==='task.root-controlled')).toHaveLength(3);
    const released=await controlTaskRoot(runtime,control('release',7,3,{kind:'release',bindingId:binding.bindingId}),{});
    expect(released.receipt.control).toEqual({revision:4,paused:true,binding:null});
  });
  test('safe replan synchronizes undispatched profile but freezes claimed nodes and their relations',async()=>{
    const runtime=await fixture();await controlTaskRoot(runtime,control('bind',0,0,{kind:'bind',binding}),{});
    await controlTaskRoot(runtime,control('resume',1,1,{kind:'resume',bindingId:binding.bindingId}),{});
    const changed={...definition(),tasks:definition().tasks.map(t=>t.taskId==='b'?{...t,profile:{...profile,facts:{queue:'second'}}}:t)};
    const command={kind:'task.replan' as const,commandId:'edit',taskSpaceId:'space',expectedRevision:2,replannedAt:at,plan:{kind:'task-plan' as const,planId:'edit',reason:'Change plan',tasks:changed.tasks,relations:changed.relations}};
    await expect(replanTask(runtime,command,{})).rejects.toMatchObject({code:'root-busy'});
    await claimTask(runtime,claim('claim',2),{});
    await controlTaskRoot(runtime,control('pause',3,2,{kind:'pause'}),{});
    const edited=await replanTask(runtime,{...command,expectedRevision:4},{});
    expect(edited.snapshot.tasks.find(t=>t.taskId==='b')?.profile.facts).toEqual({queue:'second'});
    expect(edited.snapshot.tasks.find(t=>t.taskId==='a')?.activeClaim).not.toBeNull();
    await expect(replanTask(runtime,{...command,commandId:'claimed-edit',expectedRevision:5,plan:{...command.plan,tasks:changed.tasks.map(t=>t.taskId==='a'?{...t,name:'Changed active'}:t)}},{})).rejects.toMatchObject({code:'terminal-task-immutable'});
    await expect(replanTask(runtime,{...command,commandId:'remove-root',expectedRevision:5,plan:{...command.plan,tasks:[],relations:[]}},{})).rejects.toMatchObject({code:'terminal-task-immutable'});
  });
  test('competing execution binds admit exactly one CAS writer and reject late binding',async()=>{
    const runtime=await fixture();const results=await Promise.allSettled([
      controlTaskRoot(runtime,control('one',0,0,{kind:'bind',binding}),{}),
      controlTaskRoot(runtime,control('two',0,0,{kind:'bind',binding:{...binding,bindingId:'two'}}),{}),
    ]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const old=await fixture();await claimTask(old,claim('already-dispatched',0),{});
    await expect(controlTaskRoot(old,control('late-bind',1,0,{kind:'bind',binding}),{})).rejects.toMatchObject({code:'root-busy'});
  });
  test('raw owner admission rejects forged preparation identity and profile',async()=>{
    const runtime=await fixture()
    await controlTaskRoot(runtime,control('bind',0,0,{kind:'bind',binding}),{})
    await controlTaskRoot(runtime,control('resume',1,1,{kind:'resume',bindingId:binding.bindingId}),{})
    const current=(await runtime.owner.readSnapshot('space'))!;let commit!:TaskSpaceCommit
    const owner={...runtime.owner,readReceiptByCommand:runtime.owner.readReceiptByCommand.bind(runtime.owner),readSnapshot:runtime.owner.readSnapshot.bind(runtime.owner),compareAndSwap:async(value:TaskSpaceCommit)=>{commit=value;return runtime.owner.compareAndSwap(value)}}
    await prepareTask({owner} as any,{kind:'task.prepare',commandId:'prepare',taskSpaceId:'space',taskId:'a',rootBindingId:binding.bindingId,expectedRevision:2,preparedAt:at,profile},{})
    const context={currentSnapshot:current,existingArtifacts:new Map()}
    expect(()=>validateTaskSpaceCommitAdmission(commit,context)).not.toThrow()
    for(const change of [{preparationReceiptId:'receipt:forged'},{profile:{...profile,facts:{queue:'forged'}}}]){
      expect(()=>validateTaskSpaceCommitAdmission({...commit,snapshot:{...commit.snapshot,tasks:commit.snapshot.tasks.map(task=>task.taskId==='a'?{...task,...change}:task)}},context)).toThrow()
    }
  })
  test('raw owner admission rejects forged control, event and receipt without accepting a second truth',async()=>{
    const runtime=await fixture();const current=(await runtime.owner.readSnapshot('space'))!;let commit!:TaskSpaceCommit;
    await controlTaskRoot({owner:{...runtime.owner,readReceiptByCommand:runtime.owner.readReceiptByCommand.bind(runtime.owner),readSnapshot:runtime.owner.readSnapshot.bind(runtime.owner),compareAndSwap:async (value:TaskSpaceCommit)=>{commit=value;return runtime.owner.compareAndSwap(value);}} as any},{...control('bind',0,0,{kind:'bind',binding}),intentDigest:`sha256:${'c'.repeat(64)}`},{});
    const context={currentSnapshot:current,existingArtifacts:new Map()};
    expect(validateTaskSpaceCommitAdmission(commit,context).kind).toBe('task-root-control-receipt');
    expect(()=>validateTaskSpaceCommitAdmission({...commit,receipts:[{...commit.receipts[0],intentDigest:`sha256:${'d'.repeat(64)}`} as any]},context)).toThrow('intent proof');
    const event=commit.events[0]!;
    expect(()=>validateTaskSpaceCommitAdmission({...commit,events:[{...event,control:{revision:1,paused:false,binding}} as any]},context)).toThrow('event does not prove');
    expect(()=>validateTaskSpaceCommitAdmission({...commit,receipts:[{...commit.receipts[0],control:{revision:1,paused:false,binding}} as any]},context)).toThrow('receipt does not prove');
    expect(()=>validateTaskSpaceCommitAdmission({...commit,snapshot:{...commit.snapshot,tasks:commit.snapshot.tasks.map(t=>t.taskId==='root'?{...t,rootControl:undefined}:t)}},context)).toThrow('bypassed');
    expect(()=>validateTaskSpaceCommitAdmission({...commit,snapshot:{...commit.snapshot,tasks:commit.snapshot.tasks.map(t=>t.taskId==='a'?{...t,status:'Succeeded'}:t)}},context)).toThrow('execution facts');
  });
});
