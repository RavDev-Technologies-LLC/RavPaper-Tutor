import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Client, GENEROUS_LIMITS, resetDatabase, startServer, closePool, query, grantCredits, type TestServer } from "./harness.ts";
import { makeDocx, makePdf } from "../fixtures.ts";

let server: TestServer;
let jobs: typeof import("../../server/jobs.ts");
const calls: string[] = [];
let failEngine: { engine: string; times: number } | null = null;
let blockEngine: { engine: string; release: Promise<void> } | null = null;

before(async () => {
  await resetDatabase();
  jobs = await import("../../server/jobs.ts");
  jobs.setEngineRunner(async (engine, content, ctx) => {
    calls.push(engine);
    if (blockEngine?.engine === engine) await blockEngine.release;
    if (failEngine?.engine === engine && failEngine.times > 0) { failEngine.times--; throw new Error("engine down"); }
    if (engine === "plagiarism") return jobs.defaultEngineRunner(engine, content, ctx); // real similarity engine
    return { score: 80, summary: `${engine} ok`, findings: [{ text: "finding", suggestion: "fix", severity: "warning" }] };
  });
  server = await startServer({ authRateLimits: GENEROUS_LIMITS });
});
after(async () => { await server.close(); await closePool(); });
beforeEach(() => { calls.length = 0; failEngine = null; blockEngine = null; });

