// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { ProviderError } from "@/lib/providers/base";
import { rename } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { POST as postAsset, PATCH as selectTake, GET as getAssets } from "@/app/api/project/[id]/assets/route";
import { appendScriptVariants } from "@/lib/script-variants";
import { listAiTasks, recordAiTask, updateAiTask } from "@/lib/ai-tasks";
import { attachReplicaTask, replicaForProject, recoverReplica, submitReplica } from "@/lib/replicate-job";
import type { AIProvider, VideoOptions } from "@/lib/providers/types";

let root: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});
vi.mock("@/lib/media-probe", () => ({ probeMedia: async () => ({duration:3,width:720,height:1280}) }));
const context = {params:Promise.resolve({id:"p"})};
const request = (data: unknown) => new NextRequest("http://localhost/api/test", {method:"POST",body:JSON.stringify(data)});
const shot = { shotId:1,duration:3,type:"demo" as const,camera:"static",description:"demo",transition:"direct_concat" as const,visualSource:"ai_generate" as const,voiceover:"demo" };
const options: VideoOptions = { modelId:"model",mode:"video-to-video",prompt:"test" };
function openDB() {
  sqlite = new Database(join(root,"test.sqlite"));
  db=drizzle(sqlite,{schema});
  migrate(db,{migrationsFolder:"drizzle"});
}
beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),"cf-owner-"));
  vi.stubEnv("APP_DATA_DIR",root);
  openDB();
  db.insert(schema.projects).values({id:"p",name:"project"}).run();
  db.insert(schema.scripts).values(["A","B"].map(id=>({id,projectId:"p",styleType:"custom" as const,shots:[shot],selected:id==="B"}))).run();
});
afterEach(()=>{sqlite.close();rmSync(root,{recursive:true,force:true});vi.unstubAllGlobals();vi.unstubAllEnvs();});
const sourceUrl="data:image/png;base64,AA==";
const save=(data: object)=>postAsset(request({shotId:1,sourceUrl,...data}),context);
const read=async(scriptId:string)=> (await getAssets(new NextRequest("http://localhost/api/test?scriptId="+scriptId),context)).json();

it("isolates A/B #1, pins a late A result and reuses it only when explicitly requested",async()=>{
  const a=await (await save({scriptId:"A"})).json();
  expect(await read("B")).toEqual([]);
  const b=await (await save({scriptId:"B"})).json();
  const rowId=await recordAiTask({projectId:"p",scriptId:"A",shotId:1,provider:"fal-ai",model:"m",taskId:"t"});
  await updateAiTask(rowId,{status:"completed",resultUrls:[sourceUrl]});
  expect(await listAiTasks("p",true)).toHaveLength(1);
  const delivery={scriptId:"A",provider:"fal-ai",providerTaskId:"t"};
  expect((await save({...delivery,scriptId:"B"})).status).toBeGreaterThanOrEqual(400);
  await Promise.all([save(delivery),save(delivery)]);
  expect(await listAiTasks("p",true)).toHaveLength(0);
  expect(await read("A")).toHaveLength(2);
  expect((await read("B")).filter((r:{selected:boolean})=>r.selected)).toMatchObject([{id:b.id}]);
  expect((await selectTake(request({scriptId:"B",assetId:a.id}),context)).status).toBe(409);
  const copied=await (await selectTake(request({scriptId:"B",assetId:a.id,reuse:true,shotId:1}),context)).json();
  expect(copied).toMatchObject({scriptId:"B",filePath:a.filePath});
  expect(copied.id).not.toBe(a.id);
  expect((await read("A")).filter((r:{selected:boolean})=>r.selected)).toHaveLength(1);
  expect((await save({})).status).toBe(409);
});

