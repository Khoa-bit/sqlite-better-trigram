/*
 ** 2024-10-21
 **
 ** The author disclaims copyright to this source code.  In place of
 ** a legal notice, here is a blessing:
 **
 **    May you do good and not evil.
 **    May you find forgiveness for yourself and forgive others.
 **    May you share freely, never taking more than you give.
 **
 */
// to run: bun test

import { Database } from "bun:sqlite";
import { test, describe, expect, afterAll, beforeAll } from "bun:test";

const EXT =
  process.platform === "win32"
    ? ".dll"
    : process.platform === "darwin"
    ? ".dylib"
    : ".so";

if (process.platform === "darwin" && process.env.SQLITE_LIB_PATH)
  Database.setCustomSQLite(process.env.SQLITE_LIB_PATH);

function initDatabase() {
  const db = new Database(":memory:");
  try {
    db.loadExtension(`./dist/fts5${EXT}`);
  } catch {
    // FTS5 may be compiled into SQLite already; skip standalone load
  }
  db.loadExtension(`./dist/better-trigram${EXT}`);
  return db;
}

describe("remove_diacritics", () => {
  describe("v1", () => {
    const db = initDatabase();
    afterAll(() => db.close());

    test("1.0", () => {
      [
        `CREATE VIRTUAL TABLE t1 USING fts5(y, tokenize='better_trigram remove_diacritics 1');`,
        `INSERT INTO t1 VALUES('abc\u0303defghijklm');`,
        `INSERT INTO t1 VALUES('a\u0303b\u0303c\u0303defghijklm');`,
      ].forEach((stmt) => db.query(stmt).run());
    });

    sqlTest(
      db,
      `1.1`,
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('abc');`,
      [],
      ["(abc\u0303)defghijklm", "(a\u0303b\u0303c\u0303)defghijklm"]
    );

    sqlTest(
      db,
      `1.2`,
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('bcde');`,
      [],
      ["a(bc\u0303de)fghijklm", "a\u0303(b\u0303c\u0303de)fghijklm"]
    );

    sqlTest(
      db,
      `1.3`,
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('cdef');`,
      [],
      ["ab(c\u0303def)ghijklm", "a\u0303b\u0303(c\u0303def)ghijklm"]
    );

    sqlTest(
      db,
      `1.4`,
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('def');`,
      [],
      ["abc\u0303(def)ghijklm", "a\u0303b\u0303c\u0303(def)ghijklm"]
    );
  });

  describe("v2", () => {
    const db = initDatabase();
    afterAll(() => db.close());

    test("2.0", () => {
      expect(() =>
        db
          .query(
            `CREATE VIRTUAL TABLE t2 USING fts5(
    z, tokenize='better_trigram case_sensitive 1 remove_diacritics 1'
);`
          )
          .run()
      ).toThrowError(/error in tokenizer constructor/g);
    });

    test("2.1", () => {
      expect(() =>
        db
          .query(
            `CREATE VIRTUAL TABLE t2 USING fts5(
    z, tokenize='better_trigram case_sensitive 0 remove_diacritics 1'
);`
          )
          .run()
      ).not.toThrowError();
    });

    test("2.2", () => {
      [
        `INSERT INTO t2 VALUES('\u00E3bcdef');`,
        `INSERT INTO t2 VALUES('b\u00E3cdef');`,
        `INSERT INTO t2 VALUES('bc\u00E3def');`,
        `INSERT INTO t2 VALUES('bcd\u00E3ef');`,
      ].forEach((stmt) =>
        expect(db.prepare(stmt).run().changes).toBeGreaterThan(0)
      );
    });

    sqlTest(
      db,
      "2.3",
      `SELECT highlight(t2, 0, '(', ')') as res FROM t2('abc');`,
      [],
      "(\u00E3bc)def"
    );

    sqlTest(
      db,
      "2.4",
      `SELECT highlight(t2, 0, '(', ')') as res FROM t2('bac');`,
      [],
      "(b\u00E3c)def"
    );

    sqlTest(
      db,
      "2.5",
      `SELECT highlight(t2, 0, '(', ')') as res FROM t2('bca');`,
      [],
      "(bc\u00E3)def"
    );

    sqlTest(
      db,
      "2.6",
      `SELECT highlight(t2, 0, '(', ')') as res FROM t2('\u00E3bc');`,
      [],
      "(\u00E3bc)def"
    );
  });

  describe("v3", () => {
    const db = initDatabase();
    afterAll(() => db.close());

    test("3.0", () => {
      expect(() =>
        db
          .query(
            `CREATE VIRTUAL TABLE t3 USING fts5(
      z, tokenize='better_trigram remove_diacritics 1'
);`
          )
          .run()
      ).not.toThrowError();
    });

    test("3.1", () => {
      expect(
        db.prepare(`INSERT INTO t3 VALUES ('\u0303abc\u0303');`).run().changes
      ).toBeGreaterThan(0);
    });

    sqlTest(
      db,
      "3.2",
      `SELECT highlight(t3, 0, '(', ')') as res FROM t3('abc');`,
      [],
      "\u0303(abc\u0303)"
    );
  });

  describe("v4", () => {
    const db = initDatabase();
    afterAll(() => db.close());

    test("4.0", () => {
      expect(() =>
        db
          .query(
            `CREATE VIRTUAL TABLE t4 USING fts5(z, tokenize=better_trigram);`
          )
          .run()
      ).not.toThrowError();
    });

    test("4.1", () => {
      [
        `INSERT INTO t4 VALUES('ABCD');`,
        `INSERT INTO t4 VALUES('DEFG');`,
      ].forEach((stmt) =>
        expect(db.prepare(stmt).run().changes).toBeGreaterThan(0)
      );
    });

    explainQueryPlanTest(
      db,
      "4.2",
      `SELECT rowid FROM t4 WHERE z LIKE '%abc%'`,
      [],
      "SCAN t4 VIRTUAL TABLE INDEX 0:"
      // TODO: "VIRTUAL TABLE INDEX 0:L0"
    );

    sqlTest(
      db,
      "4.3",
      `SELECT rowid as res FROM t4 WHERE z LIKE '%abc%'`,
      [],
      1
    );
  });

  describe("v5", () => {
    const db = initDatabase();
    afterAll(() => db.close());

    test("5.0", () => {
      expect(() =>
        db
          .query(
            `CREATE VIRTUAL TABLE t5 USING fts5(
      c1, tokenize='better_trigram', detail='none'
  );`
          )
          .run()
      ).not.toThrowError();

      [
        `INSERT INTO t5(rowid, c1) VALUES(1, 'abc_____xyx_yxz');`,
        `INSERT INTO t5(rowid, c1) VALUES(2, 'abc_____xyxz');`,
        `INSERT INTO t5(rowid, c1) VALUES(3, 'ac_____xyxz');`,
      ].forEach((stmt) =>
        expect(db.prepare(stmt).run().changes).toBeGreaterThan(0)
      );
    });

    sqlTest(
      db,
      "5.1",
      `SELECT rowid as res FROM t5 WHERE c1 LIKE 'abc%xyxz'`,
      [],
      2
    );
  });
});

