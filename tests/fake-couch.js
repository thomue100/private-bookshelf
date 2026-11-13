// Nachgebildeter CouchDB-Server für die Tests (nur der Teil der API, den die App nutzt).
// Läuft im Testprozess; die Browser-Anfragen an COUCH_URL werden per Playwright-Route hierher umgeleitet.
// Verhalten wie CouchDB 3: Revisionen mit Konflikt-Prüfung (409), Anhänge mit md5-Digest, Stubs, _changes-Feed, Basic-Auth, CORS.
import { createHash } from "node:crypto";

export const COUCH_URL = "https://couch.test";

export class FakeCouch {
  constructor({ db = "buecherregal", user = "buecher", pass = "geheim", create = true } = {}) {
    this.dbName = db; this.user = user; this.pass = pass;
    this.exists = create; this.docs = new Map(); this.seq = 0; this.down = false; this.log = [];
  }
  /** In einem Browser-Kontext aktivieren. */
  async attach(context) { await context.route(COUCH_URL + "/**", r => this.handle(r)); }

  get docCount() { return this.docs.size; }
  doc(id) { const d = this.docs.get(id); return d && this.view(id, d); }

  view(id, d, inline = false) {
    const out = { _id: id, _rev: d.rev, ...d.body };
    const names = Object.keys(d.atts);
    if (names.length) out._attachments = Object.fromEntries(names.map(n => {
      const a = d.atts[n];
      return [n, inline ? { content_type: a.type, data: a.data.toString("base64"), digest: a.digest } : { content_type: a.type, digest: a.digest, length: a.data.length, revpos: 1, stub: true }];
    }));
    return out;
  }
  newRev(d) { const n = d ? +d.rev.split("-")[0] + 1 : 1; return `${n}-${createHash("md5").update(String(Math.random())).digest("hex")}`; }
  att(type, data) { return { type, data, digest: "md5-" + createHash("md5").update(data).digest("base64") }; }
  save(id, body, atts, prev) {
    const d = { rev: this.newRev(prev), body, atts, seq: ++this.seq };
    this.docs.set(id, d); return d;
  }

  async handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const cors = { "access-control-allow-origin": req.headers()["origin"] || "*", "access-control-allow-headers": "accept, authorization, content-type, origin, referer", "access-control-allow-methods": "GET, PUT, POST, DELETE, HEAD", "access-control-allow-credentials": "true" };
    if (this.down) return route.abort("connectionrefused");
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const reply = (status, body, extra = {}) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
    const auth = req.headers()["authorization"] || "";
    if (auth !== "Basic " + Buffer.from(`${this.user}:${this.pass}`).toString("base64")) return reply(401, { error: "unauthorized", reason: "Name or password is incorrect." });

    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const [db, id, attName] = parts;
    this.log.push(`${method} ${parts.join("/")}`);
    if (db !== this.dbName) return reply(404, { error: "not_found", reason: "Database does not exist." });
    if (!id) {
      if (method === "PUT") { if (this.exists) return reply(412, { error: "file_exists" }); this.exists = true; return reply(201, { ok: true }); }
      if (!this.exists) return reply(404, { error: "not_found", reason: "Database does not exist." });
      return reply(200, { db_name: db, doc_count: this.docs.size, update_seq: String(this.seq) });
    }
    if (!this.exists) return reply(404, { error: "not_found", reason: "Database does not exist." });

    if (id === "_changes") {
      const since = +(url.searchParams.get("since") || 0);
      const limit = +(url.searchParams.get("limit") || 1e9);
      const include = url.searchParams.get("include_docs") === "true";
      const rows = [...this.docs.entries()].filter(([, d]) => d.seq > since).sort((a, b) => a[1].seq - b[1].seq).slice(0, limit);
      const results = rows.map(([i, d]) => ({ seq: String(d.seq), id: i, changes: [{ rev: d.rev }], ...(include ? { doc: this.view(i, d) } : {}) }));
      return reply(200, { results, last_seq: String(rows.length ? rows[rows.length - 1][1].seq : (limit < 1e9 ? since : this.seq)), pending: 0 });
    }

    const cur = this.docs.get(id);
    if (attName) {
      if (method === "GET") {
        const a = cur?.atts[attName];
        if (!a) return reply(404, { error: "not_found", reason: "Document is missing attachment" });
        return route.fulfill({ status: 200, headers: { ...cors, "content-type": a.type }, body: a.data });
      }
      if (method === "PUT") {
        if (!cur || url.searchParams.get("rev") !== cur.rev) return reply(409, { error: "conflict", reason: "Document update conflict." });
        const atts = { ...cur.atts, [attName]: this.att(req.headers()["content-type"] || "application/octet-stream", req.postDataBuffer()) };
        const d = this.save(id, cur.body, atts, cur);
        return reply(201, { ok: true, id, rev: d.rev });
      }
    }
    if (method === "GET") {
      if (!cur) return reply(404, { error: "not_found", reason: "missing" });
      return reply(200, this.view(id, cur, url.searchParams.get("attachments") === "true"));
    }
    if (method === "PUT") {
      const { _id, _rev, _attachments, ...body } = JSON.parse(req.postDataBuffer().toString("utf8"));
      if ((cur && _rev !== cur.rev) || (!cur && _rev)) return reply(409, { error: "conflict", reason: "Document update conflict." });
      const atts = {};
      for (const [n, a] of Object.entries(_attachments || {})) {
        if (a.stub) { if (!cur?.atts[n]) return reply(412, { error: "missing_stub", reason: `Invalid attachment stub in ${id} for ${n}` }); atts[n] = cur.atts[n]; }
        else atts[n] = this.att(a.content_type, Buffer.from(a.data, "base64"));
      }
      const d = this.save(id, body, atts, cur);
      return reply(201, { ok: true, id, rev: d.rev });
    }
    return reply(405, { error: "method_not_allowed" });
  }
}