it("keeps a locked shot unchanged and its late paid result recoverable",async()=>{
  const rowId=await recordAiTask({projectId:"p",scriptId:"A",shotId:1,provider:"fal-ai",model:"m",taskId:"t"});
  await updateAiTask(rowId,{status:"completed",resultUrls:[sourceUrl]});
  db.update(schema.scripts).set({shots:[{...shot,referenceCut:{start:0,end:3,locked:true}} as typeof shot]}).where(eq(schema.scripts.id,"A")).run();
  expect((await save({scriptId:"A",provider:"fal-ai",providerTaskId:"t"})).status).toBe(409);
  expect(await read("A")).toHaveLength(0);
  expect(await listAiTasks("p",true)).toHaveLength(1);
  expect((await save({scriptId:"B"})).status).toBe(200);
});

it("migrates single-script historical takes and leaves ambiguous project files untouched",()=>{
  const legacy=new Database(":memory:");
  try {
    legacy.exec("CREATE TABLE scripts(id TEXT PRIMARY KEY,project_id TEXT); CREATE TABLE assets(project_id TEXT,shot_id INTEGER,file_path TEXT); CREATE TABLE ai_tasks(id TEXT,project_id TEXT,shot_id INTEGER,mode TEXT,prompt TEXT,status TEXT); CREATE TABLE compositions(project_id TEXT,status TEXT); CREATE TABLE projects(id TEXT,source_type TEXT); INSERT INTO scripts VALUES ('a','one'),('b','two'),('c','two'); INSERT INTO assets VALUES ('one',1,'one.png'),('two',1,'two.png'); INSERT INTO ai_tasks(project_id,shot_id) VALUES ('one',1),('two',1),('one',NULL);");
    legacy.exec(readFileSync("drizzle/0020_script_asset_ownership.sql","utf8"));
    expect(legacy.prepare("SELECT file_path,script_id FROM assets ORDER BY file_path").all()).toEqual([{file_path:"one.png",script_id:"a"},{file_path:"two.png",script_id:null}]);
    expect(legacy.prepare("SELECT script_id FROM ai_tasks ORDER BY rowid").pluck().all()).toEqual(["a",null,null]);
  } finally {legacy.close();}
});

it("reserves before submitting, recovers after a failed download and process restart, and finalizes once",async()=>{
  const submitVideoTask=vi.fn().mockResolvedValue({taskId:"cloud-1",modelId:"model"});
  const waitForTask=vi.fn().mockResolvedValue({status:"completed",result:{videoUrls:["https://example.invalid/video"]}});
  const provider={name:"fake",submitVideoTask,waitForTask} as unknown as AIProvider;
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:503})));
  await Promise.allSettled([submitReplica("p",provider,options),submitReplica("p",provider,options)]);
  expect(submitVideoTask).toHaveBeenCalledTimes(1);
  expect(replicaForProject("p")).toMatchObject({taskId:"cloud-1",status:"unknown",compositionId:null});
  sqlite.close();openDB();
  vi.stubGlobal("fetch",vi.fn(async()=>new Response("video")));
  const task=replicaForProject("p")!;
  const outputs=await Promise.all([recoverReplica(task,provider),submitReplica("p",provider,options)]);
  expect(outputs[0].compositionId).toBe(outputs[1].compositionId);
  expect(submitVideoTask).toHaveBeenCalledTimes(1);
  const rows=db.select().from(schema.compositions).all();
  expect(rows).toHaveLength(1);
  expect(existsSync(rows[0].outputPath!)).toBe(true);
  expect(await listAiTasks("p",true)).toHaveLength(0);
});

it("does not resubmit when the provider acknowledgement is lost",async()=>{
  const submitVideoTask=vi.fn().mockRejectedValue(new Error("disconnected"));
  const provider={name:"fake",submitVideoTask,waitForTask:vi.fn()} as unknown as AIProvider;
  await expect(submitReplica("p",provider,options)).rejects.toThrow();
  sqlite.close();openDB();
  await expect(submitReplica("p",provider,options)).rejects.toThrow(/待确认/);
  expect(submitVideoTask).toHaveBeenCalledTimes(1);
  expect(() => attachReplicaTask("p","other","existing")).toThrow();
  const bound = attachReplicaTask("p","fake","existing");
  expect(bound.taskId).toBe("existing");
  expect(() => attachReplicaTask("p","fake","different")).toThrow();
  expect(submitVideoTask).toHaveBeenCalledTimes(1);
});