// ──────────────────────────────────────────────
// Custom diacritic patch chars
// ──────────────────────────────────────────────
describe("custom diacritic patch", () => {
  const db = initDatabase();
  afterAll(() => db.close());

  test("0.0", () => {
    [
      `CREATE VIRTUAL TABLE t0 USING fts5(y, tokenize='better_trigram remove_diacritics 1');`,
      // ø→o, đ→d, ħ→h, ı→i, ł→l, ư→u via NFD
      `INSERT INTO t0 VALUES('tørv er godt')`,
      `INSERT INTO t0 VALUES('đức tính tốt')`,
      `INSERT INTO t0 VALUES('ħaba ma sens')`,
      `INSERT INTO t0 VALUES('bu alıntıdır')`,
      `INSERT INTO t0 VALUES('łódź jest super')`,
      `INSERT INTO t0 VALUES('cửa sổ mới')`,
      `INSERT INTO t0 VALUES('Đại dương xanh thẳm')`,
    ].forEach((stmt) => db.query(stmt).run());
  });

  // ── MATCH search ──

  sqlTest(
    db,
    "0.1",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('tor')`,
    [],
    "(tør)v er godt"
  );

  sqlTest(
    db,
    "0.2",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('duc')`,
    [],
    "(đức) tính tốt"
  );

  sqlTest(
    db,
    "0.3",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('hab')`,
    [],
    "(ħab)a ma sens"
  );

  sqlTest(
    db,
    "0.4",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('ali')`,
    [],
    "bu (alı)ntıdır"
  );

  sqlTest(
    db,
    "0.5",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('lod')`,
    [],
    "(łód)ź jest super"
  );

  sqlTest(
    db,
    "0.6",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('moi')`,
    [],
    "cửa sổ (mới)"
  );

  sqlTest(
    db,
    "0.7",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('dai')`,
    [],
    "(Đại) dương xanh thẳm"
  );

  // ── original diacritics also match ──

  sqlTest(
    db,
    "0.8",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('tørv')`,
    [],
    "(tørv) er godt"
  );

  sqlTest(
    db,
    "0.9",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('łódź')`,
    [],
    "(łódź) jest super"
  );

  sqlTest(
    db,
    "0.10",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('đức')`,
    [],
    "(đức) tính tốt"
  );

  // ── case-insensitive: uppercase query matches folded text ──

  sqlTest(
    db,
    "0.11",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('TOR')`,
    [],
    "(tør)v er godt"
  );

  sqlTest(
    db,
    "0.12",
    `SELECT highlight(t0, 0, '(', ')') as res FROM t0('DAI')`,
    [],
    "(Đại) dương xanh thẳm"
  );

  // ── LIKE with original diacritics (byte-level, uses trigram index) ──

  sqlTest(db, "0.13", `SELECT rowid as res FROM t0 WHERE y LIKE '%tørv%'`, [], 1);
  sqlTest(db, "0.14", `SELECT rowid as res FROM t0 WHERE y LIKE '%łódź%'`, [], 5);
  sqlTest(db, "0.15", `SELECT rowid as res FROM t0 WHERE y LIKE '%Đại%'`, [], 7);

  // ── remove_diacritics 2 ──

  describe("level 2", () => {
    const db2 = initDatabase();
    afterAll(() => db2.close());

    test("1.0", () => {
      [
        `CREATE VIRTUAL TABLE t1 USING fts5(y, tokenize='better_trigram remove_diacritics 2');`,
        `INSERT INTO t1 VALUES('tørv er godt')`,
        `INSERT INTO t1 VALUES('ħaba ma sens')`,
        `INSERT INTO t1 VALUES('bu alıntıdır')`,
        `INSERT INTO t1 VALUES('łódź jest super')`,
        `INSERT INTO t1 VALUES('Đại dương xanh thẳm')`,
      ].forEach((stmt) => db2.query(stmt).run());
    });

    sqlTest(
      db2,
      "1.1",
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('tor')`,
      [],
      "(tør)v er godt"
    );

    sqlTest(
      db2,
      "1.2",
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('hab')`,
      [],
      "(ħab)a ma sens"
    );

    sqlTest(
      db2,
      "1.3",
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('ali')`,
      [],
      "bu (alı)ntıdır"
    );

    sqlTest(
      db2,
      "1.4",
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('lod')`,
      [],
      "(łód)ź jest super"
    );

    sqlTest(
      db2,
      "1.5",
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('dai')`,
      [],
      "(Đại) dương xanh thẳm"
    );
  });
});

