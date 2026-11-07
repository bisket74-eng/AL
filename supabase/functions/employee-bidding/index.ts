import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const url=Deno.env.get("SUPABASE_URL")!, anon=Deno.env.get("SUPABASE_ANON_KEY")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(url,service,{auth:{persistSession:false}});
async function hash(t:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function getInvite(token:string){if(!token||token.length<32)throw new Error("This bidding link is invalid.");const {data,error}=await admin.from("annual_leave_bid_invites").select("*").eq("token_hash",await hash(token)).maybeSingle();if(error)throw error;if(!data||data.status!=="open")throw new Error("This bidding link has expired or has already been used.");return data}
function weeksFor(year:number){const out=[];const d=new Date(year,0,1,12);while(d.getDay()!==1)d.setDate(d.getDate()+1);let n=1;while(d.getFullYear()<=year){const end=new Date(d);end.setDate(end.getDate()+6);out.push({n,start:d.toISOString().slice(0,10),end:end.toISOString().slice(0,10)});d.setDate(d.getDate()+7)}return out}
function blocks(a:number[]){if(!a.length)return 0;let n=1;for(let i=1;i<a.length;i++)if(a[i]!==a[i-1]+1)n++;return n}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const body=await req.json(),action=body.action;
  if(action==="create"){
   const auth=req.headers.get("Authorization");if(!auth)return json({error:"Admin sign-in required."},401);
   const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
   const {data:{user},error:authError}=await userClient.auth.getUser();if(authError||!user)return json({error:"Admin sign-in required."},401);
   const {data:row,error:readError}=await admin.from("annual_leave_app_state").select("payload").eq("id","main").single();if(readError)throw readError;
   const s=row.payload,employee=s.employees.find((e:any)=>e.id===body.employeeId&&e.officeId===Number(body.officeId)&&e.active!==false);
   const office=s.offices.find((o:any)=>o.id===Number(body.officeId));const year=Number(body.year),round=Number(body.round);
   if(!employee||!office||year!==Number(s.year)||![1,2].includes(round))return json({error:"Employee, board, year, or round does not match the current master board."},400);
   const raw=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");const token=raw;
   await admin.from("annual_leave_bid_invites").update({status:"revoked"}).eq("office_id",office.id).eq("leave_year",year).eq("bidding_round",round).eq("status","open");
   const {error:insertError}=await admin.from("annual_leave_bid_invites").insert({token_hash:await hash(token),employee_id:employee.id,office_id:office.id,leave_year:year,bidding_round:round,status:"open",created_by:user.id});
   if(insertError)throw insertError;
   return json({url:"https://bisket74-eng.github.io/AL/employee-bid.html?token="+token});
  }
  if(action==="get"){
   const invite=await getInvite(body.token);
   const {data:row,error}=await admin.from("annual_leave_app_state").select("payload,updated_at").eq("id","main").single();if(error)throw error;const s=row.payload;
   const employee=s.employees.find((e:any)=>e.id===invite.employee_id&&e.officeId===invite.office_id&&e.active!==false),office=s.offices.find((o:any)=>o.id===invite.office_id);
   if(!employee||!office||Number(s.year)!==invite.leave_year)throw new Error("The board has changed. Please ask your supervisor for a new link.");
   const roster=s.employees.filter((e:any)=>e.officeId===office.id&&e.active!==false).sort((a:any,b:any)=>String(a.seniority).localeCompare(String(b.seniority)));
   const roundOneWeeks=s.selections.filter((x:any)=>x.employeeId===employee.id&&x.officeId===office.id&&x.year===invite.leave_year&&x.round===1).flatMap((x:any)=>x.weeks).length;
   const selections=s.selections.filter((x:any)=>x.officeId===office.id&&x.year===invite.leave_year).map((x:any)=>({employeeId:x.employeeId,employeeName:(s.employees.find((e:any)=>e.id===x.employeeId)?.last||"Employee"),weeks:x.weeks,round:x.round}));
   return json({invite:{round:invite.bidding_round},employee:{id:employee.id,first:employee.first,last:employee.last,seniority:employee.seniority,entitlement:Number(employee.entitlement)},office:{id:office.id,name:office.name,group:office.group},config:{year:s.year,unionStart:s.unionStart,unionEnd:s.unionEnd,leaveAvailable:s.leaveAvailable},roundOneWeeks,selections});
  }
  if(action==="submit"){
   const invite=await getInvite(body.token),chosen=[...new Set((body.weeks||[]).map(Number))].sort((a:number,b:number)=>a-b);
   if(!chosen.length||chosen.some((n:number)=>!Number.isInteger(n)))return json({error:"Select at least one valid week."},400);
   const {data:row,error}=await admin.from("annual_leave_app_state").select("payload,updated_at").eq("id","main").single();if(error)throw error;const s=row.payload;
   const employee=s.employees.find((e:any)=>e.id===invite.employee_id&&e.officeId===invite.office_id&&e.active!==false),office=s.offices.find((o:any)=>o.id===invite.office_id);
   if(!employee||!office||Number(s.year)!==invite.leave_year)throw new Error("The board has changed. Ask your supervisor for a new link.");
   const allWeeks=weeksFor(invite.leave_year),invalid=chosen.filter((n:number)=>n<1||n>allWeeks.length);if(invalid.length)return json({error:"The server could not match selected week number(s): "+invalid.join(", ")+". Valid week numbers are 1 through "+allWeeks.length+". Please send this message to your supervisor.",debug:{leaveYear:invite.leave_year,selectedWeeks:chosen,validWeekCount:allWeeks.length}},400);
   const unionStart=String(s.unionStart||"").slice(0,10),unionEnd=String(s.unionEnd||"").slice(0,10);
   const christmasStart=String(invite.leave_year)+"-12-20",christmasEnd=String(invite.leave_year+1)+"-01-03";
   const christmasApplies=office.group!=="always"&&(invite.leave_year%2===1?office.group==="A":office.group==="B");
   // Resolve each submitted week by its one-based position in the server calendar.
   // This avoids relying on a week-number property that may differ between deployed versions.
   const selectedWeekDetails=chosen.map(n=>allWeeks[n-1]).filter(Boolean).map(w=>{
    const union=!!unionStart&&!!unionEnd&&w.start<=unionEnd&&w.end>=unionStart;
    const christmas=christmasApplies&&w.start<=christmasEnd&&w.end>=christmasStart;
    return {week:w.n,start:w.start,end:w.end,reason:union?"Union":christmas?"Christmas":null,blocked:union||christmas};
   });
   const blockedChosen=selectedWeekDetails.filter(w=>w.blocked);
   if(blockedChosen.length){
    const detail=blockedChosen.map(w=>"week "+w.week+" ("+w.start+" to "+w.end+", "+w.reason+")").join("; ");
    const context=" Office: "+office.name+" (group "+office.group+"); union blackout: "+(unionStart||"not set")+" through "+(unionEnd||"not set")+". "+detail;
    return json({error:"A selected week is blocked by the server blackout check."+context,diagnostic:{office:office.name,officeGroup:office.group,leaveYear:invite.leave_year,unionStart,unionEnd,blockedWeeks:blockedChosen}},409);
   }
   const conflicts=s.selections.filter((x:any)=>x.officeId===office.id&&x.year===invite.leave_year&&x.employeeId!==employee.id).flatMap((x:any)=>x.weeks);if(chosen.some((n:number)=>conflicts.includes(n)))return json({error:"A selected week was just taken by another employee. Refresh your link and choose again."},409);
   const old=s.selections.filter((x:any)=>x.employeeId===employee.id&&x.officeId===office.id&&x.year===invite.leave_year&&x.round===invite.bidding_round);
   const already=old.flatMap((x:any)=>x.weeks);
   if(chosen.some((n:number)=>already.includes(n)))return json({error:"A week you already submitted is locked. Choose only additional weeks."},409);
   const first=s.selections.filter((x:any)=>x.employeeId===employee.id&&x.officeId===office.id&&x.year===invite.leave_year&&x.round===1&&invite.bidding_round!==1).flatMap((x:any)=>x.weeks);
   const max=invite.bidding_round===1?Math.min(3,Number(employee.entitlement)):Math.max(0,Number(employee.entitlement)-first.length);
   if(already.length+chosen.length>max)return json({error:"Your selection exceeds your remaining entitlement. Previously submitted weeks remain locked."},400);
   if(invite.bidding_round===1&&blocks(chosen)>2)return json({error:"First-round selections may be split into no more than two blocks."},400);
   if(old.length){old[0].weeks=[...new Set([...already,...chosen])].sort((a:number,b:number)=>a-b);old[0].submittedAt=new Date().toISOString();}else{s.selections.push({id:crypto.randomUUID(),employeeId:employee.id,officeId:office.id,year:invite.leave_year,round:invite.bidding_round,weeks:chosen,method:"Employee online submission",submittedAt:new Date().toISOString()});}
   const submittedAt=new Date().toISOString();const {error:commitError}=await admin.rpc("commit_employee_bid",{p_invite_id:invite.id,p_payload:s,p_expected_updated_at:row.updated_at,p_employee_id:employee.id,p_office_id:office.id,p_leave_year:invite.leave_year,p_bidding_round:invite.bidding_round,p_weeks:chosen,p_submitted_at:submittedAt});if(commitError){const conflict=commitError.message?.includes("master board changed");return json({error:commitError.message||"Unable to commit this bid."},conflict?409:400)}
   return json({success:true});
  }
  return json({error:"Unknown action."},400);
 }catch(e){return json({error:e?.message||"Unable to complete the request."},400)}
});