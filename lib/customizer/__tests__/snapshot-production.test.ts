import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { seedCheckoutFixtures, orderPayload, callCheckoutRpc, IDS, USERS, count } from "@/lib/testing/checkout-fixtures";
import { createProductionTestClient } from "@/lib/testing/pglite-production-client";
import { makeProductionInput, productionIntegrityHash, readProductionSnapshot } from "@/lib/customizer/production-input";
import { pinProductionInput, productionStorage, openProductionInput } from "@/lib/customizer/server/production-assets";
import { runProductionTask } from "@/lib/customizer/order-snapshots";
import { processRenderJob } from "@/lib/customizer/render-jobs";
import { renderCustomizationPages, buildPrintPdf } from "@/lib/customizer/v2/server/render";
import { verifyProductionOutputs } from "@/lib/customizer/server/production-output-verification";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { personalizationFreezer } from "@/lib/orders/personalization-production";

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => { throw new Error("Production test requires its injected SQL client"); } }));

describe("immutable manufacturing: real checkout SQL, dispatch, renderer and output commit", () => {
  let t: TestDatabase;
  let storage: ReturnType<typeof createProductionTestClient>;
  beforeAll(async () => { t = await createTestDatabase(); await seedCheckoutFixtures(t); storage = createProductionTestClient(t); }, 120_000);
  afterAll(() => t?.close());
  const query = async (sql: string, values: unknown[] = []) => (await t.db.query<any>(sql, values)).rows;

  async function place(options: { manual?: boolean; productId?: string; pdf?: boolean } = {}) {
    const productId = options.productId || `production-${randomUUID()}`;
    if (!options.productId) {
      await t.db.query("insert into public.products(id,slug,title,status,visibility,price,data) values($1,$1,'Snapshot product','active','public',200,'{}')", [productId]);
      await t.db.query("insert into public.product_customizer_templates(id,product_id,enabled) values($1,$2,true)", [randomUUID(), productId]);
    }
    const template = (await query("select id from public.product_customizer_templates where product_id=$1", [productId]))[0].id;
    const version = randomUUID();
    await t.db.query("insert into public.customizer_template_versions(id,template_id,product_id,version,document) values($1,$2,$3,1,'{}')", [version, template, productId]);
    const customization = randomUUID();
    await t.db.query("insert into public.product_customizations(id,user_id,product_id,template_id,template_version,status) values($1,$2,$3,$4,1,'draft')", [customization, USERS.customerA.id, productId, template]);
    const payload = await orderPayload(t, { customizationId: customization, productId });
    payload.snapshots[0].template_id = template; payload.snapshots[0].template_version_id = version;
    const image = await sharp({ create: { width: 40, height: 40, channels: 4, background: "#b21c40" } }).png().toBuffer();
    const sourcePath = `temporary/${payload.order.id}.png`;
    await storage.client.storage.from("customer-uploads").upload(sourcePath, image, { upsert: false });
    const rendererTemplate = {
      canvasWidthPx: 120, canvasHeightPx: 160, cardWidthIn: 1.2, cardHeightIn: 1.6, dpi: 100,
      bleed: { top: 2, right: 2, bottom: 2, left: 2 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      pages: [{ id: "front", enabled: true, backgroundColor: "#f2efe4" }], fields: [],
      layers: [
        { id: "name", page: "front", type: "text", text: "Approved A", x: 60, y: 30, width: 100, height: 24, textStyle: { fontFamily: "Inter", fontWeight: "400", fontSize: 12, textAlign: "center", color: "#000000" } },
        { id: "image", page: "front", type: "image", src: "temporary-upload", x: 40, y: 60, width: 40, height: 40, zIndex: 2 },
      ], featureFlags: { customizer_v2_server_rendering: !options.manual, customizer_v2_print_pdf: !!options.pdf },
    };
    const fontUrl = "https://fonts.gstatic.com/immutable-test/inter.ttf";
    const input = await pinProductionInput(payload.order.id, makeProductionInput(rendererTemplate, {}, null), productionStorage(storage.client), {
      loadImage: async () => { const source = storage.blobs.get(`customer-uploads/${sourcePath}`); if (!source) throw new Error("Original upload deleted"); return source; },
      catalog: async () => [{ family: "Inter", category: "sans-serif", weights: ["400"], variants: [{ key: "regular", weight: "400", style: "normal", url: fontUrl }], hasItalic: false, subsets: ["latin"], version: "test-version-A", lastModified: "2026-09-01" }],
      loadFont: async () => readFileSync("app/brand-fonts/Inter-400.ttf"), loadLicense: async () => Buffer.from("SIL OPEN FONT LICENSE Version 1.1 - test license fixture"),
    });
    const snapshot = { snapshotSchemaVersion: 1, production: input, document: { approved: "A" } };
    (payload.snapshots[0] as any).snapshot = snapshot; payload.snapshots[0].integrity_hash = productionIntegrityHash(snapshot);
    const created = await callCheckoutRpc(t, payload);
    const row = (await query("select * from public.order_design_snapshots where order_id=$1", [created.order_id]))[0];
    expect((await query("select checkout_state from public.orders where id=$1", [created.order_id]))[0].checkout_state).toBe("finalized");
    expect(row.order_item_id).toBeTruthy();
    expect(await count(t,"select 1 from public.production_tasks where snapshot_id=$1",[row.id])).toBe(1);
    return { row, customization, productId, template, payload, sourcePath };
  }
  async function dispatch(row: any) {
    const task = (await query("select * from public.production_tasks where snapshot_id=$1", [row.id]))[0];
    return runProductionTask(task, storage.client);
  }
  async function render(row: any) {
    const jobs = await dispatch(row);
    for (const id of jobs.jobs) expect((await processRenderJob(id, storage.client)).status).toBe("completed");
    return (await query("select * from public.customizer_render_outputs where snapshot_id=$1 order by page_id,format", [row.id]));
  }

  it("A: renders a normal finalized personalized order using pinned fonts and image bytes", async () => {
    const { row } = await place({ pdf: true }); const outputs = await render(row);
    expect(outputs.map((output: any) => output.format).sort()).toEqual(["pdf", "png"]);
    expect((await query("select render_status,print_files from public.order_design_snapshots where id=$1", [row.id]))[0]).toMatchObject({ render_status: "completed", print_files: { print_png: { front: expect.any(Object) }, print_pdf: { all: expect.any(Object) } } });
  });
  it("migration replays retain completed v1 inputs, originals, jobs, outputs, notifications and the queue-health function", async () => {
    const { row } = await place({ pdf: true }); await render(row);
    const tables = ["orders", "order_items", "order_design_snapshots", "order_production_assets", "production_tasks", "customizer_render_jobs", "customizer_render_outputs", "notification_tasks"];
    const capture = async () => Promise.all(tables.map(table => query(`select * from public.${table} where ${table === "orders" ? "id" : "order_id"}=$1 order by ${table === "order_production_assets" ? "asset_key" : "id"}`, [row.order_id])));
    const before = await capture();
    const queueDefinition = await query("select pg_get_functiondef('public.production_queue_health()'::regprocedure) as definition");
    const script = readFileSync("supabase/migrations/20261002120000_snapshot_owned_production.sql", "utf8");
    await t.db.exec("alter table public.order_production_assets drop constraint order_production_assets_kind_check; alter table public.order_production_assets add constraint order_production_assets_kind_check check (kind in ('image','font','license'));");
    await t.db.exec(script); await t.db.exec(script);
    expect(await capture()).toEqual(before);
    expect(await query("select pg_get_functiondef('public.production_queue_health()'::regprocedure) as definition")).toEqual(queueDefinition);
    const health = (await query("select public.production_health() as health"))[0].health;
    expect(health.chain.automaticComplete).toBeGreaterThanOrEqual(1);
    expect(await query("select 1 from pg_trigger where tgrelid='public.order_design_snapshots'::regclass and tgname='register_snapshot_assets'")).toHaveLength(1);
    expect((await query("select has_function_privilege('authenticated','public.production_health()','execute') as allowed"))[0].allowed).toBe(false);
    await expect(t.asService(db => db.query("delete from storage.objects where bucket_id='order-production' and name=$1", [row.snapshot.production.assets[0].path]))).rejects.toThrow(/COMMITTED_PRODUCTION_ASSET_IMMUTABLE/);
    expect((await query("select render_status from public.order_design_snapshots where id=$1", [row.id]))[0].render_status).toBe("completed");
  });
  for (const scenario of ["B: customization deleted", "C: product archived", "D: product permanently deleted", "E: template changed", "F: template deleted", "H: original upload unavailable"] as const) {
    it(`${scenario} after checkout: historical production still renders the exact approved bytes`, async () => {
      const { row, customization, productId, template, sourcePath } = await place();
      const opened = await openProductionInput(readProductionSnapshot(row), productionStorage(storage.client));
      const expected = await renderCustomizationPages({ template: row.snapshot.production.template, values: {}, editorState: null, mode: "print", includeBleed: true, ...opened });
      if (scenario.startsWith("B")) await t.asService(db => db.query("delete from public.product_customizations where id=$1", [customization]));
      if (scenario.startsWith("C")) await t.asService(db => db.query("update public.products set status='deleted' where id=$1", [productId]));
      if (scenario.startsWith("D")) await t.asService(db => db.query("delete from public.products where id=$1", [productId]));
      if (scenario.startsWith("E")) await t.asService(db => db.query("update public.product_customizer_templates set layers='[]',version=2 where id=$1", [template]));
      if (scenario.startsWith("F")) await t.asService(db => db.query("delete from public.product_customizer_templates where id=$1", [template]));
      if (scenario.startsWith("H")) {
        storage.blobs.delete(`customer-uploads/${sourcePath}`);
        await t.db.query("delete from storage.objects where bucket_id='customer-uploads' and name=$1", [sourcePath]);
        expect(storage.blobs.has(`customer-uploads/${sourcePath}`)).toBe(false);
      }
      const outputs = await render(row);
      expect(outputs[0].checksum).toBe(expected[0].checksum);
      expect(storage.calls).not.toContain("product_customizations");
    });
  }
  it("REGRESSION: customization deleted + template altered + product archived + temporary upload removed, all at once → identical production", async () => {
    const { row, customization, productId, template, sourcePath } = await place({ pdf: true });
    const opened = await openProductionInput(readProductionSnapshot(row), productionStorage(storage.client));
    const expected = await renderCustomizationPages({ template: row.snapshot.production.template, values: {}, editorState: null, mode: "print", includeBleed: true, ...opened });
    await t.asService(db => db.query("delete from public.product_customizations where id=$1", [customization]));
    await t.asService(db => db.query("update public.product_customizer_templates set layers='[]',version=2 where id=$1", [template]));
    await t.asService(db => db.query("update public.products set status='deleted' where id=$1", [productId]));
    storage.blobs.delete(`customer-uploads/${sourcePath}`);
    await t.db.query("delete from storage.objects where bucket_id='customer-uploads' and name=$1", [sourcePath]);
    const callsBefore = storage.calls.length;
    const outputs = await render(row);
    expect(outputs.map((output: any) => output.format).sort()).toEqual(["pdf", "png"]);
    expect(outputs.find((output: any) => output.format === "png").checksum).toBe(expected[0].checksum);
    // The finalized render never looked at live catalogue or design tables.
    const touched = storage.calls.slice(callsBefore);
    for (const table of ["product_customizations", "products", "product_customizer_templates", "customizer_template_versions"]) expect(touched).not.toContain(table);
  });
  it("G: deletion of the actual customer account cascade preserves pending production", async () => {
    const { row } = await place();
    await t.db.query("delete from auth.users where id=$1", [USERS.customerA.id]);
    try { expect((await render(row))[0].status).toBe("ready"); }
    finally { await t.db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [USERS.customerA.id,USERS.customerA.email]); }
  });
  it("I: lost acknowledgement and double worker execution retain one logical output", async () => {
    const { row } = await place(); const { jobs } = await dispatch(row); const originalRpc = storage.client.rpc;
    let lost = false;
    storage.client.rpc = async (name: string, params: any) => { const result = await originalRpc(name,params); if(name === "commit_snapshot_render_result" && !lost && !result.error) { lost=true; return { data:null,error:new Error("response lost after commit") }; } return result; };
    expect((await processRenderJob(jobs[0],storage.client)).status).toBe("completed");
    storage.client.rpc = originalRpc;
    await processRenderJob(jobs[0],storage.client); await dispatch(row);
    expect(await count(t,"select 1 from public.customizer_render_jobs where snapshot_id=$1",[row.id])).toBe(1);
    expect(await count(t,"select 1 from public.customizer_render_outputs where snapshot_id=$1",[row.id])).toBe(1);
  });
  it("J/K: asset outage fails loudly, permanent job failure is audited and safely recovered", async () => {
    const { row } = await place(); const { jobs } = await dispatch(row);
    const asset = row.snapshot.production.assets.find((entry: any) => entry.kind === "image"); const key = `${asset.bucket}/${asset.path}`; const bytes = storage.blobs.get(key)!; storage.blobs.delete(key);
    expect((await processRenderJob(jobs[0],storage.client)).status).toBe("retrying");
    await t.db.query("update public.customizer_render_jobs set status='failed',attempt_count=3,lock_token=null,lock_expires_at=null where id=$1",[jobs[0]]);
    expect((await storage.client.rpc("retry_production_work",{ p_kind:"render",p_id:jobs[0],p_actor_id:USERS.customerB.id,p_reason:"unauthorized retry" })).error).toBeTruthy();
    expect((await storage.client.rpc("retry_production_work",{ p_kind:"render",p_id:jobs[0],p_actor_id:USERS.admin.id,p_reason:"Restored verified order storage" })).error).toBeNull();
    storage.blobs.set(key,bytes);
    expect((await processRenderJob(jobs[0],storage.client)).status).toBe("completed");
    expect((await query("select previous_state from public.production_recovery_audit where target_id=$1",[jobs[0]]))[0].previous_state.attemptCount).toBe(3);
  });
  it("L: manual production is explicit and completion requires an audited staff attestation", async () => {
    const { row } = await place({manual:true}); expect(await dispatch(row)).toEqual({jobs:[]});
    expect((await query("select render_status from public.order_design_snapshots where id=$1",[row.id]))[0].render_status).toBe("manual_required");
    expect((await storage.client.rpc("complete_manual_production",{p_snapshot_id:row.id,p_actor_id:USERS.admin.id,p_evidence:"Print bench batch 42: finished and checked"})).error).toBeNull();
    await storage.client.rpc("complete_manual_production",{p_snapshot_id:row.id,p_actor_id:USERS.admin.id,p_evidence:"Print bench batch 42: finished and checked"});
    expect(await count(t,"select 1 from public.manual_production_completions where snapshot_id=$1",[row.id])).toBe(1);
  });
  it("M: reconciliation repairs a completed dispatch with no job without duplicate work", async () => {
    const { row } = await place(); await t.db.query("update public.production_tasks set status='completed' where snapshot_id=$1",[row.id]);
    expect((await storage.client.rpc("reconcile_production",{p_older_than_seconds:0})).error).toBeNull();
    await storage.client.rpc("reconcile_production",{p_older_than_seconds:0}); await dispatch(row); await dispatch(row);
    expect(await count(t,"select 1 from public.customizer_render_jobs where snapshot_id=$1",[row.id])).toBe(1);
  });
  it("N/O/P: health flags a missing snapshot; customer cannot read assets, storage or call retry RPC", async () => {
    const { row } = await place();
    await t.db.exec("alter table public.order_design_snapshots disable trigger guard_snapshot_history_delete");
    // Simulate corrupt historical linkage without deleting accepted order data.
    await t.db.query("update public.order_items set metadata=metadata||'{\"customizationId\":\"missing\"}',customization_id=null where id=$1",[row.order_item_id]);
    const emptyOrder=await callCheckoutRpc(t,await orderPayload(t,{customizationId:null}));
    const emptyItem=(await query("select id from public.order_items where order_id=$1",[emptyOrder.order_id]))[0].id;
    await t.db.query("update public.order_design_snapshots set order_item_id=$1 where id=$2",[emptyItem,row.id]);
    await t.db.exec("alter table public.order_design_snapshots enable trigger guard_snapshot_history_delete");
    const health=await storage.client.rpc("production_health"); expect(health.data.chain.missingSnapshots).toBeGreaterThan(0);
    expect((await t.asUser(USERS.customerB.id,USERS.customerB.email,db=>db.query("select * from public.order_production_assets"))).rows).toHaveLength(0);
    expect((await t.asUser(USERS.customerB.id,USERS.customerB.email,db=>db.query("select * from storage.objects where bucket_id='order-production'"))).rows).toHaveLength(0);
    await expect(t.asUser(USERS.customerB.id,USERS.customerB.email,db=>db.query("insert into storage.objects(bucket_id,name) values('order-production','orders/foreign/assets/illegal')"))).rejects.toThrow(/row-level security/);
    await expect(t.asUser(USERS.customerB.id,USERS.customerB.email,db=>db.query("select public.retry_production_work('snapshot',$1,$2,'retry illegally')",[row.id,USERS.admin.id]))).rejects.toThrow(/permission denied/);
  });
  it("Q: old or unknown schemas fail explicitly; reordered JSONB keys preserve integrity", async () => {
    const { row } = await place(); expect(()=>readProductionSnapshot({...row,snapshot_schema_version:0})).toThrow(/SNAPSHOT_SCHEMA_UNSUPPORTED/);
    expect(()=>readProductionSnapshot({...row,snapshot_schema_version:2})).toThrow(/SNAPSHOT_SCHEMA_UNSUPPORTED/);
    expect(readProductionSnapshot(row)).toBeTruthy();
    expect(()=>readProductionSnapshot({...row,integrity_hash:"tampered"})).toThrow(/SNAPSHOT_INTEGRITY_INVALID/);
  });
  it("R: two customized products in one transaction use their own exact snapshot and order assets", async () => {
    const a=await place(); const b=await place();
    const prepare=async (source: any,lineNumber:number,orderId?:string)=>{
      const customization=randomUUID();
      await t.db.query("insert into public.product_customizations(id,user_id,product_id,template_id,template_version,status) values($1,$2,$3,$4,1,'draft')",[customization,USERS.customerA.id,source.productId,source.template]);
      const payload=await orderPayload(t,{customizationId:customization,productId:source.productId,quantity:1});
      if(orderId) payload.order.id=orderId;
      payload.items[0].line_number=lineNumber; payload.guards.cart_items[0].line_number=lineNumber;
      const template=JSON.parse(JSON.stringify(source.row.snapshot.production.template));
      template.layers=template.layers.filter((entry:any)=>entry.type!=="text");
      template.layers[0].src=`source-${lineNumber}`;
      const bytes=await sharp({create:{width:40,height:40,channels:4,background:lineNumber===1?"#ff0000":"#0000ff"}}).png().toBuffer();
      const input=await pinProductionInput(payload.order.id,makeProductionInput(template,{},null),productionStorage(storage.client),{loadImage:async()=>bytes});
      const snapshot={snapshotSchemaVersion:1,production:input};
      Object.assign(payload.snapshots[0],{line_number:lineNumber,template_id:source.template,template_version_id:source.payload.snapshots[0].template_version_id,snapshot,integrity_hash:productionIntegrityHash(snapshot)});
      return payload;
    };
    const first=await prepare(a,1); const second=await prepare(b,2,first.order.id);
    const combined={order:{...first.order,subtotal:"400.00",total:"400.00"},items:[...first.items,...second.items],snapshots:[...first.snapshots,...second.snapshots],guards:{products:[...first.guards.products,...second.guards.products],customizations:[...first.guards.customizations,...second.guards.customizations],cart_items:[...first.guards.cart_items,...second.guards.cart_items]}};
    const created=await callCheckoutRpc(t,combined); const rows=await query("select * from public.order_design_snapshots where order_id=$1 order by order_item_id",[created.order_id]);
    expect(rows).toHaveLength(2); const outputs=[];
    for(const row of rows) outputs.push((await render(row))[0]);
    expect(outputs[0].checksum).not.toBe(outputs[1].checksum);
    expect(new Set(outputs.map((output:any)=>output.order_item_id)).size).toBe(2);
    expect(await count(t,"select 1 from public.customizer_render_jobs where order_id=$1",[created.order_id])).toBe(2);
  });
  it("permanently failed dispatch recovery resets the same task and retains failure evidence", async () => {
    const {row}=await place(); const task=(await query("select * from public.production_tasks where snapshot_id=$1",[row.id]))[0];
    await t.db.query("update public.production_tasks set status='failed',attempt_count=8,last_error='forced enqueue outage' where id=$1",[task.id]);
    expect((await storage.client.rpc("retry_production_work",{p_kind:"production",p_id:task.id,p_actor_id:USERS.admin.id,p_reason:"Verified service restored"})).error).toBeNull();
    await render(row);
    expect(await count(t,"select 1 from public.production_tasks where snapshot_id=$1",[row.id])).toBe(1);
    expect((await query("select previous_state from public.production_recovery_audit where target_id=$1",[task.id]))[0].previous_state).toMatchObject({attemptCount:8,error:"forced enqueue outage"});
  });
  it("detects missing stored output and safely regenerates the same logical result",async()=>{
    const {row}=await place();const outputs=await render(row);const output=outputs[0];storage.blobs.delete(`${output.bucket}/${output.path}`);
    await t.db.query("update public.customizer_render_outputs set verified_at='2000-01-01' where id=$1",[output.id]);
    expect((await verifyProductionOutputs(storage.client,25)).invalid).toBeGreaterThanOrEqual(1);
    expect((await processRenderJob(output.job_id,storage.client)).status).toBe("completed");
    expect(await count(t,"select 1 from public.customizer_render_outputs where snapshot_id=$1",[row.id])).toBe(1);
    expect((await query("select checksum from public.customizer_render_outputs where id=$1",[output.id]))[0].checksum).toBe(output.checksum);
  });
  it("deterministic PDF metadata produces identical bytes across retries", async () => {
    const { row }=await place(); const opened=await openProductionInput(readProductionSnapshot(row),productionStorage(storage.client));
    const pages=await renderCustomizationPages({template:row.snapshot.production.template,values:{},editorState:null,mode:"print",...opened});
    const physical={widthIn:1.2,heightIn:1.6,dpi:100,bleedPx:{top:0,right:0,bottom:0,left:0}};
    expect((await buildPrintPdf(pages,physical)).checksum).toBe((await buildPrintPdf(pages,physical)).checksum);
  });
  it("committed originals and ready output metadata cannot be erased or overwritten by cleanup", async () => {
    const { row } = await place(); const outputs = await render(row);
    const asset = row.snapshot.production.assets[0];
    await expect(t.asService(db => db.query("delete from storage.objects where bucket_id=$1 and name=$2", [asset.bucket, asset.path]))).rejects.toThrow(/COMMITTED_PRODUCTION_ASSET_IMMUTABLE/);
    await expect(t.asService(db => db.query("update storage.objects set name='overwritten' where bucket_id=$1 and name=$2", [outputs[0].bucket, outputs[0].path]))).rejects.toThrow(/COMMITTED_PRODUCTION_ASSET_IMMUTABLE/);
    expect((await render(row))[0].checksum).toBe(outputs[0].checksum);
  });
  it("recovered timeouts consume attempts and reach permanent failure instead of looping forever", async () => {
    const { row } = await place(); const { jobs } = await dispatch(row);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await t.db.query("update public.customizer_render_jobs set status='processing',lock_token=gen_random_uuid(),lock_expires_at=now()-interval '1 minute' where id=$1", [jobs[0]]);
      expect((await storage.client.rpc("recover_abandoned_customizer_render_jobs")).error).toBeNull();
      const job = (await query("select status,attempt_count from public.customizer_render_jobs where id=$1", [jobs[0]]))[0];
      expect(job).toMatchObject({ status: attempt === 3 ? "failed" : "retrying", attempt_count: attempt });
    }
  });
  it("cleanup selects only old abandoned copies, preserving young and committed files", async () => {
    const { row } = await place(); const asset = row.snapshot.production.assets[0];
    await t.db.exec("alter table storage.objects disable trigger guard_pinned_production_storage");
    try { await t.db.query("update storage.objects set created_at=now()-interval '3 days' where bucket_id=$1 and name=$2", [asset.bucket, asset.path]); }
    finally { await t.db.exec("alter table storage.objects enable trigger guard_pinned_production_storage"); }
    const oldPath = `orders/abandoned-${randomUUID()}/assets/orphan`;
    const youngPath = `orders/current-${randomUUID()}/assets/orphan`;
    await t.db.query("insert into storage.objects(bucket_id,name,created_at) values('order-production',$1,now()-interval '3 days'),('order-production',$2,now())", [oldPath, youngPath]);
    const result = await storage.client.rpc("production_storage_cleanup_candidates");
    expect(result.error).toBeNull(); expect(result.data).toContainEqual({ bucket: "order-production", path: oldPath });
    expect(result.data.some((entry: any) => [asset.path, youngPath].includes(entry.path))).toBe(false);
  });
  it("changed pinned fonts fail loudly instead of using a live catalogue or a substitute", async () => {
    const { row } = await place(); const font = row.snapshot.production.assets.find((entry: any) => entry.kind === "font");
    const key = `${font.bucket}/${font.path}`; const original = storage.blobs.get(key)!;
    storage.blobs.set(key, Buffer.alloc(original.length, 0));
    await expect(openProductionInput(readProductionSnapshot(row), productionStorage(storage.client))).rejects.toThrow(/checksum/);
    storage.blobs.set(key, original);
  });
  it("corrupt images and SVG text with unpinned fonts are rejected before order acceptance", async () => {
    const template = { pages: [{ id: "front", enabled: true }], layers: [{ id: "asset", type: "image", page: "front", src: "source", x: 0, y: 0, width: 1, height: 1 }] };
    const input = makeProductionInput(template, {}, null);
    for (const bytes of [Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Mutable">Name</text></svg>')]) {
      await expect(pinProductionInput("rejected-order", input, { put: async () => { throw new Error("Must reject before storage"); }, get: async () => bytes }, { loadImage: async () => bytes })).rejects.toThrow(/Production (image|vectors)/);
    }
  });
  it("pinning an image never rewrites equal customer text, captions or identity strings", async () => {
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const template = { pages: [{ id: "front", enabled: true }], fields: [{ id: "photo", type: "image" }], layers: [{ id: "source", type: "image", page: "front", fieldId: "photo", customerEditable: true, src: "source", name: "source", x: 0, y: 0, width: 1, height: 1 }] };
    const input = makeProductionInput(template, { photo: "source", caption: "source" }, null);
    const pinned = await pinProductionInput("pinned-order", input, { put: async () => undefined, get: async () => bytes }, { loadImage: async () => bytes });
    expect(pinned.values.photo).toMatch(/^order-asset:/); expect(pinned.values.caption).toBe("source");
    expect(pinned.template.layers[0]).toMatchObject({ id: "source", name: "source", src: expect.stringMatching(/^order-asset:/) });
  });
  it("manual product PDF uploads are order-owned and survive removal of the original", async () => {
    const payload = await orderPayload(t, { customizationId: null });
    const document = await PDFDocument.create(); const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage().drawText("Approved manual file", { font }); const bytes = Buffer.from(await document.save());
    const sourcePath = `temporary/${payload.order.id}.pdf`;
    await storage.client.storage.from("customer-uploads").upload(sourcePath, bytes, { upsert: false });
    const reference = await sharp({ create: { width: 1, height: 1, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const contract = await personalizationFreezer(storage.client)({ orderId: payload.order.id, lineNumber: 1, product: { id: "product-active", title: "Pearl", description: "Approved paper and layout specification", thumbnail: `data:image/png;base64,${reference.toString("base64")}`, customizationFields: [{ name: "file", type: "file" }] }, line: { options: payload.items[0].selected_options, quantity: payload.items[0].quantity }, values: {}, files: { file: { bucket: "customer-uploads", path: sourcePath, mimeType: "application/pdf", size: bytes.length, name: "approved.pdf" } } } as any);
    payload.items[0].metadata = { ...payload.items[0].metadata, productionSnapshot: contract };
    payload.items[0].uploaded_files = (contract as any).production.instructions.files;
    const accepted = await callCheckoutRpc(t, payload);
    storage.blobs.delete(`customer-uploads/${sourcePath}`);
    const row = (await query("select * from public.order_design_snapshots where order_id=$1", [accepted.order_id]))[0];
    expect(row).toMatchObject({ production_mode: "manual", render_status: "manual_required" });
    const asset = readProductionSnapshot(row).assets.find(entry => entry.kind === "document")!;
    expect(await productionStorage(storage.client).get(asset.path)).toEqual(bytes);
    expect(row.snapshot.production.instructions.productSpecification).toMatchObject({ description: "Approved paper and layout specification", thumbnail: expect.stringMatching(/^order-asset:/) });
    await t.asService(db => db.query("delete from public.products where id='product-active'"));
    expect(await productionStorage(storage.client).get(asset.path)).toEqual(bytes);
  });
});
