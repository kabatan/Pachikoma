// Restore original large files before serving; parts contain the unmodified bytes.
import {readFile,stat,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
export async function prepareRelease(root) {
  const manifest=JSON.parse(await readFile(resolve(root,'release-parts.json'),'utf8'));
  const local=name=>{const p=resolve(root,name),rel=relative(root,p);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Invalid release path');return p;};
  for(const file of manifest.files){
    const dest=local(file.path);
    const valid=async()=>{try{return (await stat(dest)).size===file.bytes&&createHash('sha256').update(await readFile(dest)).digest('hex')===file.sha256;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
    if(await valid())continue;
    console.log('Preparing original file: '+file.path);
    const temp=dest+'.joining-'+randomUUID(),hash=createHash('sha256');let handle,bytes=0;
    try{
      handle=await open(temp,'wx');
      for(const part of file.parts){const data=await readFile(local(part.path));if(data.length!==part.bytes)throw Error('Incomplete release part: '+part.path);hash.update(data);await handle.writeFile(data);bytes+=data.length;}
      await handle.close();handle=null;
      if(bytes!==file.bytes||hash.digest('hex')!==file.sha256)throw Error('Release file checksum mismatch: '+file.path);
      await unlink(dest).catch(e=>{if(e.code!=='ENOENT')throw e;});await rename(temp,dest);
    }finally{if(handle)await handle.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
}
