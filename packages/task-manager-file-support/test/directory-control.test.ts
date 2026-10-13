import {describe,expect,test} from 'bun:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FileTaskSpaceOwner} from '../src/index.js';
import {createTaskSpace,controlTaskRoot,prepareTask} from '../../task-manager-logic/src/index.js';
const at='2026-10-13T00:00:00.000Z';
async function create(owner:FileTaskSpaceOwner,id:string,empty=false){return createTaskSpace({owner},{kind:'task-space.create',commandId:`create-${id}`,taskSpaceId:id,createdAt:at,definition:{kind:'task-space-definition',taskSpaceId:id,name:id,schemaVersion:1,allowEmpty:true,tasks:empty?[]:[{kind:'task',taskId:'root',name:'Root',order:0,profile:{kind:'task-profile',profileKind:'test',schemaVersion:1,facts:{}},inputArtifacts:[]}],relations:empty?[]:[{kind:'parent-child',relationId:'root',parentTaskId:null,childTaskId:'root',order:0}]}},{});}
describe('durable directory and root authority',()=>{
  test('lists canonical empty and multi-root spaces and preserves control after restart',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'task-directory-'));
    try{const owner=new FileTaskSpaceOwner({root});await create(owner,'z /space',true);await create(owner,'a');
      const binding={bindingId:'one',authorityRef:'global',executionRef:'root',digest:`sha256:${'b'.repeat(64)}` as const};
      const command={kind:'task.root-control' as const,commandId:'bind',taskSpaceId:'a',taskId:'root',expectedRevision:0,expectedControlRevision:0,occurredAt:at,action:{kind:'bind' as const,binding}};
      const bound=await controlTaskRoot({owner},command,{});
      const restarted=new FileTaskSpaceOwner({root});expect(await restarted.listTaskSpaceIds()).toEqual(['a','z /space']);
      expect(await restarted.readSnapshot('a')).toEqual(bound.snapshot);expect(await restarted.readReceiptByCommand('a','bind')).toEqual(bound.receipt);
      expect((await controlTaskRoot({owner:restarted},command,{})).replayed).toBe(true);
      await controlTaskRoot({owner:restarted},{...command,commandId:'resume',expectedRevision:1,expectedControlRevision:1,action:{kind:'resume',bindingId:binding.bindingId}},{});
      const preparation={kind:'task.prepare' as const,commandId:'prepare',taskSpaceId:'a',taskId:'root',rootBindingId:binding.bindingId,expectedRevision:2,preparedAt:at,profile:{kind:'task-profile' as const,profileKind:'admitted',schemaVersion:1,facts:{frozen:true}}};
      const prepared=await prepareTask({owner:restarted},preparation,{});const finalOwner=new FileTaskSpaceOwner({root});
      expect(await finalOwner.readSnapshot('a')).toEqual(prepared.snapshot);
      expect((await prepareTask({owner:finalOwner},preparation,{})).replayed).toBe(true);
      await expect(restarted.listTaskSpaceIds({maxEntries:1})).rejects.toMatchObject({code:'directory-capacity'});
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
  test('rejects symlinked directory/head and bounds head bytes before JSON parsing',async()=>{
    for(const attack of ['directory','head','bytes','identity'] as const){const root=fs.mkdtempSync(path.join(os.tmpdir(),'task-directory-negative-'));const outside=fs.mkdtempSync(path.join(os.tmpdir(),'task-outside-'));
      try{const owner=new FileTaskSpaceOwner({root});await create(owner,'safe',true);const paths=owner.diagnosticPaths('safe');
        if(attack==='directory'){fs.rmSync(path.dirname(paths.headFile),{recursive:true});fs.symlinkSync(outside,path.dirname(paths.headFile),'dir');}
        else if(attack==='head'){fs.unlinkSync(paths.headFile);fs.writeFileSync(path.join(outside,'head'),'do not read');fs.symlinkSync(path.join(outside,'head'),paths.headFile);}
        else if(attack==='bytes')fs.writeFileSync(paths.headFile,'x'.repeat(16385));
        else{const head=JSON.parse(fs.readFileSync(paths.headFile,'utf8'));head.taskSpaceId='foreign';fs.writeFileSync(paths.headFile,JSON.stringify(head));}
        await expect(owner.listTaskSpaceIds()).rejects.toBeDefined();
      }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
    }
  });
});