it.each([403,410])("refreshes a cached result URL after HTTP %i using the original provider task",async status=>{
  db.insert(schema.aiTasks).values({id:"existing",projectId:"p",purpose:"replicate",taskId:"original",provider:"fake",model:"m",status:"unknown",resultUrls:["https://example.invalid/expired"]}).run();
  const waitForTask=vi.fn().mockResolvedValue({status:"completed",result:{videoUrls:["https://example.invalid/fresh"]}});
  const submitVideoTask=vi.fn();
  const provider={name:"fake",waitForTask,submitVideoTask} as unknown as AIProvider;
  vi.stubGlobal("fetch",vi.fn(async (url:string)=>url.endsWith("expired")?new Response(null,{status}):new Response("complete video")));
  const result=await recoverReplica(replicaForProject("p")!,provider);
  expect(result.compositionId).toBe("existing");
  expect(submitVideoTask).not.toHaveBeenCalled();
  expect(waitForTask).toHaveBeenCalledWith("original",expect.anything());
  expect(await listAiTasks("p",true)).toHaveLength(0);
});

it("keeps a validated racing Windows destination and completes the original job",async()=>{
  const fs=await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(rename).mockImplementationOnce(async (from,to)=>{
    await fs.copyFile(from,to);
    throw Object.assign(new Error("destination is in use"), { code:"EPERM" });
  });
  vi.stubGlobal("fetch",vi.fn(async()=>new Response("complete video")));
  const provider={name:"fake",submitVideoTask:vi.fn().mockResolvedValue({taskId:"t",modelId:"m"}),
    waitForTask:vi.fn().mockResolvedValue({status:"completed",result:{videoUrls:["https://example.invalid/video"]}})} as unknown as AIProvider;
  await expect(submitReplica("p",provider,options)).resolves.toMatchObject({status:"completed"});
  expect(db.select().from(schema.compositions).all()).toHaveLength(1);
  expect(provider.submitVideoTask).toHaveBeenCalledTimes(1);
});

it("requires an explicit new project after a definite rejection and keeps the failed task for audit",async()=>{
  const submitVideoTask=vi.fn().mockRejectedValue(new ProviderError("invalid prompt","API_ERROR","fake",422));
  const provider={name:"fake",submitVideoTask,waitForTask:vi.fn()} as unknown as AIProvider;
  await expect(submitReplica("p",provider,options)).rejects.toMatchObject({code:"TASK_FAILED"});
  expect(replicaForProject("p")?.status).toBe("failed");
  await expect(submitReplica("p",provider,options)).rejects.toMatchObject({code:"TASK_FAILED"});
  expect(submitVideoTask).toHaveBeenCalledTimes(1);
});

it("regeneration retains prior owners; translation explicitly reuses the original footage", async()=>{
  const old=await (await save({scriptId:"A"})).json();
  const [newVariant]=appendScriptVariants("p",[{styleType:"scene",shots:[shot]}]);
  expect((await read("A"))[0].id).toBe(old.id);
  expect(await read(newVariant.id)).toHaveLength(0);
  const [dub]=appendScriptVariants("p",[{styleType:"custom",shots:[shot]}],"A");
  expect((await read(dub.id))[0]).toMatchObject({scriptId:dub.id,filePath:old.filePath});
  expect((await read(dub.id))[0].id).not.toBe(old.id);
  expect(db.select().from(schema.scripts).where(eq(schema.scripts.selected,true)).all().map(row=>row.id)).toEqual([dub.id]);
});
