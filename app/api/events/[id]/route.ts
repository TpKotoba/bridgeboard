import { NextResponse } from 'next/server';
import { getEvent,mutateEvent } from '@/lib/store';
import { mutationSchema } from '@/lib/model';
import { errorResponse,readJson,requireAdmin } from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{
  const {event,projection}=await getEvent((await params).id);
  const {audit,...publicData}=event;void audit;
  const boards=event.publishBoards?event.boards:event.boards.map(({deal,...rest})=>{void deal;return rest;});
  return NextResponse.json({...publicData,boards,projection},{headers:{'Cache-Control':'public, max-age=0, s-maxage=15'}});
}catch(e){return errorResponse(e);}}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{await requireAdmin(request);const stored=await mutateEvent((await params).id,mutationSchema.parse(await readJson(request)));return NextResponse.json({revision:stored.event.revision},{headers:{'Cache-Control':'no-store'}});}catch(e){return errorResponse(e);}}
