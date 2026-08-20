<?php
// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE). Part of BRC-226.
// Bitcoin Racers — the leaderboard's chain-follow cache. Serves the depot's own history of mints.
//
//   GET  (no args)   → the cached board JSON (fast; no chain calls at all unless ?sync)
//   GET  ?sync       → reconcile from the tip (throttled): append any mints made since
//   POST {"txid":…}  → a page that just raced reports its mint; VERIFIED on chain, then appended
//
// ── ★★ WHY THIS IS A CACHE AND NOT AN INDEX ───────────────────────────────────────────────────────
// Every mint is a hop in the depot's OWN chain, so the whole history is reachable by following one
// genesis txid. This file does that walk once and remembers it, so a visitor does not repeat it.
// ⚠⚠ IT IS AN ACCELERATOR, NEVER A DEPENDENCY. bitcoin-racers.html falls back to following the chain
// itself if this endpoint is absent, stale or refuses — which is what keeps "no indexer needed" a fact
// rather than a slogan. The fast path uses a cache; the correct path never requires one.
//
// ── ★★★ TRUST MODEL: IT CANNOT FAKE A LAP TIME ────────────────────────────────────────────────────
// Nothing here computes a time and the JSON does not contain one. What is stored is the car's HEAD —
// the raw bytes the chain carries — and the client RE-DERIVES the result from them with the same
// reference physics the covenant enforced when the race validated.
// ⇒ A wrong, stale or hostile cache can omit a row or add a bogus one. It cannot say a car was faster
// than its own setup allows, because it is not the thing that decides how fast a setup is.
// ⚠ And a row is only recorded once the chain shows the mint really spends the depot's tip. The
// covenant already enforced everything else; this only has to check the linkage.
//
// Modelled on tip.php (the BRC-226 LiveCounter board), deliberately — same shape, same throttle, same
// gatekeeper. A second pattern for the same problem is how two caches come to disagree.

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
$ALLOW = ['https://grafverse.com', 'https://grafspace.com', 'https://wallet.grafverse.com'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $ALLOW, true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Vary: Origin');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

// ── config ───────────────────────────────────────────────────────────────────
/* ⚠⚠ PLACEHOLDER — still the LIVE depot, because no beta depot has been minted yet. The anchored
   design needs a FRESH GENESIS (its pinned tail changes), and this must be repointed the moment
   that exists, or the beta board will keep reporting the live game's races as its own. */
$GENESIS_TXID = '607272d1b35d6f0c4f1179fef2e4556d41f9bfb4bbed394de1f83e300ee0d1d7';  // ⚠ the LIVE one-race depot
$GENESIS_VOUT = 0;
$MAX_ADVANCE  = 25;      // hops to catch up per request — bounds a burst, and the depot rate-limits anyway
$THROTTLE     = 8;       // seconds between chain reconciles
$MAX_ROWS     = 500;     // the board keeps this many races; older ones stay on chain, readable by anyone
$CACHE        = __DIR__ . '/racebeta-board.json';   // ⚠ ITS OWN FILE — sharing it would let the beta rewrite the live board
/* ⚠ the WoC base URL lives in woc.php now — one copy, or three of them drift apart. */

// ── tiny WoC client ──────────────────────────────────────────────────────────
// ⚠⚠⚠ THE WoC BUDGET IS A SHARED RESOURCE — one server IP, one limit at the far end. This file's own
// per-request guards were a step in the right direction and still could not bound it: four endpoints
// each politely allowing themselves 90 calls is 360 calls from one IP. ⇒ Everything now queues
// through woc.php, site-wide. → the exception to page-script isolation is argued in that file.
require_once __DIR__ . '/woc.php';   // ★ THE ONE GATE — see woc.php. Every chain call on this site queues here.
function woc_get($path) { return woc_json($path, 'grafverse-racers/1'); }
function get_tx($txid) { return preg_match('/^[0-9a-f]{64}$/', $txid) ? woc_get("/tx/hash/$txid") : null; }

/** ⚠ 404 means UNSPENT. Anything else means WE DO NOT KNOW — never report a guess as an answer. */
function spent_status($txid, $vout) {
  /* ⚠ 404 means UNSPENT. Anything else — including being throttled — means WE DO NOT KNOW, and that
     is NOT the same as "not raced". Reporting a guess here is what made a throttled walk look like a
     finished one on 20 Aug. ★ It used to make its own raw curl call and so escaped every guard; it
     is the biggest caller in the file (once per mint, then again per unraced car on every sync). */
  $code = woc_status("/tx/$txid/$vout/spent", 'grafverse-racers/1');
  if ($code === 404) return 'unspent';
  if ($code === 200) return 'spent';
  return 'unknown';
}

// ── reading the covenants straight from their bytes ──────────────────────────
/**
 * The one-race depot's state head: `04 <mark:4 LE> 01 <n:1>`, fixed width — two slices, no parsing.
 * Returns null for anything that is not a depot, which is how a top-up or a car is told apart.
 */
function depot_state($hex) {
  if (strlen($hex) < 14) return null;
  if (substr($hex, 0, 2) !== '04' || substr($hex, 10, 2) !== '01') return null;
  $b = @hex2bin(substr($hex, 0, 14)); if ($b === false) return null;
  $mark = ord($b[1]) | (ord($b[2])<<8) | (ord($b[3])<<16) | (ord($b[4])<<24);
  return ['mark' => $mark, 'n' => ord($b[6])];
}

/**
 * ★★ THE CAR'S HEAD, AT FIXED OFFSETS — AND IN EVERY LAYOUT THAT HAS EVER BEEN MINTED.
 *
 * ⚠⚠ NAME_BYTES went 12 → 24 on 20 Aug, so cars exist in two shapes. A reader that knew only the
 * current one found exactly ONE car and skipped every earlier race — not a short memory, a wrong
 * answer. ★ The head announces its own layout: the first byte is the name's PUSH LENGTH, 0x0c for the
 * 12-byte era and 0x18 for the 24-byte one. No version flag was needed; a push opcode already encodes
 * its own length.
 * ⇒ Add a width here whenever it changes. NEVER remove one — a minted car is permanent, and the only
 * thing that can stop it being readable is us forgetting how.
 */
function car_head($hex) {
  $b = @hex2bin($hex); if ($b === false || strlen($b) < 40) return null;
  foreach ([24, 12] as $nameW) {
    $fields = [['name', $nameW], ['fuel', 4], ['eng', 2], ['tyr', 2], ['slip', 2], ['finish', 6]];
    $i = 0; $out = []; $ok = true;
    foreach ($fields as [$name, $w]) {
      if ($i >= strlen($b) || ord($b[$i]) !== $w) { $ok = false; break; }
      $out[$name] = substr($b, $i + 1, $w);
      $i += 1 + $w;
    }
    if ($ok) { $out['_layout'] = "name\$$nameW"; return $out; }
  }
  return null;
}
function le_num($s) { $n = 0; for ($i = 0; $i < strlen($s); $i++) $n += ord($s[$i]) * pow(256, $i); return $n; }

function does_spend($tx, $txid, $vout) {
  foreach (($tx['vin'] ?? []) as $in)
    if (($in['txid'] ?? '') === $txid && (int)($in['vout'] ?? -1) === $vout) return true;
  return false;
}

/**
 * ⚠ THE SCRIPTHASH IS SHA-256(script) BYTE-REVERSED — the Electrum/WoC convention. tip.php shipped the
 * un-reversed digest once and discovery 404'd every single time, silently, so the board could only ever
 * learn about spends that reported themselves. Same mistake, already paid for; do not make it twice.
 */
/* ⚠⚠ THREE ANSWERS, NOT TWO — and collapsing them is what made a contribution invisible for two hours
   (sun-dive, 20 Aug). This returned `null` both for "the history is complete and nothing spends the
   tip" and for "the lookup failed", and `advance()` read every null as *we are current*. So one
   throttled call turned into a board that confidently showed a total from before the top-up existed.
   ⇒ `[$txid, $tx]` found · `null` genuinely unspent · `'unknown'` WE COULD NOT FIND OUT.
   ★ The page has said this all along and the server did not listen — `wocGet`'s own docstring in
   bitcoin-racers.html: "404 means UNSPENT. Anything else after backing off means WE DO NOT KNOW —
   never guess." */
function discover_spender($txid, $vout) {
  $tx = get_tx($txid); if (!$tx) return 'unknown';
  $hex = $tx['vout'][$vout]['scriptPubKey']['hex'] ?? null; if (!$hex) return 'unknown';
  $sh = bin2hex(strrev(hash('sha256', hex2bin($hex), true)));
  $hist = woc_get("/script/$sh/history"); if (!is_array($hist)) return 'unknown';
  foreach ($hist as $h) {
    $cand = $h['tx_hash'] ?? ''; if ($cand === '' || $cand === $txid) continue;
    $t = get_tx($cand); if ($t && does_spend($t, $txid, $vout)) return [$cand, $t];
  }
  return null;
}

/**
 * ★ THE CONTRIBUTOR'S MARK, out of a nulldata output. The top-up builder writes
 * `OP_FALSE OP_RETURN <push>`; a bare `OP_RETURN <push>` is equally valid, so both are read.
 * ⚠ Returns null for anything that is not one simple push — this is a stranger's bytes, and the
 * board is not the place to be clever about exotic script shapes.
 */
function op_return_text($tx) {
  foreach (($tx['vout'] ?? []) as $o) {
    $h = $o['scriptPubKey']['hex'] ?? ''; if ($h === '') continue;
    $b = @hex2bin($h); if ($b === false || strlen($b) < 3) continue;
    $i = 0;
    if (ord($b[0]) === 0x00 && ord($b[1]) === 0x6a) $i = 2;
    elseif (ord($b[0]) === 0x6a) $i = 1;
    else continue;
    if (!isset($b[$i])) continue;
    $len = ord($b[$i]);
    if ($len <= 0 || $len > 0x4b || strlen($b) < $i + 1 + $len) continue;
    $t = trim(substr($b, $i + 1, $len));
    if ($t !== '' && mb_check_encoding($t, 'UTF-8')) return $t;
  }
  return null;
}

// ── cache ────────────────────────────────────────────────────────────────────
function load_cache() { global $CACHE; $j = @file_get_contents($CACHE); $c = $j ? json_decode($j, true) : null; return is_array($c) ? $c : null; }
function save_cache($c) { global $CACHE; @file_put_contents($CACHE, json_encode($c), LOCK_EX); }

/* ⚠⚠ SCHEMA VERSION. The cache gained `gifts` and `val` on 20 Aug. An existing file has neither, and
   every top-up already on chain sits BEHIND the tip — so without a rebuild those contributions could
   never be walked again and the board would read a permanent zero. A schema change to a cache of
   settled data is a REBUILD, not a migration: one cold walk, once. */
define('CACHE_VER', 2);

function init_cache() {
  global $GENESIS_TXID, $GENESIS_VOUT;
  return ['ver' => CACHE_VER, 'genesis' => $GENESIS_TXID,
          'tip' => ['txid' => $GENESIS_TXID, 'vout' => $GENESIS_VOUT],
          /* `val` = the depot's satoshis at the tip. A BSV input carries no amount, so a gift's SIZE
             is only knowable by remembering what the tank held before it. */
          /* ⚠ `checked`/`degraded` are RUNTIME STATUS, not recorded hop shape, and both have safe
             defaults — so CACHE_VER deliberately does NOT move for them. Bumping it would force a cold
             re-walk of the whole chain to learn two things the next request answers for free. */
          'races' => [], 'gifts' => [], 'topups' => 0, 'val' => null,
          'updated' => 0, 'checked' => 0, 'degraded' => false];
}

/**
 * Follow the depot's own spends forward, appending any new races.
 * $hint = a candidate spender txid (from POST) tried FIRST, so a fresh race appears immediately
 * instead of waiting for discovery.
 */
function advance(&$c, $hint = null) {
  global $MAX_ADVANCE, $MAX_ROWS;
  $moved = 0;
  /* ⚠ CLEARED ON EVERY ATTEMPT. A walk that reaches the tip this time must not inherit the last
     walk's failure, or the board would nag for ever after one throttled minute. */
  $c['degraded'] = false;
  for ($i = 0; $i < $MAX_ADVANCE; $i++) {
    $tipTxid = $c['tip']['txid']; $tipVout = (int)$c['tip']['vout'];
    $spender = null;
    if ($i === 0 && $hint && preg_match('/^[0-9a-f]{64}$/', $hint)) {
      /* ⚠ THE GATEKEEPER. A reported txid is only believed if the chain shows it really spends the
         depot's current tip. Anyone may POST; only the chain decides. */
      $t = get_tx($hint); if ($t && does_spend($t, $tipTxid, $tipVout)) $spender = [$hint, $t];
    }
    if (!$spender) {
      $f = discover_spender($tipTxid, $tipVout);
      /* ⚠ NOT KNOWING IS NOT THE SAME AS BEING CURRENT. Stop, and say so — the client can then walk
         on from our tip with its own budget instead of trusting a total we cannot vouch for. */
      if ($f === 'unknown') { $c['degraded'] = true; break; }
      if ($f) $spender = $f;
    }
    if (!$spender) break;                                   // nothing has spent the tip: we ARE current
    [$sTxid, $sTx] = $spender;

    $depotAt = -1; $rows = [];
    foreach (($sTx['vout'] ?? []) as $o) {
      if ($depotAt < 0 && depot_state($o['scriptPubKey']['hex'] ?? '')) { $depotAt = (int)$o['n']; continue; }
    }
    foreach (($sTx['vout'] ?? []) as $o) {
      $n = (int)$o['n']; if ($n === $depotAt) continue;
      $h = car_head($o['scriptPubKey']['hex'] ?? ''); if (!$h) continue;
      /* ⚠ A MINTED CAR THAT WAS NEVER SPENT NEVER RACED — the spend IS the race. `unknown` is recorded
         as not-yet-raced rather than guessed at; the next sync will look again. */
      $raced = spent_status($sTxid, $n);
      $rows[] = [
        'mint'   => $sTxid,
        'vout'   => $n,
        'raced'  => $raced === 'spent',
        /* ★★ THE HEAD, RAW. No time is stored — the client re-derives it from these bytes with the
           reference physics, which is why this cache cannot lie about a result. */
        'head'   => ['name' => bin2hex($h['name']), 'fuel' => le_num($h['fuel']), 'eng' => le_num($h['eng']),
                     'tyr' => le_num($h['tyr']), 'slip' => le_num($h['slip']), 'finish' => le_num($h['finish'])],
        'layout' => $h['_layout'],
      ];
    }
    $newVal = $depotAt >= 0 ? (int)round(($sTx['vout'][$depotAt]['value'] ?? 0) * 1e8) : null;
    if (!$rows) {
      $c['topups']++;                                       // a top-up: spends the depot, mints no car
      /* ⛽ WHAT IT ADDED is exactly the RISE in the depot's own value — the contributor pays the miner
         from their own input, so there is nothing to net off. ⚠ Only recorded when the previous value
         is actually known; a gift of unknown size is left out rather than guessed at. */
      if ($newVal !== null && $c['val'] !== null && $newVal > $c['val']) {
        $c['gifts'][] = ['added' => $newVal - $c['val'], 'mark' => op_return_text($sTx), 'txid' => $sTxid];
        if (count($c['gifts']) > $MAX_ROWS) $c['gifts'] = array_slice($c['gifts'], -$MAX_ROWS);
      }
    }
    else $c['races'] = array_merge($c['races'], $rows);
    if ($newVal !== null) $c['val'] = $newVal;
    if (count($c['races']) > $MAX_ROWS) $c['races'] = array_slice($c['races'], -$MAX_ROWS);

    if ($depotAt < 0) break;                                // the owner burned it: the chain ends here
    $c['tip'] = ['txid' => $sTxid, 'vout' => $depotAt];
    $moved++; $hint = null;
  }
  /* ⚠ A car minted but not yet raced when we saw it may have raced since. Re-check the unraced ones,
     or a race stays invisible for ever because the mint was read a second too early. */
  foreach ($c['races'] as &$r) {
    if (!$r['raced']) { if (spent_status($r['mint'], $r['vout']) === 'spent') { $r['raced'] = true; $moved++; } }
  }
  unset($r);
  /* ★★ TWO CLOCKS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS — and having only one is why a stale board
     was indistinguishable from a quiet one.
       updated   when the DEPOT last did something. Hours old on a quiet day, and correct.
       checked   when WE last looked. This is the one a reader wants when asking "is this current?"
     ⚠ SAVED EVEN WHEN NOTHING MOVED. `checked` and `degraded` are the whole point of the attempt, so
     writing only on movement would throw away the answer we just paid a network call for. */
  $c['checked'] = time();
  if ($moved) $c['updated'] = time();
  save_cache($c);
  return $moved;
}

// ── request handling ─────────────────────────────────────────────────────────
if (php_sapi_name() === 'cli' && empty($GLOBALS['RACERS_RUN'])) return;   // CLI include → parsers only

$c = load_cache();
/* ⚠⚠ A STALE SCHEMA IS REBUILT, NOT PATCHED. A v1 file has no `gifts` and no `val`, and every top-up
   already on chain is BEHIND the tip — so patching the keys in would leave the contributions board
   reading a permanent, confident ZERO. Rebuilding costs one cold walk and is the only answer that is
   actually correct. ⇒ Bump CACHE_VER whenever a hop's recorded shape changes.
   ⚠ Also rebuilt if the genesis ever changes, which would otherwise serve another depot's history. */
if ($c && ((int)($c['ver'] ?? 1) !== CACHE_VER || ($c['genesis'] ?? '') !== $GENESIS_TXID)) $c = null;
if (!$c) { $c = init_cache(); advance($c); save_cache($c); }

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST') {
  $body = json_decode(file_get_contents('php://input'), true);
  $txid = is_array($body) ? ($body['txid'] ?? '') : '';
  advance($c, $txid);
} elseif (isset($_GET['sync'])) {
  /* ⚠⚠ THROTTLE ON `checked`, NOT ON `updated` — this was BACKWARDS. `updated` only moves when the
     chain moves, so a quiet depot left `time() - updated` enormous and EVERY page load walked, while a
     busy one throttled itself exactly when there was most to see. Now the rate of looking is bounded
     by when we last looked, which is the only thing it was ever meant to bound. */
  if (time() - ($c['checked'] ?? 0) >= $THROTTLE) advance($c);
}

echo json_encode([
  'genesis' => $c['genesis'],
  'tip'     => $c['tip'],            // where the client resumes if it wants to verify or extend itself
  'races'   => $c['races'],          // heads only — the client derives every time from them
  'gifts'   => $c['gifts'] ?? [],    // ⛽ who filled the tank: amount + mark. NEVER an address.
  'topups'  => $c['topups'],
  'updated' => $c['updated'],                        // when the DEPOT last moved
  'checked' => $c['checked'] ?? 0,                   // ★ when WE last looked — what "is this current?" means
  /* ⚠ TRUE means we could not reach the tip, so anything below may be incomplete. The client is
     expected to walk on from `tip` itself rather than believe this. */
  'degraded' => (bool)($c['degraded'] ?? false),
], JSON_UNESCAPED_UNICODE);
