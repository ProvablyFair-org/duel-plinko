/**
 * THE PINNED PASS 1 EXPERIMENT, DECLARED WHERE BOTH SIDES CAN READ IT.
 *
 * Pass 1 is 27 million rounds of Plinko played by this audit rather than by the casino, and it
 * is the surface the RTP claim rests on. A simulation that cannot be re-run is a table of
 * numbers with a story attached: it can be regenerated until it looks right, and nothing in the
 * package would notice.
 *
 * These seeds make it re-runnable. The experiment is a pure function of them, so anyone can
 * reproduce it — and, more to the point, `tests/steps/simulation.ts` (Step 19) replays ALL of it,
 * 27 × 1,000,000 rounds, on every `npm test` (since 2026-09-24; src/pass1.ts, src/parallel.ts) and
 * requires the committed census to come back exactly and every derived figure within the
 * reproduction tolerance. The seeds used to live inside `src/simulate.ts`, where the verifier could
 * not reach them without running the simulation; they live here so the generator and the
 * verifier read one copy.
 *
 * Generated once via crypto.randomBytes(32/16) and never regenerated: one pair per configuration
 * so seed-level variance averages out across the 27 boards instead of one seed's luck colouring
 * the mean.
 */

/** Rounds played per configuration in Pass 1. */
export const ROUNDS_PER_CONFIG = 1_000_000;

/** Round counts at which the running RTP is recorded. The trace's grid, declared in code. */
export const CONVERGENCE_SAMPLES = [1000, 5000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

/**
 * The LOCAL-ONLY prefix replay: with PF_P1_REPLAY=off, Step 19 replays just the first
 * REPLAY_ROUNDS rounds of each configuration and is capped at FLAG (never a publication pass). The
 * mutation battery uses it for mutations aimed at other steps. Until 2026-09-24 this prefix was the
 * only replay `npm test` ran — three of the seven convergence points; it did not prove the tail
 * (scripts/mutate.mjs M27b is a tail forgery it passed).
 */
export const REPLAY_ROUNDS = 10_000;

export const SIM_SEEDS: ReadonlyArray<{ server: string; client: string }> = Object.freeze([
  { server: '4734da3b9ebf8b9bf05461f2f200a0ec5e30b1d86958d320dbaff44946afe308', client: '3b98b5dd029f0432bb2cc0cacd913f0b' },
  { server: 'a77a393ff0ffb6a79b242d407ee59126fe6ff72fe0366d7463b8deecc3f12bfa', client: '52de9b72675f3b203e53f203acc14368' },
  { server: 'd6c13426f64d7667cd3917efec963f2ae191b88f0ea2d146fbec8a1b54e7fa26', client: 'e6e15047d0e36a885cfac10c630cbb89' },
  { server: '242b4a3baaf661314552abfb4f32df957dcc0c5792e2b3e800ee1225e9e7831f', client: 'e636f807a5c6da642a7b1ab5ef8e9310' },
  { server: 'eef97180f7b9c712c5a84f007ecacc3649b16ded668cc7c0e8a1107750d1430b', client: 'b5dd8ae30ccb0e63624d1ce9222f3b42' },
  { server: 'e3a19be07833913355d05a345820463dc382639ed0afcddea565e6f287bfa9f5', client: '7309998110aeb2ea0bda4e1e308536fc' },
  { server: 'c724369491b7f463eaeb8c262087ee9040ea59a8e4c3df4f2a9f815f42366ad1', client: '4b6028af4f38b18048019e53d8c34356' },
  { server: '27b10080294f19749a18b5e96f2d90b1217e2a61d0ad39e6cf9d4cea13c3d630', client: 'c4f92b4ebbc23ef9c0ee8030d2e47033' },
  { server: '61983e25ed1b73d759928d0771b363b0c29b62908e03087022ca052571b627d6', client: 'ee7e98c4fc555c749915ae0ee59111e2' },
  { server: '39672710a48198bc52881c72196676ffc474ad16595e164345d70b65de414515', client: 'd6c9433adaed36df16b1beeb411acc4d' },
  { server: '7495518801ca098391d673d44c968366b4df967e284880c3471222a137ba6564', client: '6f9f16080737a5307cda90b05476383f' },
  { server: 'f02b0c898fb5743fed49c59ef73bf9dc940761c1586c43c46787b3fb3a49b7ba', client: 'aadaf86124aa9c0f4ca5875938b430e5' },
  { server: '049bf25cf9c0d0371970502461f986c730ebb272cdc471f64c57cae2efc0fff9', client: 'f9724341f351c41ff6f3bbe67ce33a85' },
  { server: '4d3afb4a3b60e72abbe484a011bedc976420563d68ddf3e62007ad4746cce02f', client: '06deb1ec68c9a17a3adda2ca837a0210' },
  { server: '4842bbe9a9a97704c7821cfb1c6f18417401d9661edb0eb9131b9ecdf1261946', client: 'a53812f8d4ef9568807a007d57d72348' },
  { server: '343cfcc30c9bf3cf08a95ccf2642cf9c90b421e8110b45fee7d993db9b8838ab', client: '2b0cd94679e3000047e81f9d11d17fc6' },
  { server: 'ff29b9019b3fbd04ac79ce59144e5d5ec4c4f3644b7c4514bc00465ce387f3da', client: '0d70d4d1ea3c4f85f2a888e623bf12eb' },
  { server: 'acfaa736747a456c26ce6567ade6455fc7c939bd7cd8d83bcf184646a74f1f5a', client: 'e628a90b14dd0a03886d686044cb22c3' },
  { server: 'bc1d7599d2228b7122f444bf563b8124e5b8fa9942165f216a1517b8b3261a09', client: '35d1abf6d3db3ebe184b95e19675597e' },
  { server: '5715dbfdad17c85c134a10e975a9b825f668284ef72e077c211c32c0425e129a', client: '5571452b6b97ca92fd0c52ae16b03479' },
  { server: '367606fbd4bdccfe019990767c4e221ffff76fc8cce6ca5b8bbf2db064fe7847', client: '9b4e6ef70474da148d4431897976fe6d' },
  { server: 'ddc78cb1b21d3ebfdffbdb973221598318e58742c0d491bcb86ab30a55672da1', client: 'c39f1b507d5ca09885e4e16a4b704e51' },
  { server: 'cef7b4a0662fc95bae6b2a8d59d6b2be4dc7ed6acdba94c157404f1a3e44295e', client: 'eccc4279df1d61db01aaf5f9e0a740ea' },
  { server: 'd0a09bf70898e21e053b7321cc5158c9d887c7cf748991fd981c9a4de440c9b4', client: '5db27ce4edc73df187fe7472cf1a0c39' },
  { server: '3afa59daf050988753433b57401a98eb210289804bf8a15ce691472ac17196c0', client: 'a2b1ecb84dc2f7d5b8df77630c91d248' },
  { server: '460574281e70639cab174ceb0b22d6fa60207f6426cabbcaa42fe09a75948b5e', client: '7a9d6948a2d5ff1f61ca5860b364c01b' },
  { server: '9dd3211bf679f0341d7aff12bd9cb78563bbb236b1ec9fca6413b7ae914b3c62', client: '142fbf81688a033ab7012f003f875194' },
]);
