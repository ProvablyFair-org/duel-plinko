/**
 * Spec self-test — docs/ALGORITHM.md §5 vectors and properties, run against src/rng.ts.
 *
 * Written by the clean-room implementer together with src/rng.ts, from docs/ALGORITHM.md and the module
 * interface alone (never from Duel's code). Integrated 20 Oct 2026: the checks are unchanged; only the
 * import path, the mocha wrapper and the reporting (failures collected instead of printed) were adapted.
 * The property block draws 2,000 random seeds per run (crypto.randomBytes), as the implementer wrote it.
 */
import * as assert from 'assert';
import { createHmac, randomBytes } from "crypto";
import {
  BIT_EXTRACTION,
  bitExtractionBiasBound,
  directionBit,
  computeSlotFromBuffer,
  computePathFromBuffer,
  computeSlot,
  verifyHash,
  sha256Buffer,
} from "../../src/rng";

const EXPECTED_CHECKS = 71;

function runSelftest(): { pass: number; total: number; failed: string[] } {
  let pass = 0;
  let total = 0;
  const failed: string[] = [];
  function check(name: string, ok: boolean, detail = ""): void {
    total++;
    if (ok) pass++;
    else failed.push(`${name}${detail ? "  " + detail : ""}`);
  }

  // Exact decimal product via BigInt (for §3.2 win_amount = amount × multiplier).
  function parseDec(s: string): { n: bigint; scale: number } {
    const [i, f = ""] = s.split(".");
    return { n: BigInt(i + f), scale: f.length };
  }
  function decEqual(a: { n: bigint; scale: number }, b: { n: bigint; scale: number }): boolean {
    const s = Math.max(a.scale, b.scale);
    return a.n * 10n ** BigInt(s - a.scale) === b.n * 10n ** BigInt(s - b.scale);
  }
  function decMul(a: string, b: string): { n: bigint; scale: number } {
    const x = parseDec(a);
    const y = parseDec(b);
    return { n: x.n * y.n, scale: x.scale + y.scale };
  }

  interface Vector {
    id: string;
    serverSeed: string;
    commitment: string;
    clientSeed: string;
    nonce: number;
    rows: number;
    amount: string;
    digest0: string;
    u32: number[];
    bits: number[];
    slot: number;
    multiplier: string;
    winAmount: string;
    served?: string;
  }

  // Copied from ALGORITHM.md §5.
  const vectors: Vector[] = [
    {
      id: "V1",
      serverSeed: "b092c51c7b51b3a3ba4e387dfec1c9381103603d161a6a7553f7af4aeda85afe",
      commitment: "00f28fa3606fcc7734b24ed4a3a694b719f28850c22c09bcd41e137602e4934f",
      clientSeed: "mzYqdNQIyYadXPtz", nonce: 0, rows: 8, amount: "0.01",
      digest0: "4803f49fa779e5c671ce2524bbe04c11034626d85fe9449c7683415b38480a19",
      u32: [1208218783, 1831192550, 3550515791, 3798420359, 362664949, 2066711318, 4282547452, 64191362],
      bits: [1, 0, 1, 1, 1, 0, 0, 0], slot: 4,
      multiplier: "0.50462510", winAmount: "0.0050462510", served: "0.005046251",
    },
    {
      id: "V2",
      serverSeed: "3dde68589b9ab1511122d6debffb0258c95297430bfc8e186a71c5bc75117565",
      commitment: "74481b1c82e0f46b8b0a98d639aa5170d5d174364e74e1de34ee15766b5870b6",
      clientSeed: "iWWhWwBvVIA2kVuy", nonce: 19, rows: 16, amount: "0.01",
      digest0: "a376d113f0c4531fdefd2d480f4e5b0cec96492810f02fb2a056361d88a74fb8",
      u32: [2742472979, 3171529583, 3496961629, 2483695908, 943258331, 1685673677, 2045430745, 1813647369,
        1420783483, 2029789869, 2724053949, 1950308245, 661958641, 3207574751, 1421442009, 1143409021],
      bits: [1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], slot: 15,
      multiplier: "131.21304378", winAmount: "1.3121304378",
    },
    {
      id: "V3",
      serverSeed: "0e135f783cdad6a66406431391a4a03bf32c647d57a642b6a097c6bdd3a9f50a",
      commitment: "3b7dc18e27c4539a681ca43b452efca593d5afff608066c5787cc65127ea9a2f",
      clientSeed: "qea1EWzIkyI305S0", nonce: 45, rows: 16, amount: "10",
      digest0: "bbfefa9ca97ada9c741dec567dc5b0c197f16c090074aefe738a227c29659852",
      u32: [3154049692, 3278990932, 44990447, 1187219136, 237728132, 2073096196, 4235419598, 3982105512,
        246695367, 2942818124, 253749286, 3096407030, 457221794, 4129591772, 902742531, 1338334078],
      bits: [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0], slot: 3,
      multiplier: "9.08397996", winAmount: "90.83979960", served: "90.8397996",
    },
    {
      id: "V4",
      serverSeed: "b2b86a583484b0589d1d033201e28f166c68447a9d3a47e0cf48dc9c98cbe821",
      commitment: "debfede46cc0af86346d04057d2ee79879b97099807f62874f132f4f023b4b12",
      clientSeed: "pfauditmnta73k8", nonce: 12, rows: 12, amount: "0.01",
      digest0: "fc51959ea355b602e3a25dd19581f2bcd0d70d6e85786e2b1fea6786af3a92a4",
      u32: [4233205150, 3300415547, 556610075, 3824352718, 3687121655, 3720121882, 2758423338, 2187888329,
        3599665473, 1391571607, 1927821513, 2421143690],
      bits: [0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0], slot: 7,
      multiplier: "1.00929999", winAmount: "0.0100929999",
    },
    {
      id: "V5",
      serverSeed: "db449f96787bd94cc2b347cd8cac1048f300ebcc2f649ca7efb7e9980559b42c",
      commitment: "c88889ae43c8166214e28e2a507512aa90272d1cad93b6b24e2205f3dd6da2ba",
      clientSeed: "p0ycgadmrO8Tuh6x", nonce: 16, rows: 10, amount: "0.01",
      digest0: "242655271aa9956f7ebed362739c871654b1355e70d997f1ca129eda1caaa0ce",
      u32: [606491943, 3812509833, 296721300, 3732610432, 826525807, 1870318947, 3112344645, 2529724738,
        2275667136, 3049930505],
      bits: [1, 1, 0, 0, 1, 1, 1, 0, 0, 1], slot: 6,
      multiplier: "0.60602844", winAmount: "0.0060602844",
    },
  ];

  function rowDigest(seedHex: string, c: string, n: number, i: number): string {
    return createHmac("sha256", Buffer.from(seedHex, "hex")).update(`${c}:${n}:${i}`, "utf8").digest("hex");
  }

  for (const v of vectors) {
    const key = Buffer.from(v.serverSeed, "hex");
    check(`${v.id} commitment sha256Buffer(seed bytes)`, sha256Buffer(key) === v.commitment);
    check(`${v.id} verifyHash true`, verifyHash(v.serverSeed, v.commitment));
    check(`${v.id} digest_0`, rowDigest(v.serverSeed, v.clientSeed, v.nonce, 0) === v.digest0);
    const u32 = v.u32.map((_, i) => parseInt(rowDigest(v.serverSeed, v.clientSeed, v.nonce, i).slice(0, 8), 16));
    check(`${v.id} u32 i=0..${v.rows - 1}`, u32.length === v.rows && u32.every((x, i) => x === v.u32[i]));
    const bits = v.u32.map((_, i) => directionBit(rowDigest(v.serverSeed, v.clientSeed, v.nonce, i)));
    check(`${v.id} directionBit per row`, bits.every((b, i) => b === v.bits[i]), bits.join(""));
    check(`${v.id} bits == u32 mod 2`, v.u32.every((x, i) => x % 2 === v.bits[i]));
    check(`${v.id} computeSlot`, computeSlot(v.serverSeed, v.clientSeed, v.nonce, v.rows) === v.slot);
    check(`${v.id} computeSlotFromBuffer`, computeSlotFromBuffer(key, v.clientSeed, v.nonce, v.rows) === v.slot);
    const expectedPath = parseInt(v.bits.join(""), 2);
    const p = computePathFromBuffer(key, v.clientSeed, v.nonce, v.rows);
    check(`${v.id} computePathFromBuffer slot+path`, p.slot === v.slot && p.path === expectedPath,
      `slot ${p.slot} path ${p.path.toString(2).padStart(v.rows, "0")}`);
    const product = decMul(v.amount, v.multiplier);
    check(`${v.id} win_amount = amount x multiplier`, decEqual(product, parseDec(v.winAmount)));
    if (v.served) check(`${v.id} served win_amount numerically equal`, decEqual(product, parseDec(v.served)));
  }

  // Bias report consistency.
  const b = bitExtractionBiasBound();
  check("bias: hexChars/modulus/rejection mirror BIT_EXTRACTION",
    b.hexChars === BIT_EXTRACTION.hexChars && b.modulus === BIT_EXTRACTION.modulus
    && b.rejectionSampling === BIT_EXTRACTION.rejectionSampling);
  check("bias: hexChars 8, modulus 2, no rejection (spec §2 Step 2)",
    b.hexChars === 8 && b.modulus === 2 && b.rejectionSampling === false);
  check("bias: domainSize = 16**hexChars", b.domainSize === 16 ** b.hexChars);
  check("bias: remainder = domainSize % modulus", b.remainder === b.domainSize % b.modulus);
  check("bias: residue counts sum to domain",
    b.minResidueCount * (b.modulus - b.remainder) + b.maxResidueCount * b.remainder === b.domainSize
    || (b.remainder === 0 && b.minResidueCount * b.modulus === b.domainSize));
  check("bias: 0, exact, no rejected draws",
    b.bias === 0 && b.exact === true && b.rejectedDraws === 0 && b.minResidueCount === b.maxResidueCount,
    JSON.stringify(b));

  // Hash checks.
  const v0 = vectors[0];
  check("verifyHash false on wrong hash", !verifyHash(v0.serverSeed, vectors[1].commitment));
  check("verifyHash false on ASCII-hex hash (spec §1.2 rejected form)",
    !verifyHash(v0.serverSeed, sha256Buffer(Buffer.from(v0.serverSeed, "ascii"))));
  check("verifyHash false on malformed seed", !verifyHash("zz", v0.commitment));
  check("verifyHash accepts uppercase published hash", verifyHash(v0.serverSeed, v0.commitment.toUpperCase()));
  check("sha256Buffer('abc') known value",
    sha256Buffer(Buffer.from("abc")) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  // Range / consistency properties over random inputs.
  let rangeOk = true;
  let popOk = true;
  let widthOk = true;
  let agreeOk = true;
  for (let t = 0; t < 2000; t++) {
    const seed = randomBytes(32).toString("hex");
    const key = Buffer.from(seed, "hex");
    const c = randomBytes(8).toString("base64");
    const n = t;
    const rows = 8 + (t % 9);
    const { slot, path } = computePathFromBuffer(key, c, n, rows);
    if (!(Number.isInteger(slot) && slot >= 0 && slot <= rows)) rangeOk = false;
    let pop = 0;
    for (let x = path; x; x >>= 1) pop += x & 1;
    if (pop !== slot) popOk = false;
    if (path < 0 || path >= 2 ** rows) widthOk = false;
    if (computeSlot(seed, c, n, rows) !== slot) agreeOk = false;
  }
  check("property: slot in 0..rows (2000 random draws, rows 8..16)", rangeOk);
  check("property: slot == popcount(path)", popOk);
  check("property: path fits in rows bits", widthOk);
  check("property: computeSlot == computePathFromBuffer.slot", agreeOk);

  // Bits are in {0,1}.
  check("property: directionBit in {0,1}",
    [0, 1, 2, 3, 4, 5].every(() => [0, 1].includes(directionBit(randomBytes(32).toString("hex")))));

  // Argument guards.
  function throws(f: () => unknown): boolean {
    try { f(); return false; } catch { return true; }
  }
  const k0 = Buffer.from(v0.serverSeed, "hex");
  check("guard: rows 7 and 17 rejected", throws(() => computeSlotFromBuffer(k0, "a", 0, 7)) && throws(() => computeSlotFromBuffer(k0, "a", 0, 17)));
  check("guard: negative / fractional nonce rejected", throws(() => computeSlotFromBuffer(k0, "a", -1, 8)) && throws(() => computeSlotFromBuffer(k0, "a", 1.5, 8)));
  check("guard: short digest rejected by directionBit", throws(() => directionBit("abc")));

  return { pass, total, failed };
}

describe('Spec self-test — src/rng.ts against docs/ALGORITHM.md §5 vectors and properties (clean-room implementer)', () => {
  it(`all ${EXPECTED_CHECKS} spec checks pass`, function () {
    this.timeout(60_000);
    const r = runSelftest();
    assert.deepStrictEqual(r.failed, []);
    assert.strictEqual(r.total, EXPECTED_CHECKS);
    assert.strictEqual(r.pass, EXPECTED_CHECKS);
  });
});
