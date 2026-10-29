---
title: "Towards formal verification: mbrotli and mzstd"
description: >-
  Why we started proving mbrotli and mzstd correct against RFC 7932 and RFC 8878
  in Lean 4, how Charon and Aeneas tie the proofs to the Rust code, what is
  already proved, and what is left before the decoders are verified as a whole.
date: 2026-10-29 10:00:00 +0300
image: /assets/img/og/formal-verification-mbrotli-mzstd.png
projects: [mbrotli, mzstd]
tags: [formal-verification, lean, aeneas, rust, brotli, zstd, rfc, correctness]
summary:
  - "Differential tests, fuzzing, Miri and AddressSanitizer show that **mbrotli** and **mzstd** agree with the C libraries and do not misuse memory. None of them shows that the code follows RFC 7932 or RFC 8878: where the C library is wrong, the tests inherit its mistake."
  - "CVE-2026-111497 was such a case. The C Brotli decoder ignored a failed block switch for years, and mbrotli 0.5.16 accepted the same RFC-invalid streams. Safe Rust kept it from corrupting memory, not from deviating from the RFC."
  - "Since 25 October 2026 (mbrotli) and 26 October (mzstd), Charon and Aeneas translate selected Rust functions into Lean 4, and machine-checked proofs show they compute what the RFC prescribes, that the decoder reads back what the encoder writes, and that the code cannot panic or overflow on the inputs covered."
  - "Proved so far: the distance and insert-and-copy length codes, the ring of last distances and the command packing in mbrotli; the frame and block headers, `Number_of_Sequences`, length and offset code tables, default distributions, repeat offsets and FSE states in mzstd."
  - "Still ahead: bit readers and writers, prefix and Huffman codes, FSE tables, context maps, dictionary transforms, a reference decoder in Lean and, last, a proof that the Rust decoder refines it. Byte identity with C, SIMD kernels and match finding stay with the tests."
faq:
  - q: Are mbrotli and mzstd formally verified?
    a: >-
      Partly. Parts of both codecs have machine-checked Lean 4 proofs against the
      RFCs: in mbrotli the distance codes, length codes and commands of RFC 7932,
      in mzstd the headers, sequence codes, default distributions, repeat offsets
      and FSE states of RFC 8878. The decoders as a whole are not verified yet.
  - q: What is the specification the proofs use?
    a: >-
      The RFCs themselves: RFC 7932 and RFC 9841 for Brotli, RFC 8878 for
      Zstandard, transcribed by hand into Lean. The C libraries are never used as
      the specification; agreement with them is checked by differential tests.
  - q: How are the proofs connected to the Rust code?
    a: >-
      Charon reads the compiler's MIR of the selected functions and Aeneas
      translates it into Lean. The translation is generated, never edited, and CI
      regenerates it on every pull request and fails if it differs from the
      committed one, so a change to the Rust code that breaks a property breaks
      the proof.
  - q: Will byte identity with Google Brotli and zstd be proved?
    a: >-
      No. Byte identity is a property of match finding, block splitting and cost
      models, which the RFCs do not constrain. It stays with the differential
      tests and fuzzing.
---

