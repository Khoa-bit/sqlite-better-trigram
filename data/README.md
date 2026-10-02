# `fold.json` — app-side diacritic delta

Canonical, language-neutral definition of the **extra** diacritic/ligature
folding that the SQLite extension does *not* perform.

The full fold is two steps:

1. **Standard** — Unicode NFD, then remove combining marks (`\p{M}`).
   Available in every language's stdlib.
2. **Delta** — the mappings in `fold.json` (Ø, Đ, Ħ, ı, Ł, Æ, Þ, œ, Ơ, Ư, …).
   These are strokes/ligatures that NFD cannot decompose, so step 1 misses them.

Every language must apply step 1 then step 2, in that order.

## Format

```jsonc
{
  "version": 1,            // bump when the shape or the rules change
  "description": "...",
  "fold": [
    { "from": 216, "to": "O", "char": "Ø" }   // from = source codepoint (int)
  ]                                            // to   = replacement (string, may be multi-codepoint)
}                                              // char = the literal source, for review only
```

- `from` — decimal codepoint of the source character. **Exactly one codepoint.**
  Multi-codepoint *sources* (sequence rules) are not supported.
- `to` — replacement string, **1..N codepoints**. May expand: `ß → "ss"`,
  `ﬁ → "fi"`. Single-codepoint values are the common case.
- `char` — human-readable mirror of `from`. **Ignored by loaders**; keep in sync.
- `version` — integer. Loaders must reject unknown versions loudly.

### Choosing `to`

Use the Unicode **compatibility decomposition** when one exists (`Æ → "AE"`,
`Œ → "OE"`, `ß → "ss"`, `ﬁ → "fi"`, `ﬄ → "ffl"`, ...). When it does not
(strokes/dots: `Ø Đ Ħ ı Ł Þ Ơ Ư`), fall back to the bare ASCII letter.

### Multi-codepoint expansion (important)

A `to` with more than one codepoint **expands**. Any consumer that builds
fixed-width units over the folded text (n-grams, positions, offset maps) must
treat each *output* codepoint as its own unit — never store a multi-codepoint
replacement in a single slot.

`src/tokenizer.ts` does this by pushing one ring-buffer slot per output
codepoint, all sharing the source character's offsets. `fold()` and
`removeDiacritics()` are plain string concatenation, so they already expand.

The table is a map, so entry order is not significant.

## Loaders

### JavaScript / TypeScript (Bun, Node ≥ 20.10, bundlers)

```ts
import foldData from "../data/fold.json" with { type: "json" };

const DELTA = new Map<number, string>(
  (foldData.fold as { from: number; to: string }[]).map((e) => [e.from, e.to]),
);
```

The import is inlined at build time — no runtime file access.

### Go

```go
//go:embed fold.json
var foldJSON []byte

type foldFile struct {
    Version int `json:"version"`
    Fold    []struct {
        From int    `json:"from"`
        To   string `json:"to"`
    } `json:"fold"`
}

var delta = func() map[rune]string {
    var f foldFile
    if err := json.Unmarshal(foldJSON, &f); err != nil {
        panic(err)
    }
    m := make(map[rune]string, len(f.Fold))
    for _, e := range f.Fold {
        m[rune(e.From)] = e.To
    }
    return m
}()
```

### Rust

```rust
#[derive(serde::Deserialize)]
struct Entry { from: u32, to: String }
#[derive(serde::Deserialize)]
struct FoldFile { version: u32, fold: Vec<Entry> }

let file: FoldFile = serde_json::from_str(include_str!("../data/fold.json"))?;
let delta: HashMap<char, String> =
    file.fold.into_iter().map(|e| (char::from_u32(e.from).unwrap(), e.to)).collect();
```

### Java

```java
record Entry(int from, String to) {}
record FoldFile(int version, List<Entry> fold) {}

var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
var file = mapper.readValue(
    FoldFile.class.getResourceAsStream("/data/fold.json"), FoldFile.class);
```

### .NET

```csharp
record Entry(int From, string To);
record FoldFile(int Version, List<Entry> Fold);

var json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "data/fold.json"));
var file = System.Text.Json.JsonSerializer.Deserialize<FoldFile>(json,
    new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
```

## Conformance

`test/fold-delta.test.ts` reads this file and asserts the JS implementation
reproduces every entry. When a new language ships a loader, run the same file
against it — that is the contract that keeps languages byte-identical.