describe("case_sensitive", () => {
  describe("v1", () => {

    const db = initDatabase();

    test("1.0", () => {
      [
        `CREATE VIRTUAL TABLE t1 USING fts5(y, tokenize = 'better_trigram');`,
        `INSERT INTO t1 VALUES('abcdefghijklm')`,
        `INSERT INTO t1 VALUES('กรุงเทพมหานคร');`,
      ].forEach((stmt) => db.query(stmt).run());
    });

    [
      ["abc", "(abc)defghijklm"],
      ["defgh", "abc(defgh)ijklm"],
      ["abcdefghijklm", "(abcdefghijklm)"],
      ["กรุ", "(กรุ)งเทพมหานคร"],
      ["งเทพมห", "กรุ(งเทพมห)านคร"],
      ["กรุงเทพมหานคร", "(กรุงเทพมหานคร)"],
      ["Abc", "(abc)defghijklm"],
      ["deFgh", "abc(defgh)ijklm"],
      ["aBcdefGhijKlm", "(abcdefghijklm)"],
    ].forEach((testCase, index) => {
      sqlTest(
        db,
        `1.1.${index + 1}`,
        `SELECT highlight(t1, 0, '(', ')') as res FROM t1(?)`,
        [testCase[0]!],
        testCase[1]
      );
    });

    sqlTest(
      db,
      `1.2.0`,
      `SELECT fts5_expr('ABCD', 'tokenize=better_trigram') as res`,
      [],
      `"abc" + "bcd"`
    );

    sqlTest(
      db,
      `1.2.1`,
      `SELECT fts5_expr('foo\nbar', 'tokenize=better_trigram') as res`,
      [],
      `"foo" AND "bar"`
    );

    (
      [
        ["%cDef%", 1],
        ["cDef%", undefined],
        ["%f%", 1],
        ["%f_h%", 1],
        ["%f_g%", undefined],
        ["abc%klm", 1],
        ["ABCDEFG%", 1],
        ["%รุงเ%", 2],
        ["%งเ%", 2],
      ] as const
    ).forEach((testCase, index) => {
      sqlTest(
        db,
        `1.3.${index + 1}`,
        `SELECT rowid as res FROM t1 WHERE y LIKE ?`,
        [testCase[0]],
        testCase[1]
      );
    });
  });

  describe("v2", () => {
    const db = initDatabase();

    test("2.0", () => {
      [
        `CREATE VIRTUAL TABLE t1 USING fts5(y, tokenize = 'better_trigram case_sensitive 1');`,
        `INSERT INTO t1 VALUES('abcdefghijklm')`,
        `INSERT INTO t1 VALUES('กรุงเทพมหานคร');`,
      ].forEach((stmt) => db.query(stmt).run());
    });

    (
      [
        ["abc", "(abc)defghijklm"],
        ["defgh", "abc(defgh)ijklm"],
        ["abcdefghijklm", "(abcdefghijklm)"],
        ["กรุ", "(กรุ)งเทพมหานคร"],
        ["งเทพมห", "กรุ(งเทพมห)านคร"],
        ["กรุงเทพมหานคร", "(กรุงเทพมหานคร)"],
        ["Abc", undefined],
        ["deFgh", undefined],
        ["aBcdefGhijKlm", undefined],
      ] as const
    ).forEach((testCase, index) => {
      sqlTest(
        db,
        `2.1.${index + 1}`,
        `SELECT highlight(t1, 0, '(', ')') as res FROM t1(?)`,
        [testCase[0]],
        testCase[1]
      );
    });

    (
      [
        ["%cDef%", 1],
        ["cDef%", undefined],
        ["%f%", 1],
        ["%f_h%", 1],
        ["%f_g%", undefined],
        ["abc%klm", 1],
        ["ABCDEFG%", 1],
        ["%รุงเ%", 2],
      ] as const
    ).forEach((testCase, index) => {
      sqlTest(
        db,
        `2.2.${index + 1}`,
        `SELECT rowid as res FROM t1 WHERE y LIKE ?`,
        [testCase[0]],
        testCase[1]
      );
    });

    (
      [
        ["*cdef*", 1],
        ["cdef*", undefined],
        ["*f*", 1],
        ["*f?h*", 1],
        ["*f?g*", undefined],
        ["abc*klm", 1],
        ["abcdefg*", 1],
        ["*รุงเ*", 2],
        ["abc[d]efg*", 1],
        ["abc[]d]efg*", 1],
        ["abc[^]d]efg*", undefined],
        ["abc[^]XYZ]efg*", 1],
      ] as const
    ).forEach((testCase, index) => {
      sqlTest(
        db,
        `2.3.${index + 1}`,
        `SELECT rowid as res FROM t1 WHERE y GLOB ?`,
        [testCase[0]],
        testCase[1]
      );
    });

    sqlTest(
      db,
      "2.3.null.1",
      `SELECT rowid FROM t1 WHERE y LIKE NULL`,
      [],
      undefined
    );
  });

  describe("v3", () => {
    const db = initDatabase();

    test("3.0", () => {
      expect(() =>
        db
          .query(
            `CREATE VIRTUAL TABLE ttt USING fts5(c, tokenize="better_trigram case_sensitive 2")`
          )
          .run()
      ).toThrow(/error in tokenizer constructor/g);
    });

    test("3.1", () => {
      expect(() =>
        db
          .query(
            `CREATE VIRTUAL TABLE ttt USING fts5(c, tokenize="better_trigram case_sensitive 11")`
          )
          .run()
      ).toThrow(/error in tokenizer constructor/g);
    });

    test("3.2", () => {
      expect(() =>
        db
          .query(
            `CREATE VIRTUAL TABLE ttt USING fts5(c, tokenize="better_trigram case_sensitive 1")`
          )
          .run()
      ).not.toThrow();
    });
  });

  describe("v4", () => {
    const db = initDatabase();

    test("4.0", () => {
      expect(
        db
          .query(
            `CREATE VIRTUAL TABLE t0 USING fts5(b, tokenize = "better_trigram");`
          )
          .run().changes
      ).toBeGreaterThan(0);
    });

    test("4.1", () => {
      expect(
        db.query(`INSERT INTO t0 VALUES (x'000b01');`).run().changes
      ).toBeGreaterThan(0);
    });

    test("4.2", () => {
      expect(
        db.query(`INSERT INTO t0(t0) VALUES('integrity-check');`).run().changes
      ).toBeGreaterThan(0);
    });
  });

  describe("v5", () => {
    for (const detailMode of ["full", "col", "none"]) {
      for (const flag of [0, 1]) {
        const db = initDatabase();

        test(`5.cs=${flag}.0.1 (${detailMode})`, () => {
          expect(
            db
              .prepare(
                `CREATE VIRTUAL TABLE t1 USING fts5(
              y, tokenize="better_trigram case_sensitive ${flag}", detail=${detailMode}
          );`
              )
              .run().changes
          ).toBeGreaterThan(0);
        });

        test(`5.cs=${flag}.0.2 (${detailMode})`, () => {
          [
            `INSERT INTO t1 VALUES('abcdefghijklm');`,
            `INSERT INTO t1 VALUES('กรุงเทพมหานคร');`,
          ].forEach((stmt) => {
            expect(db.prepare(stmt).run().changes).toBeGreaterThan(0);
          });
        });

        (
          [
            ["%cDef%", 1],
            ["cDef%", undefined],
            ["%f%", 1],
            ["%f_h%", 1],
            ["%f_g%", undefined],
            ["abc%klm", 1],
            ["ABCDEFG%", 1],
            ["%รุงเ%", 2],
          ] as const
        ).forEach((testCase, index) => {
          sqlTest(
            db,
            `5.cs=${flag}.1.${index + 1} (${detailMode})`,
            `SELECT rowid as res FROM t1 WHERE y LIKE ?`,
            [testCase[0]],
            testCase[1]
          );
        });
      }
    }
  });

  describe("v6", () => {
    const db = initDatabase();

    test("6.0", () => {
      [
        `CREATE VIRTUAL TABLE ci0 USING fts5(x, tokenize="better_trigram");`,
        `CREATE VIRTUAL TABLE ci1 USING fts5(x, tokenize="better_trigram case_sensitive 1");`,
      ].forEach((stmt) =>
        expect(db.prepare(stmt).run().changes).toBeGreaterThan(0)
      );
    });

    explainQueryPlanTest(
      db,
      "6.1",
      `SELECT * FROM ci0 WHERE x LIKE '??'`,
      [],
      "SCAN ci0 VIRTUAL TABLE INDEX 0:"
      // TODO: "VIRTUAL TABLE INDEX 0:L0"
    );

    explainQueryPlanTest(
      db,
      "6.2",
      `SELECT * FROM ci0 WHERE x GLOB '??'`,
      [],
      "SCAN ci0 VIRTUAL TABLE INDEX 0:"
      // TODO: "VIRTUAL TABLE INDEX 0:G0"
    );

    explainQueryPlanTest(
      db,
      "6.3",
      `SELECT * FROM ci1 WHERE x LIKE '??'`,
      [],
      "SCAN ci1 VIRTUAL TABLE INDEX 0:"
    );

    explainQueryPlanTest(
      db,
      "6.4",
      `SELECT * FROM ci1 WHERE x GLOB '??'`,
      [],
      "SCAN ci1 VIRTUAL TABLE INDEX 0:"
      // TODO: "VIRTUAL TABLE INDEX 0:G0"
    );
  });

  describe("v7", () => {
    const db = initDatabase();

    test("7.0", () => {
      [
        `CREATE VIRTUAL TABLE f USING FTS5(filename, tokenize="better_trigram");`,
        `INSERT INTO f (rowid, filename) VALUES
          (10, 'giraffe.png'),
          (20, 'жираф.png'),
          (30, 'cat.png'),
          (40, 'кот.png'),
          (50, 'misic-🎵-.mp3');`,
      ].forEach((stmt) =>
        expect(db.prepare(stmt).run().changes).toBeGreaterThan(0)
      );
    });

    sqlTest(
      db,
      "7.1",
      `SELECT rowid as res FROM f WHERE +filename GLOB '*ир*';`,
      [],
      20
    );

    sqlTest(
      db,
      "7.2",
      `SELECT rowid as res FROM f WHERE filename GLOB '*ир*';`,
      [],
      20
    );
  });

  describe("v8", () => {
    const db = initDatabase();

    test("8.0", () => {
      [
        `CREATE VIRTUAL TABLE t1 USING fts5(y, tokenize = 'better_trigram');`,
        `INSERT INTO t1 VALUES('abcdefghijklm')`,
      ].forEach((stmt) =>
        expect(db.prepare(stmt).run().changes).toBeGreaterThan(0)
      );
    });

    [
      ["abc ghi", "(abc)def(ghi)jklm"],
      ["def ghi", "abc(defghi)jklm"],
      ["efg ghi", "abcd(efghi)jklm"],
      ["efghi", "abcd(efghi)jklm"],
      ["abcd jklm", "(abcd)efghi(jklm)"],
      ["ijkl jklm", "abcdefgh(ijklm)"],
      ["ijk ijkl hijk", "abcdefg(hijkl)m"],
    ].forEach((testCase, index) => {
      sqlTest(
        db,
        `8.1.${index + 1}`,
        `SELECT highlight(t1, 0, '(', ')') as res FROM t1(?)`,
        [testCase[0]!],
        testCase[1]
      );
    });

    test("8.2", () => {
      [
        `CREATE VIRTUAL TABLE ft2 USING fts5(a, tokenize="better_trigram");`,
        `INSERT INTO ft2 VALUES('abc x cde');`,
        `INSERT INTO ft2 VALUES('abc cde');`,
        `INSERT INTO ft2 VALUES('abcde');`,
      ].forEach((stmt) =>
        expect(db.prepare(stmt).run().changes).toBeGreaterThan(0)
      );
    });

    test("8.3", () => {
      const expected = ["[abc] x [cde]", "[abc] [cde]", "[abcde]"];
      db.prepare(
        `SELECT highlight(ft2, 0, '[', ']') as res FROM ft2 WHERE ft2 MATCH 'abc AND cde';`
      )
        .all()
        .forEach((result, i) => {
          expect((result as { res: string }).res).toBe(expected[i]!);
        });
    });
  });

  describe("v9", () => {
    const db = initDatabase();

    test("9.0", () => {
      [
        `CREATE VIRTUAL TABLE t1 USING fts5(
          a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, 
          tokenize=better_trigram
        );`,
        `INSERT INTO t1(rowid, a12) VALUES(111, 'thats a tricky case though');`,
        `INSERT INTO t1(rowid, a12) VALUES(222, 'the query planner cannot do');`,
      ].forEach((stmt) =>
        expect(db.prepare(stmt).run().changes).toBeGreaterThan(0)
      );
    });

    sqlTest(
      db,
      "9.1",
      `SELECT rowid as res FROM t1 WHERE a12 LIKE '%tricky%'`,
      [],
      111
    );

    sqlTest(
      db,
      "9.2",
      `SELECT rowid as res FROM t1 WHERE a12 LIKE '%tricky%' AND a12 LIKE '%case%'`,
      [],
      111
    );

    sqlTest(
      db,
      "9.3",
      `SELECT rowid as res FROM t1 WHERE a12 LIKE NULL`,
      [],
      undefined
    );
  });

  describe("v10", () => {
    const db = initDatabase();

    test("10.0", () => {
      [`CREATE VIRTUAL TABLE t1 USING fts5(a, tokenize=trigram);`].forEach(
        (stmt) => expect(db.prepare(stmt).run().changes).toBeGreaterThan(0)
      );
    });

    test("10.1", () => {
      [
        `"abc UFFjklUFF"`,
        `"abc UFFFjklUFFF"`,
        `"abc UFFFFjklUFFFF"`,
        `"abc UFFFFFjklUFFFFF"`,
        `"UFFjklUFF abc"`,
        `"UFFFjklUFFF abc"`,
        `"UFFFFjklUFFFF abc"`,
        `"UFFFFFjklUFFFFF abc"`,
        `"U10001jklU10001 abc"`,
      ].forEach((val) => db.query(`INSERT INTO t1 VALUES( ${val} ) `).run());
    });

    test("10.2", () => {
      [
        `X'E18000626320646566'`,
        `X'61EDA0806320646566'`,
        `X'61EDA0806320646566'`,
        `X'61EFBFBE6320646566'`,
        `X'76686920E18000626320646566'`,
        `X'7668692061EDA0806320646566'`,
        `X'7668692061EDA0806320646566'`,
        `X'7668692061EFBFBE6320646566'`,
      ].forEach((val) => db.query(`INSERT INTO t1 VALUES( ${val} ) `).run());
    });

    test("10.3", () => {
      const a = Buffer.from([0x61, 0xf7, 0xbf, 0xbf, 0xbf, 0x62]).toString(
        "utf-8"
      );
      const b = Buffer.from([
        0x61, 0xf7, 0xbf, 0xbf, 0xbf, 0xbf, 0x62,
      ]).toString("utf-8");
      const c = Buffer.from([
        0x61, 0xf7, 0xbf, 0xbf, 0xbf, 0xbf, 0xbf, 0x62,
      ]).toString("utf-8");
      const d = Buffer.from([
        0x61, 0xf7, 0xbf, 0xbf, 0xbf, 0xbf, 0xbf, 0xbf, 0x62,
      ]).toString("utf-8");

      [
        `INSERT INTO t1 VALUES('${a}');`,
        `INSERT INTO t1 VALUES('${b}');`,
        `INSERT INTO t1 VALUES('${c}');`,
        `INSERT INTO t1 VALUES('${d}');`,

        `INSERT INTO t1 VALUES('abcd' || '${a}');`,
        `INSERT INTO t1 VALUES('abcd' || '${b}');`,
        `INSERT INTO t1 VALUES('abcd' || '${c}');`,
        `INSERT INTO t1 VALUES('abcd' || '${d}');`,
      ].forEach((val) => {
        db.query(val).run();
      });
    });
  });
});