const body = "Chapter two reviews the literature on doctoral writing support and argues that structured feedback cycles improve completion rates across disciplines.";
const balance = async (id: string) => (await query(`select review_credits from users where id = $1`, [id]))[0].review_credits;
const job = async (id: number) => (await query(`select * from analysis_jobs where id = $1`, [id]))[0];
/** Run the worker until no job is queued or running (retries may be scheduled a few ms ahead). */
async function drain(owner?: string) {
  for (let i = 0; i < 200; i++) {
    if (await jobs.runWorkerOnce(owner)) continue;
    const [{ n }] = await query(`select count(*)::int n from analysis_jobs where status in ('queued', 'running')`);
    if (n === 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("worker did not drain");
}

async function user(name: string, credits = 0) {
  const c = new Client(server.url);
  const r = await c.register(name);
  if (credits) await grantCredits(r.data.user.id, credits);
  return { c, u: r.data.user };
}

test("upload extracts text from PDF and DOCX on the server and rejects spoofed files", async () => {
  const { c } = await user("uploader");
  const pdf = await c.upload("PDF chapter", "chapter.pdf", makePdf(body));
  assert.equal(pdf.status, 201);
  assert.match(pdf.data.fileContent, /structured feedback cycles/);
  assert.equal(pdf.data.metadata.extraction.format, "pdf");
  const docx = await c.upload("DOCX chapter", "chapter.docx", await makeDocx("Heading", body));
  assert.equal(docx.status, 201);
  assert.match(docx.data.fileContent, /Heading\s+Chapter two/);
  const spoof = await c.upload("Spoof", "evil.pdf", Buffer.from(body));
  assert.equal(spoof.status, 422);
  assert.equal(spoof.data.code, "signature_mismatch");
  assert.equal((await c.upload("Exe", "a.exe", Buffer.from(body))).status, 422);
  assert.equal((await c.upload("", "a.txt", body)).status, 400);
  assert.equal((await c.upload("Bad type", "a.txt", body, "novel")).status, 400);
  const big = await c.upload("Big", "big.txt", Buffer.alloc(21 * 1024 * 1024, 97));
  assert.equal(big.status, 413);
});

test("analysis runs as a job; the request returns 202 without running engines", async () => {
  const { c, u } = await user("runner", 1);
  const doc = await c.upload("Doc", "d.txt", body);
  const r = await c.req("POST", `/api/analysis/run/${doc.data.id}`, { json: { engines: ["plagiarism", "statistics"] } });
  assert.equal(r.status, 202);
  assert.equal(calls.length, 0);
  assert.equal(await balance(u.id), 0);
  assert.equal((await c.req("GET", `/api/analysis/jobs/${r.data.jobId}`)).data.status, "queued");
  await drain();
  const view = await c.req("GET", `/api/analysis/jobs/${r.data.jobId}`);
  assert.equal(view.data.status, "succeeded");
  assert.deepEqual(view.data.completedEngines.sort(), ["plagiarism", "statistics"]);
  const d = await c.req("GET", `/api/documents/${doc.data.id}`);
  assert.equal(d.data.status, "completed");
  const results = await c.req("GET", `/api/analysis/results/${doc.data.id}`);
  const sim = results.data.find((x: any) => x.engineType === "plagiarism");
  assert.equal(sim.results.method, "shingle_containment");
  assert.match(sim.results.summary, /Not checked against the web/);
  // Another user's job is invisible.
  const { c: other } = await user("snoop");
  assert.equal((await other.req("GET", `/api/analysis/jobs/${r.data.jobId}`)).status, 404);
});

test("similarity finds overlap with the user's own earlier document and hides other users' titles", async () => {
  const { c, u } = await user("reuser", 1);
  await c.upload("My Draft One", "one.txt", `${body} Additional unique sentence about cohort design.`);
  // A second member of the same organization with a matching submission.
  const [peer] = await query(`insert into users (tenant_id, username, email, password, full_name) values ($1, 'peer', 'peer@example.com', 'x', 'Peer') returning id`, [u.tenantId]);
  await query(`insert into documents (tenant_id, user_id, title, submission_type, file_name, file_content) values ($1, $2, 'Peer Secret Title', 'dissertation', 'p.txt', $3)`, [u.tenantId, peer.id, body]);
  const doc = await c.upload("Second", "two.txt", `Opening remarks. ${body}`);
  const r = await c.req("POST", `/api/analysis/run/${doc.data.id}`, { json: { engines: ["plagiarism"] } });
  await drain();
  assert.equal((await job(r.data.jobId)).status, "succeeded");
  const [res] = (await c.req("GET", `/api/analysis/results/${doc.data.id}`)).data;
  assert.ok(res.score < 50, `score ${res.score}`);
  const labels = res.results.matchedSources.map((m: any) => m.label);
  assert.ok(labels.includes('your document "My Draft One"'));
  assert.ok(labels.includes("another submission in your organization"));
  assert.ok(!JSON.stringify(res.results).includes("Peer Secret Title"));
});

test("worker crash: an expired lease is reclaimed and completed engines are not re-run", async () => {
  const { c } = await user("crash", 1);
  const doc = await c.upload("Crash", "c.txt", body);
  const r = await c.req("POST", `/api/analysis/run/${doc.data.id}`, { json: { engines: ["statistics", "formatting"] } });
  const id = r.data.jobId;

  // Worker A claims the job, finishes "statistics", then dies (simulated by abandoning it).
  const claimed = await jobs.claimJob("worker-A");
  assert.equal(claimed!.id, id);
  await query(`insert into analysis_results (tenant_id, document_id, engine_type, status, score, results, job_id) select tenant_id, document_id, 'statistics', 'completed', 70, '{"score":70}', id from analysis_jobs where id = $1`, [id]);
  assert.equal(await jobs.runWorkerOnce("worker-B"), false, "lease still held");
  await query(`update analysis_jobs set lease_expires_at = now() - interval '1 second' where id = $1`, [id]);

  await jobs.runWorkerOnce("worker-B");
  const j = await job(id);
  assert.equal(j.status, "succeeded");
  assert.equal(j.attempts, 2);
  assert.deepEqual(calls, ["formatting"], "statistics checkpoint reused");
});

test("transient failures retry with backoff; final failure refunds exactly once", async () => {
  const { c, u } = await user("flaky", 2);
  const doc = await c.upload("Flaky", "f.txt", body);
  failEngine = { engine: "statistics", times: 1 };
  const r1 = await c.req("POST", `/api/analysis/run/${doc.data.id}`, { json: { engines: ["statistics"] } });
  await drain();
  assert.equal((await job(r1.data.jobId)).status, "succeeded");
  assert.equal((await job(r1.data.jobId)).attempts, 2);
  assert.equal(await balance(u.id), 1);

  failEngine = { engine: "statistics", times: 99 };
  const r2 = await c.req("POST", `/api/analysis/run/${doc.data.id}`, { json: { engines: ["statistics"] } });
  await drain();
  const j = await job(r2.data.jobId);
  assert.equal(j.status, "failed");
  assert.equal(j.attempts, 3);
  assert.equal(await balance(u.id), 1, "credit refunded");
  const refunds = await query(`select count(*)::int n from credit_transactions where user_id = $1 and type = 'refund'`, [u.id]);
  assert.equal(refunds[0].n, 1);
  // Earlier successful results survive a failed re-run.
  assert.equal((await c.req("GET", `/api/documents/${doc.data.id}`)).data.status, "failed");
  assert.equal((await c.req("GET", `/api/analysis/results/${doc.data.id}`)).data.length, 1);
});

test("cancellation: queued jobs refund immediately; running jobs stop at the next checkpoint", async () => {
  const { c, u } = await user("canceller", 2);
  const doc = await c.upload("Cancel", "x.txt", body);
  const r1 = await c.req("POST", `/api/analysis/run/${doc.data.id}`, { json: { engines: ["statistics"] } });
  const cancel = await c.req("POST", `/api/analysis/jobs/${r1.data.jobId}/cancel`);
  assert.equal(cancel.status, 202);
  assert.equal(cancel.data.status, "cancelled");
  assert.equal(await balance(u.id), 2);
  assert.equal((await c.req("POST", `/api/analysis/jobs/${r1.data.jobId}/cancel`)).status, 409);

  let release!: () => void;
  blockEngine = { engine: "statistics", release: new Promise((r) => { release = r; }) };
  const r2 = await c.req("POST", `/api/analysis/run/${doc.data.id}`, { json: { engines: ["statistics", "formatting"] } });
  const running = jobs.runWorkerOnce("worker-C");
  for (let i = 0; (await job(r2.data.jobId)).status !== "running"; i++) {
    assert.ok(i < 200, "job never started");
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal((await c.req("POST", `/api/analysis/jobs/${r2.data.jobId}/cancel`)).data.status, "cancelling");
  // Deletion is refused while the job is active.
  assert.equal((await c.req("DELETE", `/api/documents/${doc.data.id}`)).status, 409);
  await new Promise((r) => setTimeout(r, 1200)); // allow a heartbeat to observe the flag
  release();
  await running;
  const j = await job(r2.data.jobId);
  assert.equal(j.status, "cancelled");
  assert.ok(!calls.includes("formatting"));
  assert.equal(await balance(u.id), 2);
  assert.equal((await c.req("GET", `/api/documents/${doc.data.id}`)).data.status, "pending");
});

test("deleting an analyzed document removes derived data, keeps the ledger and audits atomically", async () => {
  const { c, u } = await user("deleter", 1);
  const doc = await c.upload("Delete me", "d.txt", body);
  const id = doc.data.id;
  await c.req("POST", `/api/analysis/run/${id}`, { json: { engines: ["statistics", "formatting"] } });
  await drain();
  await query(`insert into defense_sessions (tenant_id, document_id, user_id, questions, answers, status) values ($1, $2, $3, '[]', '[]', 'active')`, [u.tenantId, id, u.id]);
  assert.ok((await query(`select count(*)::int n from annotations where document_id = $1`, [id]))[0].n > 0);

  assert.equal((await c.req("DELETE", `/api/documents/${id}`)).status, 204);
  for (const t of ["documents", "analysis_results", "annotations", "defense_sessions", "analysis_jobs"]) {
    const col = t === "documents" ? "id" : "document_id";
    assert.equal((await query(`select count(*)::int n from ${t} where ${col} = $1`, [id]))[0].n, 0, t);
  }
  const ledger = await query(`select document_id from credit_transactions where user_id = $1 and type = 'usage'`, [u.id]);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].document_id, null);
  const [audit] = await query(`select details from audit_logs where action = 'document_deleted' and resource_id = $1`, [String(id)]);
  assert.equal(audit.details.results, 2);
  assert.equal(audit.details.defense_sessions, 1);
  assert.equal((await c.req("DELETE", `/api/documents/${id}`)).status, 404);
});
