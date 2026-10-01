import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
const mocks=vi.hoisted(()=>({actor:vi.fn(),admin:vi.fn(),worker:vi.fn(),service:vi.fn()}));
vi.mock("@/lib/auth/roles",()=>({getCurrentActor:mocks.actor}));
vi.mock("@/lib/auth/admin-server",()=>({requireAdmin:mocks.admin,getCurrentAdmin:mocks.admin}));
vi.mock("@/lib/security/worker-auth",()=>({hasWorkerSecret:mocks.worker}));
vi.mock("@/lib/supabase/server",()=>({createServiceRoleClient:mocks.service}));
import { withAdminMutation } from "@/lib/security/admin-mutation";
import { GET as assetAccess } from "@/app/api/admin/production/assets/route";
import { POST as productionRetry } from "@/app/api/admin/production/retry/route";

afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
const request=(body="{}",origin="https://husnalogy.test")=>new Request("https://husnalogy.test/api/admin/production/retry",{method:"POST",body,headers:{origin,"content-type":"application/json"}});
describe("admin production authorization and bounded mutations",()=>{
 it("P: anonymous/customer retries are refused before privileged I/O",async()=>{
  mocks.actor.mockResolvedValue(null); expect((await productionRetry(request())).status).toBe(401);
  mocks.actor.mockResolvedValue({id:"customer",role:"customer"}); expect((await productionRetry(request())).status).toBe(403);
  expect(mocks.service).not.toHaveBeenCalled();
 });
 it("O: another customer's production originals are denied without signing any URL",async()=>{
  mocks.admin.mockResolvedValue({ok:false,response:Response.json({ok:false},{status:401})});
  expect((await assetAccess(new Request("https://husnalogy.test/api/admin/production/assets?snapshotId=foreign&key=foreign"))).status).toBe(401);
  expect(mocks.service).not.toHaveBeenCalled();
 });
 it("refuses cross-origin admin mutations and unsafe methods",async()=>{
  mocks.actor.mockResolvedValue({id:"admin",role:"admin"}); const handler=vi.fn(async()=>Response.json({ok:true})); const guarded=withAdminMutation(handler);
  vi.stubEnv("NODE_ENV","production");vi.stubEnv("NEXT_PUBLIC_SITE_URL","https://husnalogy.test");
  expect((await guarded(request("{}","https://evil.test"))).status).toBe(403);
  expect((await guarded(new Request("https://husnalogy.test",{method:"GET"}))).status).toBe(405); expect(handler).not.toHaveBeenCalled();
 });
 it("works with the runtime's request object, which is NOT an undici Request (no `new Request(request)` clone)",async()=>{
  // Next.js route handlers receive a NextRequest that undici cannot clone
  // ("Cannot read private member #state"); this stand-in is likewise foreign.
  mocks.actor.mockResolvedValue({id:"admin",role:"admin"});
  const handler=vi.fn(async(req:Request)=>Response.json({body:await req.json(),origin:req.headers.get("origin"),method:req.method,url:req.url}));
  const real=request('{"status":"printing"}');
  const foreign={url:real.url,method:real.method,headers:real.headers,body:real.body,signal:real.signal} as unknown as Request;
  const response=await withAdminMutation(handler)(foreign);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({body:{status:"printing"},origin:"https://husnalogy.test",method:"POST",url:"https://husnalogy.test/api/admin/production/retry"});
 });
 it("bounds a body that omits Content-Length, and passes bounded valid bodies through",async()=>{
  mocks.actor.mockResolvedValue({id:"admin",role:"admin"}); const handler=vi.fn(async(req:Request)=>Response.json(await req.json())); const guarded=withAdminMutation(handler,{maxBytes:16});
  expect((await guarded(request('"'+"x".repeat(40)+'"'))).status).toBe(413); expect(handler).not.toHaveBeenCalled();
  expect(await (await guarded(request('{"ok":true}'))).json()).toEqual({ok:true});
 });
 it("retains explicit designer capabilities and authenticated secret-only worker operations",async()=>{
  mocks.actor.mockResolvedValue({id:"designer",role:"designer"}); const handler=vi.fn(async()=>Response.json({ok:true}));
  expect((await withAdminMutation(handler)(request())).status).toBe(403);
  expect((await withAdminMutation(handler,{studio:true})(request())).status).toBe(200);
  mocks.worker.mockReturnValue(true);expect((await withAdminMutation(handler,{worker:true})(request("{}","https://scheduler.test"))).status).toBe(200);
 });
 it("fails closed with a controlled response when authentication or handling throws",async()=>{
  mocks.actor.mockRejectedValue(new Error("auth database unavailable"));
  expect((await withAdminMutation(async()=>Response.json({ok:true}))(request())).status).toBe(500);
 });
 it("allows origin-checked logout of an expired session only on the exact logout route",async()=>{
  mocks.actor.mockResolvedValue(null);
  const guarded=withAdminMutation(async()=>Response.json({ok:true}),{logout:true});
  expect((await guarded(new Request("https://husnalogy.test/api/admin/logout",{method:"POST",headers:{origin:"https://husnalogy.test"}}))).status).toBe(200);
  expect((await guarded(request())).status).toBe(401);
  expect((await guarded(new Request("https://husnalogy.test/api/admin/logout",{method:"POST",headers:{"sec-fetch-site":"cross-site"}}))).status).toBe(403);
 });
 it("every exported admin mutation uses the shared guard",()=>{
  const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):[join(dir,entry.name)]);
  const missing:string[]=[];let mutations=0;
  for(const file of walk("app/api/admin").filter(file=>file.endsWith("route.ts"))){
   const source=readFileSync(file,"utf8"); const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
   for(const statement of ast.statements){
    if(ts.isFunctionDeclaration(statement)&&statement.name&&["POST","PUT","PATCH","DELETE"].includes(statement.name.text)) missing.push(`${file}:${statement.name.text}`);
    if(ts.isVariableStatement(statement)) for(const declaration of statement.declarationList.declarations){
     if(!ts.isIdentifier(declaration.name)||!["POST","PUT","PATCH","DELETE"].includes(declaration.name.text)) continue;
     mutations++; if(!declaration.initializer?.getText(ast).startsWith("withAdminMutation("))missing.push(`${file}:${declaration.name.text}`);
    }
   }
  }
  expect(mutations).toBeGreaterThan(40);expect(missing).toEqual([]);
 });
});
