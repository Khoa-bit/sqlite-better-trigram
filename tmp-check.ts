import { Database } from "bun:sqlite";

const db = new Database(":memory:");
try {
  db.loadExtension("./dist/fts5.dll");
} catch {}
db.loadExtension("./dist/better-trigram.dll");

let n = 0;
function probe(mode: string, text: string, query: string) {
  const t = `p${n++}`;
  db.query(
    `CREATE VIRTUAL TABLE ${t} USING fts5(y, tokenize='better_trigram remove_diacritics ${mode}')`
  ).run();
  db.query(`INSERT INTO ${t} VALUES($v)`).run({ $v: text });
  const rows = db
    .query(`SELECT count(*) c FROM ${t} WHERE y MATCH $q`)
    .get({ $q: query }) as { c: number };
  console.log(
    `${mode}  ${JSON.stringify(text)} -> ${JSON.stringify(query)} : ${
      rows.c ? "MATCH" : "no-match"
    }`
  );
}

for (const mode of ["1", "2"]) {
  probe(mode, "tørv", "tor");
  probe(mode, "đức", "duc");
  probe(mode, "ħaba", "hab");
  probe(mode, "alıntıdır", "ali");
  probe(mode, "łódź", "lod");
  probe(mode, "Đại", "dai");
  probe(mode, "mới", "moi");
}