describe("cjk", () => {
  const db = initDatabase();
  afterAll(() => db.close());

  test("1.0", () => {
    [
      `CREATE VIRTUAL TABLE t1 USING fts5(y, tokenize='better_trigram remove_diacritics 1');`,
      `INSERT INTO t1 VALUES('苹果：这是什么？');`,
      `INSERT INTO t1 VALUES('西瓜：这是书。');`,
      `INSERT INTO t1 VALUES('苹果：那是什么？');`,
      `INSERT INTO t1 VALUES('西瓜：那是钢笔。');`,
      `INSERT INTO t1 VALUES('苹果：那是杂志吗？');`,
      `INSERT INTO t1 VALUES('西瓜：不，那不是杂志。那是字典。');`,
      `INSERT INTO t1 VALUES('some 西瓜：不，那不 text 是杂志。in 那是 chinese 字典。');`,
    ].forEach((stmt) => db.query(stmt).run());
  });

  sqlTest(
    db,
    `1.1`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('苹果');`,
    [],
    ["(苹果)：这是什么？", "(苹果)：那是什么？", "(苹果)：那是杂志吗？"]
  );

  sqlTest(
    db,
    `1.2`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('那是');`,
    [],
    [
      "苹果：(那是)什么？",
      "西瓜：(那是)钢笔。",
      "苹果：(那是)杂志吗？",
      "西瓜：不，那不是杂志。(那是)字典。",
      "some 西瓜：不，那不 text 是杂志。in (那是) chinese 字典。",
    ]
  );

  sqlTest(
    db,
    `1.3`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('钢');`,
    [],
    ["西瓜：那是(钢)笔。"]
  );

  sqlTest(
    db,
    `1.4`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('苹果：');`,
    [],
    ["(苹果：)这是什么？", "(苹果：)那是什么？", "(苹果：)那是杂志吗？"]
  );

  sqlTest(
    db,
    `1.4`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('some 西瓜');`,
    [],
    ["(some) (西瓜)：不，那不 text 是杂志。in 那是 chinese 字典。"]
  );

  test("1.5 (Japanese Setup)", () => {
    [
      `INSERT INTO t1 VALUES('リンゴを食べます。');`,
      `INSERT INTO t1 VALUES('半角ｶﾀｶﾅと、句読点。');`,
      `INSERT INTO t1 VALUES('「こんにちは」と言った。');`,
      `INSERT INTO t1 VALUES('ｆｕｌｌｗｉｄｔｈのテスト');`,
      `INSERT INTO t1 VALUES('ﾊﾝｶｸのﾃｽﾄ');`,
    ].forEach((stmt) => db.query(stmt).run());
  });

  // Full-width Katakana
  sqlTest(
    db,
    `1.6`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('リンゴ');`,
    [],
    ["(リンゴ)を食べます。"]
  );


  describe("vietnamese", () => {
    const db = initDatabase();
    afterAll(() => db.close());

    test("1.0", () => {
      [
        `CREATE VIRTUAL TABLE t1 USING fts5(y, tokenize='better_trigram');`,
        `INSERT INTO t1 VALUES('Con đường dài và đẹp');`,
        `INSERT INTO t1 VALUES('Đường phố mới xây');`,
        `INSERT INTO t1 VALUES('Tiếng Việt có dấu');`,
      ].forEach((stmt) => db.query(stmt).run());
    });

    // fts5_expr verifies tokenization
    //   đ (U+0111) → đ, 5-char "đường" → đườ+ườn+ờng
    //   3-char "dài" → dài, 2-char "và" → và (single token)
    sqlTest(
      db,
      `0.1`,
      `SELECT fts5_expr('con đường dài và đẹp', 'tokenize=better_trigram') as res`,
      [],
      `"con" AND "đườ" + "ườn" + "ờng" AND "dài" AND "và" AND "đẹp"`
    );

    // đ (U+0111) single codepoint, not d+combining — should match itself
    sqlTest(
      db,
      `1.1`,
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('đường');`,
      [],
      ["Con (đường) dài và đẹp", "(Đường) phố mới xây"]
    );

    // substring within đẹp (U+0111 + U+1EB9 + U+0070)
    sqlTest(
      db,
      `1.2`,
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('đẹp');`,
      [],
      ["Con đường dài và (đẹp)"]
    );

    // word boundary: "mới xây" across space (FTS5 AND semantics)
    sqlTest(
      db,
      `1.3`,
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('mới xây');`,
      [],
      ["Đường phố (mới) (xây)"]
    );

    // uppercase Đ (U+0110) case-folds to đ (U+0111)
    sqlTest(
      db,
      `1.4`,
      `SELECT highlight(t1, 0, '(', ')') as res FROM t1('Đường');`,
      [],
      ["Con (đường) dài và đẹp", "(Đường) phố mới xây"]
    );

    // LIKE with đ (byte-level — Đ != đ, only row 1 matches)
    sqlTest(
      db,
      `1.5`,
      `SELECT rowid as res FROM t1 WHERE y LIKE '%đường%'`,
      [],
      [1]
    );
  });

  describe("vietnamese_case_sensitive", () => {
    const db = initDatabase();
    afterAll(() => db.close());

    test("2.0", () => {
      [
        `CREATE VIRTUAL TABLE t2 USING fts5(y, tokenize='better_trigram case_sensitive 1');`,
        `INSERT INTO t2 VALUES('Con đường dài');`,
        `INSERT INTO t2 VALUES('Con Đường dài');`,
      ].forEach((stmt) => db.query(stmt).run());
    });

    // case_sensitive 1: "đường" should NOT match "Đường"
    sqlTest(
      db,
      `2.1`,
      `SELECT highlight(t2, 0, '(', ')') as res FROM t2('đường');`,
      [],
      ["Con (đường) dài"]
    );

    sqlTest(
      db,
      `2.2`,
      `SELECT highlight(t2, 0, '(', ')') as res FROM t2('Đường');`,
      [],
      ["Con (Đường) dài"]
    );
  });

  describe("vietnamese_remove_diacritics", () => {
    const db = initDatabase();
    afterAll(() => db.close());

    test("3.0", () => {
      [
        `CREATE VIRTUAL TABLE t3 USING fts5(y, tokenize='better_trigram remove_diacritics 2');`,
        `INSERT INTO t3 VALUES('Con đường dài và đẹp');`,
        `INSERT INTO t3 VALUES('Tiếng Việt có dấu');`,
      ].forEach((stmt) => db.query(stmt).run());
    });

    // remove_diacritics 2: đ→d, ườ→uo — "duong" matches "đường"
    sqlTest(
      db,
      `3.1`,
      `SELECT highlight(t3, 0, '(', ')') as res FROM t3('duong');`,
      [],
      ["Con (đường) dài và đẹp"]
    );

    // "dep" matches "đẹp" (đ→d, ẹ→e)
    sqlTest(
      db,
      `3.2`,
      `SELECT highlight(t3, 0, '(', ')') as res FROM t3('dep');`,
      [],
      ["Con đường dài và (đẹp)"]
    );

    // "tieng viet" matches "Tiếng Việt" (FTS5 AND semantics)
    sqlTest(
      db,
      `3.3`,
      `SELECT highlight(t3, 0, '(', ')') as res FROM t3('tieng viet');`,
      [],
      ["(Tiếng) (Việt) có dấu"]
    );
  });

  // Kanji + Hiragana (The exact issue your PR fixes)
  sqlTest(
    db,
    `1.7`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('食べ');`,
    [],
    ["リンゴを(食べ)ます。"]
  );

  // Half-width Katakana
  sqlTest(
    db,
    `1.8`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('ｶﾀｶﾅ');`,
    [],
    ["半角(ｶﾀｶﾅ)と、句読点。"]
  );

  // Japanese Punctuation (Comma / Ideographic Comma)
  sqlTest(
    db,
    `1.9`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('、');`,
    [],
    ["半角ｶﾀｶﾅと(、)句読点。"]
  );

  // Japanese Punctuation (Brackets) + Hiragana
  sqlTest(
    db,
    `1.10`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('「こんにちは」');`,
    [],
    ["(「こんにちは」)と言った。"]
  );

  // Full-width Romaji 
  sqlTest(
    db,
    `1.12`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('ｗｉｄｔｈ');`,
    [],
    ["ｆｕｌｌ(ｗｉｄｔｈ)のテスト"]
  );

  // Half-width Katakana
  sqlTest(
    db,
    `1.13`,
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1('ﾝｶｸ');`,
    [],
    ["ﾊ(ﾝｶｸ)のﾃｽﾄ"]
  );
});

describe("word_boundary", () => {
  const db = initDatabase();
  afterAll(() => db.close());

  test("1.0", () => {
    [
      `CREATE VIRTUAL TABLE t1 USING fts5(y, tokenize='better_trigram');`,
      `INSERT INTO t1 VALUES('i am a bird');`,
      `INSERT INTO t1 VALUES('i am a cat');`,
    ].forEach((stmt) => db.query(stmt).run());
  });

  // fts5_expr verifies tokenization: spaces split words,
  // "a" is a single-char token (no trigrams), "bird"→"bir"+"ird"
  sqlTest(
    db,
    "1.1",
    `SELECT fts5_expr('a bird', 'tokenize=better_trigram') as res`,
    [],
    `"a" AND "bir" + "ird"`
  );

  // MATCH 'a bird' finds row 1, not row 2 (no 'bird' in row 2)
  sqlTest(
    db,
    "1.2",
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1 WHERE t1 MATCH 'a bird'`,
    [],
    "i am (a) (bird)"
  );

  // MATCH 'a cat' finds row 2 only
  sqlTest(
    db,
    "1.3",
    `SELECT highlight(t1, 0, '(', ')') as res FROM t1 WHERE t1 MATCH 'a cat'`,
    [],
    "i am (a) (cat)"
  );
});

// ──────────────────────────────────────────────
// Two-column prefix search (app-level, no C changes)
// ──────────────────────────────────────────────
// Proves prefix search works with existing better_trigram tokenizer
// by using two FTS5 columns:
//   content  — full trigram indexing (unchanged)
//   prefix   — app-extracted word-start prefixes (1-2 chars per word)
//
// The app extracts prefixes at index time:
//   "a-arrow-down" → prefix column = "a a-"
//   "arrow-up"     → prefix column = "a ar"
//
// Query routing by length avoids the JS bug where prefix tokens from
// longer words (e.g. "a"/"ar" from "arrow") leaked into prefix index
// and caused incorrect AND-intersection.
describe("two-column prefix search (app-level)", () => {
  const db = initDatabase();
  afterAll(() => db.close());

  test("0.0", () => {
    [
      `CREATE VIRTUAL TABLE t1 USING fts5(
        content,
        prefix,
        tokenize='better_trigram'
      );`,
      // Doc 1: "a-arrow-down" — one word, prefixes: "a", "a-"
      `INSERT INTO t1(content, prefix) VALUES('a-arrow-down', 'a a-')`,
      // Doc 2: "arrow-up" — one word, prefixes: "a", "ar"
      `INSERT INTO t1(content, prefix) VALUES('arrow-up', 'a ar')`,
      // Doc 3: "hello world" — two words, prefixes: "h","he","w","wo"
      `INSERT INTO t1(content, prefix) VALUES('hello world', 'h he w wo')`,
    ].forEach((stmt) => db.query(stmt).run());
  });

  // ── 3+ char queries → trigram column ──

  // 5-char query: both hyphenated docs contain trigrams "arr","rro","row"
  sqlTest(
    db,
    "1. trigram: 'arrow' matches both hyphenated docs",
    `SELECT rowid as res FROM t1 WHERE t1 MATCH 'arrow'`,
    [],
    [1, 2]
  );

  // 5-char query on plain words
  sqlTest(
    db,
    "2. trigram: 'hello' matches doc 3",
    `SELECT rowid as res FROM t1 WHERE t1 MATCH 'hello'`,
    [],
    [3]
  );

  // ── 1-2 char queries → prefix column (word-start only) ──

  // 2-char "ar": doc 1 prefix is "a-", doc 2 prefix is "ar"
  sqlTest(
    db,
    "3. prefix: 'ar' matches arrow-up only (word-start prefix)",
    `SELECT rowid as res FROM t1 WHERE t1 MATCH 'ar'`,
    [],
    [2]
  );

  // 1-char "a": both docs have word starting with "a"
  sqlTest(
    db,
    "4. prefix: 'a' matches both hyphenated docs",
    `SELECT rowid as res FROM t1 WHERE t1 MATCH 'a'`,
    [],
    [1, 2]
  );

  // 2-char "he": doc 3 has "hello" starting with "he"
  sqlTest(
    db,
    "5. prefix: 'he' matches hello",
    `SELECT rowid as res FROM t1 WHERE t1 MATCH 'he'`,
    [],
    [3]
  );

  // 2-char "wo": doc 3 has "world" starting with "wo"
  sqlTest(
    db,
    "6. prefix: 'wo' matches world",
    `SELECT rowid as res FROM t1 WHERE t1 MATCH 'wo'`,
    [],
    [3]
  );

  // 1-char "h": only doc 3 (docs 1-2 have no word starting with "h")
  sqlTest(
    db,
    "7. prefix: 'h' matches hello only",
    `SELECT rowid as res FROM t1 WHERE t1 MATCH 'h'`,
    [],
    [3]
  );

  // 1-char "w": only doc 3
  sqlTest(
    db,
    "8. prefix: 'w' matches world only",
    `SELECT rowid as res FROM t1 WHERE t1 MATCH 'w'`,
    [],
    [3]
  );

  // 2-char non-matching prefix
  sqlTest(
    db,
    "9. prefix: 'xy' matches nothing",
    `SELECT rowid as res FROM t1 WHERE t1 MATCH 'xy'`,
    [],
    undefined
  );

  // ── Contrast with LIKE (substring, not word-start) ──

  // LIKE '%ar%' on content finds both docs (substring match)
  sqlTest(
    db,
    "10. LIKE: '%ar%' finds both docs (substring, not prefix)",
    `SELECT rowid as res FROM t1 WHERE content LIKE '%ar%'`,
    [],
    [1, 2]
  );

  // ── Key insight ──
  // App routes by query length. No C changes needed.
  // Short queries < 3 chars hit prefix column (1-2 char partials).
  // Long queries ≥ 3 chars hit content column (trigrams).
  // FTS5 multi-column search handles both automatically.

  test("11. doc with standalone 'ar' word matches in both columns", () => {
    db.query(`INSERT INTO t1(content, prefix) VALUES('ar is a word', 'a ar')`).run();
    const result = db.query(`SELECT rowid as res FROM t1('ar')`).all() as { res: number }[];
    // Row 2 (arrow-up: prefix "ar") + Row 4 (standalone "ar": both columns)
    expect(result.map(r => r.res).sort()).toEqual([2, 4]);
  });
});

function sqlTest(
  db: Database,
  version: string,
  query: string,
  params: string[],
  expected: string | number | undefined | (string | number | undefined)[]
) {
  test(version, () => {
    const result = db.query(query).all(...params) as {
      res: string | number;
    }[];
    if (Array.isArray(expected)) {
      expect(Array.isArray(expected)).toBeTrue();
      expect(result.length).toBe(expected.length);
      result.forEach((result, i) => expect(result.res).toBe(expected[i]!));
    } else {
      expect(result[0]?.res).toBe(expected!);
    }
  });
}

function explainQueryPlanTest(
  db: Database,
  version: string,
  query: string,
  params: string[],
  expected: string
) {
  test(version, () => {
    const result = db.query(`EXPLAIN QUERY PLAN ${query}`).get(...params) as {
      detail?: string;
    };
    expect(result?.detail).toInclude(expected);
  });
}
