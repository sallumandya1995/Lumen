import {env} from 'cloudflare:workers';
import {describeImage,ImageContextError,readImageJson} from '../../../../lib/image-context';

export async function POST(request:Request){
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(120000)]);
 try{
  const result=await describeImage(await readImageJson(request),(env as any).NEBIUS_API_KEY||'',signal);
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const message=signal.aborted?(request.signal.aborted?'Image reading cancelled.':'Reading the image took too long. Your image is kept; try again.'):error instanceof ImageContextError?error.message:'Could not read this image. Your image is kept; try again.';
  return Response.json({error:message},{status:signal.aborted?(request.signal.aborted?499:504):error instanceof ImageContextError?error.status:502,headers:{'Cache-Control':'no-store'}});
 }
}