[mbrotli](https://github.com/M-Compressors/mbrotli) and
[mzstd](https://github.com/M-Compressors/mzstd) now carry machine-checked proofs
in Lean 4 that parts of their code follow RFC 7932 and RFC 8878. They are not
verified codecs yet, and this post is not an announcement that they are. It
covers why we took this road, how the proofs are tied to the Rust code, what has
been proved in the first few days, and what is left.

## What our tests show, and what they do not

Both crates promise to write the same bytes as their C references: Google Brotli
1.2.0 at qualities 0–11 and zstd 1.5.7 at every level. Everything we built to
keep that promise compares against C:

- differential tests run the Rust and the vendored C encoder and decoder on the
  same input and compare the results, across levels, parameters, streaming
  schedules and buffer sizes;
- AFL++ and ClusterFuzzLite targets feed random and mutated input to both
  sides;
- Miri and AddressSanitizer check that nothing reaches memory it should not,
  including the `unsafe` code in our dependencies;
- `forbid(unsafe_code)` in both crates rules out memory corruption in our own
  code.

This answers two questions well: "does mbrotli do what Google Brotli does?" and
"can it corrupt memory?". It does not answer a third one: "does it do what the
RFC says?". A differential test has the C library as its oracle. Where the
oracle is right, the test catches our mistakes. Where it is wrong, the test is
silent, or it reports our correct behaviour as a bug.

## CVE-2026-111497 as a reminder

On 24 October we [wrote about CVE-2026-111497](/2026/brotli-cve-2026-111497-mbrotli/),
an out-of-bounds write in the C Brotli decoder. Its root cause was a format
bug: a category with a single block type has a block count of 16,777,216 under
RFC 7932, a stream that needs more is invalid, and the C decoder's fast path
ignored that failure and went on with state the block switch never set up.

mbrotli was not affected in the sense of the CVE: safe Rust cannot write past a
buffer. But when we checked, mbrotli 0.5.16 also deviated from the RFC in the
same place. It started that block count at `u64::MAX`, so the streams the RFC
calls invalid decoded without an error. Rust turned a memory-safety bug into an
"accepts what it should reject" bug, which is better, but it is still a bug, and
no comparison with the C library could have flagged it, because the C library
was wrong there too. mbrotli 0.5.17 fixed it.

Memory safety and agreement with C are necessary. They are not the same thing as
following the specification, and for a decoder that reads untrusted input the
specification is what matters.

## The goal

We want a second, independent answer: the RFC itself, read by a machine, and a
proof that the Rust code computes what it says. Concretely, every proved item
gets up to three kinds of statements:

1. **Conformance.** The function computes what the RFC prescribes: the decoder
   turns a field into the value the RFC defines, a table equals the table the
   RFC prints.
2. **Round trip and uniqueness.** What the encoder writes, the RFC's decoding
   reads back to the value the encoder meant. Where the format allows only one
   encoding, the encoder's choice is that one, so any correct encoder writes the
   same bits.
3. **No panic, no overflow.** On the inputs the statement covers, the function
   returns without an arithmetic overflow, an out-of-range shift or an
   out-of-bounds index.

The specification is always the RFC, never the C library. Byte identity with C
stays where it belongs, in the differential tests.

## How the proofs stay tied to the code

A proof about a hand-written model of the code proves something about the model.
We wanted proofs about the code that ships, without annotating it and without
keeping a second copy in sync by hand. The pipeline is the same in both
repositories:

1. [Charon](https://github.com/AeneasVerif/charon) compiles the ordinary crate on
   its own nightly toolchain and extracts the MIR of the functions we list,
   plus everything they call.
2. [Aeneas](https://github.com/AeneasVerif/aeneas) translates that MIR into Lean
   4. Every `+`, `-`, `*`, shift, cast and index becomes an operation in a
   `Result` monad that fails exactly where a debug build would panic, so a proof
   that a function returns `ok` is a proof that it does not panic.
3. A hand-written `Rfc.lean` transcribes the RFC: header fields and formulas,
   code tables, default distributions, repeat offset rules. It quotes the text
   each definition encodes and checks itself: the length code ranges are
   contiguous, the default distributions sum to their table sizes, the RFC's
   worked examples come out right.
4. Hand-written theorems connect the two.

`scripts/extract_lean.py` pins the Aeneas release and the list of translated
functions. In CI, `ci-lean.yml` regenerates the translation, fails if it differs
from the committed one, and then builds the proofs. A change to the Rust code
therefore either leaves the translation alone or forces the proofs to be redone.
We checked that coupling by mutation: changing `- 4` to `- 5` in mbrotli's
`short_window_distance`, or `+ 256` to `+ 255` in mzstd's two-byte
`Frame_Content_Size`, fails the drift check, and after regeneration the
corresponding theorem no longer proves.

Here is what this looks like for one function. mzstd's encoder updates its three
repeat offsets after each sequence with code ported from zstd:

```rust
pub(crate) const fn update_rep(rep: &mut [u32; REP_NUM], off_base: u32, ll0: bool) {
    if off_base > REP_NUM as u32 {
        rep[2] = rep[1];
        rep[1] = rep[0];
        rep[0] = offbase_to_offset(off_base);
    } else {
        let rep_code = off_base - 1 + ll0 as u32;
        if rep_code > 0 {
            let current = if rep_code == REP_NUM as u32 {
                rep[0].wrapping_sub(1)
            } else {
                rep[rep_code as usize]
            };
            rep[2] = if rep_code >= 2 { rep[1] } else { rep[2] };
            rep[1] = rep[0];
            rep[0] = current;
        }
    }
}
```

The theorem about its Aeneas translation says that, for every offset value and
both cases of the literals length, the result is `updateRepeats`, the rule of
RFC 8878 section 3.1.1.5 as transcribed in `Rfc.lean`:

```lean
theorem update_rep.spec (rep : Std.Array U32 3#usize) (off_base : U32) (ll0 : Bool)
    (h1 : 1 ≤ off_base.val) (hpos : ll0 = true → off_base.val = 3 → 1 ≤ rep[0]!.val) :
    update_rep rep off_base ll0 ⦃ (r : Std.Array U32 3#usize) =>
      repeats r = updateRepeats (repeats rep) off_base.val ll0 ⦄
```

The only excluded input is decrementing a first repeat offset of zero, which no
stream reaches. Changing `rep_code >= 2` to `rep_code > 2` breaks this proof.

The decoder side of mzstd's frame header has no precondition at all:
`FrameHeader.parse.spec` holds for every byte string. The parser returns an error
exactly when the RFC's reading rejects the bytes and the RFC's fields otherwise,
so it cannot panic on any input.

### What the proofs trust

A theorem here is a statement about the Rust code only if these hold:

| Trusted | Why it is acceptable for now |
| --- | --- |
| Charon and Aeneas translate MIR faithfully, including overflow, shift and cast semantics | The largest assumption; the mutation checks above test it, they do not prove it |
| The Aeneas models of the scalar and slice operations we use match Rust | A short list, documented per repository |
| The nightly MIR Charon sees matches what the release build runs | The translation is of unoptimized MIR of the same source |
| Hand-written models of the few standard-library functions Aeneas does not model | Four in mbrotli, one in mzstd, a few lines each; CI fails if the set changes |
| Lean's kernel and its three standard axioms | `Audit.lean` fails the build on any `sorry`, `native_decide` or new axiom |
| `Rfc.lean` transcribes the RFC correctly | Short enough to read against the RFC, and it checks its own tables |

Finite facts, such as all 1,152 inputs of mbrotli's length code combiner, are
checked by `decide +kernel`, which the Lean kernel evaluates itself. Nothing
relies on a hand-written restatement of the Rust code.

## The road so far

The first proofs went into mbrotli on 25 October 2026
([#13](https://github.com/M-Compressors/mbrotli/pull/13)), and the same setup was
ported to mzstd the next day.

| | mbrotli | mzstd |
| --- | --- | --- |
| RFC | 7932, 9841 (large window) | 8878 |
| Lean | 4.35.0 | 4.35.0 |
| Generated translation | ~2,100 lines | ~1,200 lines |
| Hand-written RFC transcription and proofs | ~3,200 lines | ~2,800 lines |
| Proof check in CI | under a minute with Mathlib's cache | under a minute with Mathlib's cache |

### mbrotli: RFC 7932 sections 4, 5 and 7.2

- **Explicit distance codes**, encoder and decoder, in standard and large-window
  streams. Every distance the encoder emits lies in the alphabet it declares,
  the decoder reads exactly the width the encoder wrote and gets the distance
  back. The converse holds as well: the encoder's symbol and extra field are the
  only explicit pair that decodes to that distance.
- **The sixteen short codes and the ring of last distances**: the ring starts at
  `4, 11, 15, 16`, `push` and `pop` behave as the RFC's ring, `short` adds the
  listed offset to the listed past distance and rejects exactly the values
  outside `1..=2^63 - 4`, and `resolve` gives the RFC distance for every symbol.
- **Insert-and-copy length codes**: the four length tables and the cell diagram
  equal the RFC's, every entry of the decoder's 704-symbol command table is the
  RFC row including its section 7.2 distance context, and the encoder picks the
  only codes and cell that hold each pair of lengths with its choice of distance.
- **Commands**: `Command::new` packs a seven-bit copy length delta that
  `copy_len_code` reads back for every delta from -64 to 63, and `extra_bits`
  and `distance_context` give exactly the fields and context the decoder's table
  entry reads.

### mzstd: RFC 8878 sections 3 and 4.1.1

- **Frame header**, both sides: the descriptor, window formula, dictionary ID
  and content size. The parser follows the RFC on every input; the writer
  produces a header the RFC reads back as the fields the encoder asked for.
- **Block header** and **`Number_of_Sequences`**, both sides with round trips;
  the encoder writes the shortest form the RFC allows.
- **Literals length and match length codes**: the decoder tables equal Tables
  16 and 17, and the encoder picks the only code whose range holds each length.
  For offset codes, the decoder's tables give the RFC's offset for every code.
- **Default distributions, magic numbers, initial repeat offsets** and the
  encoder's **repeat offset update**.
- **FSE states**: the `Number_of_Bits` and `Baseline` of every state are the
  pairs of Table 21.

### What the work turned up

No bug in the verified functions so far: they are small and well covered by the
differential tests, and that was expected for a first level. Two things came out
of it anyway.

The RFC is not perfect either. RFC 8878 prints the last two rows of Table 18,
the repeat offset table, inconsistently with its own text. The current
Zstandard format document corrects both; our transcription follows the prose,
and the self-check of `Rfc.lean` uses the corrected rows. A transcription that
checks itself against the specification's own examples finds this kind of thing
on the first run.

The code has to be translatable. Aeneas does not handle every Rust construct, so
a few mzstd functions were restructured without changing what they compute:
`FrameHeader::parse` reads its fields by index instead of re-slicing and folding
a reversed iterator, `Number_of_Sequences` moved into its own reader and writer,
and the encoder writes its frame header from a plain `FrameHeaderFields` value.
In mbrotli, the decoder methods that allocate and the SIMD-generic command
search are excluded from the translation.

## What is left

Both repositories keep a coverage checklist against their RFC in
`architecture/formal-verification.md`, in three levels ordered by cost. Each
level builds on the previous one.

### Level 1: the rest of the arithmetic and tables

For mbrotli: when the decoder pushes to the ring of last distances, the
table-driven distance split, the large-window alphabet limit, the decoder's
addition of the extra fields in its command loop, the `WBITS` and `MLEN`
headers, the 26 block count codes and block type codes of section 6, and the
context lookup tables of section 7.1. Section 6 is where CVE-2026-111497 lived,
and it is not proved yet.

For mzstd: `Block_Maximum_Size`, the literals section header formats, the
compression mode rules, the encoder's offset code, the decoder's repeat offset
update with its rejection of a zero offset, and the Huffman weights of section
4.2.1.

The common obstacle is that much of this code sits inside the decoders'
streaming state machines and sequence loops, which do not translate as they
are. The arithmetic has to be factored out first, as we did for the mzstd
headers.

### Level 2: stateful decoding

- **Bit order.** That what the encoder's bit writers emit, least significant bit
  first, is what the decoder's bit readers read, including mzstd's backward
  streams. mbrotli's command round trip already assumes it, and the decoder
  side of the section 6 and 9 headers needs it.
- **Prefix codes**: canonical codes from code lengths, Brotli's simple and
  complex prefix codes, the two-level Huffman tables in mbrotli's decoder and
  the rejection of incomplete or oversubscribed codes, Zstandard's Huffman tree
  descriptions and four-stream literals.
- **FSE**: reading a distribution and spreading the cells, against Appendix A of
  RFC 8878.
- **Brotli context maps and the 121 dictionary transforms**, and Zstandard's
  sequence decoding order and execution within the window.

### Level 3: the decoders as a whole

1. A reference decoder in Lean that transcribes the RFC's decoding, compiled and
   used as a second oracle beside C in the fuzz targets and tests. That is
   evidence, not proof, but it is evidence independent of the C library, which
   is exactly what the CVE showed we were missing.
2. A refinement proof that the baseline path of each Rust decoder computes the
   reference decoder's output for any chunking of the input.

The second step is the one that would let us call the decoders verified.

### What stays with the tests

Some properties will not be proved, by design or because of the tools:

- **Byte identity with Google Brotli and zstd.** It depends on match finding,
  block splitting and cost models, which the RFCs leave open. The differential
  tests stay.
- **SIMD kernels.** Aeneas cannot translate them; they stay with the
  differential tests, Miri and AddressSanitizer, and the refinement proof
  targets the scalar baseline path.
- **Parallel and framed layers, the XXH64 content checksum** and the rest of the
  crates outside the RFCs.

## Checking it yourself

In either repository:

```sh
python3 scripts/extract_lean.py --check   # the translation matches the Rust source
cd verification/lean && lake exe cache get && lake build   # proofs and axiom audit
```

The first run downloads the pinned Aeneas release and its nightly toolchain;
after that, the proofs build in under a minute. The full list of verified items,
their preconditions, the trusted base and the known gaps is in
`architecture/formal-verification.md` of
[mbrotli](https://github.com/M-Compressors/mbrotli/blob/master/architecture/formal-verification.md)
and [mzstd](https://github.com/M-Compressors/mzstd/blob/main/architecture/formal-verification.md).

If you find a gap between a theorem and what we claim for it, or a place where
`Rfc.lean` misreads the RFC, open an issue in the project it concerns. That is
the kind of report this work exists to receive.
