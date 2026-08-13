<?php
// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE). Part of the BRC-226 reference.
// THE BATTERY — the live page's chain-follow cache. Serves { fuel, ticks, state, tip, board[] }.
//
//   GET  (no args)   → the cached JSON (fast; no chain calls unless stale)
//   GET  ?sync       → force a chain reconcile (throttled): walk any new ticks/top-ups onto the board
//   POST {"txid":…}  → a freshly-broadcast top-up reports itself; verified on-chain, then recorded
//
// TRUST MODEL, as with tip.php: nothing is taken on faith. A hop is only recorded if the chain shows the
// tx actually SPENDS the current tip's battery output (vin → tip:0) AND that its own output 0 is a
// well-formed battery script. The covenant already enforced the rest — one iteration, the value floor —
// so once a spend of tip:0 is seen we simply read the new state out of the bytes.
//
// A CONTRIBUTION is a hop where output 0's value ROSE. That is the whole board: no registry, no
// moderation queue, no separate covenant. Contribution and signature are atomic by construction, so the
// board is a VIEW over the chain — find the ticks where the fuel went up, read the mark, rank by amount.
//
// ⚠ Marks are user-supplied bytes on a public chain. They are escaped as text by the client and NEVER
// auto-linked — permanent, unmoderatable live links would be an abuse vector.

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
$ALLOW = ['https://grafverse.com', 'https://grafspace.com', 'https://wallet.grafverse.com'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $ALLOW, true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Vary: Origin');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

// ── config ─────────────────────────────────────────────────────────────────
// The canonical battery. A second genesis with identical parameters is a different, irrelevant chain.
$GENESIS_TXID = 'd9a55ddb6c52bc51425f3c9e1416033179899e76abd634deda4510eed3790146';
$BATTERY_VOUT = 0;                  // the covenant is always output 0
$BOARD        = 21;                 // top 21 CONTRIBUTIONS (not contributors) — visibility has a price
$HOPS         = 12;                 // recent hops handed to the page to verify for itself (BRC-113)
$MAX_ADVANCE  = 60;                 // hops to catch up per request (bounds a viral burst)
$THROTTLE     = 6;                  // seconds between chain reconciles
$CACHE        = __DIR__ . '/battery-tip.json';
$WOC          = 'https://api.whatsonchain.com/v1/bsv/main';
$MAX_FEE      = 312;                // the covenant's permanent per-tick ceiling — used for the fuel gauge

// The covenant's fixed field prefix: pushData(0x50) pushData(0x01) pushData(0x07) then the nine fields.
//   01 50 | 01 01 | 01 07 | 05 cr | 05 ci | 05 zr | 05 zi | 02 i | 05 step | 05 cx | 05 cy | 02 mx
const BAT_PREFIX = '015001010107';
// [name, byte offset of the DATA, width] — the layout published in the genesis OP_RETURN
const BAT_FIELDS = [
  ['cr', 7, 5], ['ci', 13, 5], ['zr', 19, 5], ['zi', 25, 5], ['i', 31, 2],
  ['step', 34, 5], ['cx', 40, 5], ['cy', 46, 5], ['mx', 52, 2],
];

// ── rate-limited WoC client ─────────────────────────────────────────────────
// EVERY call from this file leaves the ONE server IP, and every open page asks us to reconcile. So the
// browser's per-visitor limit does not protect us: N visitors concentrate into a single client here, and
// a burst of catch-up hops is exactly the shape that gets an IP blocked. Three guards, cheapest first:
//
//   1. a minimum interval between calls (the same 350 ms floor the browser queue uses)
//   2. a hard budget of calls per request, so one slow visitor cannot walk 60 hops x 3 calls
//   3. on 429, stop immediately and remember it — a blocked IP must not be hammered into a longer block
//
// Being behind is harmless: the state is derived, the cache heals on the next request, and a board that
// lags a few seconds is far better than one that gets the site's IP banned from the chain.
$WOC_LAST = 0.0;          // monotonic-ish timestamp of the previous call
$WOC_CALLS = 0;           // calls made during THIS request
$WOC_BLOCKED = false;     // set when a relay rate-limits us
const WOC_MIN_INTERVAL = 0.35;   // seconds between calls
const WOC_CALL_BUDGET  = 90;     // per request

function woc_get($path) {
  global $WOC, $WOC_LAST, $WOC_CALLS, $WOC_BLOCKED;
  if ($WOC_BLOCKED || $WOC_CALLS >= WOC_CALL_BUDGET) return null;

  $wait = WOC_MIN_INTERVAL - (microtime(true) - $WOC_LAST);
  if ($wait > 0) usleep((int) ($wait * 1000000));

  $ch = curl_init($WOC . $path);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8,
    CURLOPT_USERAGENT => 'grafverse-battery/1', CURLOPT_HTTPHEADER => ['Accept: application/json']]);
  $out = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  $WOC_LAST = microtime(true); $WOC_CALLS++;

  if ($code === 429 || $code === 403) { $WOC_BLOCKED = true; return null; }
  if ($out === false || $code !== 200) return null;
  $j = json_decode($out, true);
  return is_array($j) ? $j : null;
}
function get_tx($txid) { return preg_match('/^[0-9a-f]{64}$/', $txid) ? woc_get("/tx/hash/$txid") : null; }

// ── reading the battery straight from the script bytes ───────────────────────
/** Decode a fixed-width SIGN-MAGNITUDE little-endian field (high bit of the last byte = negative). */
function sm_decode($bin) {
  $n = strlen($bin); if ($n === 0) return 0;
  $bytes = array_values(unpack('C*', $bin));
  $neg = ($bytes[$n - 1] & 0x80) !== 0;
  if ($neg) $bytes[$n - 1] &= 0x7f;
  $v = 0.0;
  for ($k = $n - 1; $k >= 0; $k--) $v = $v * 256 + $bytes[$k];   // float: values reach 2^34, beyond PHP int on 32-bit
  return $neg ? -$v : $v;
}
/** → the nine state fields, or null if this is not a battery script. */
function battery_state($scriptHex) {
  if (substr($scriptHex, 0, strlen(BAT_PREFIX)) !== BAT_PREFIX) return null;
  $b = @hex2bin($scriptHex); if ($b === false || strlen($b) < 54) return null;
  $out = [];
  foreach (BAT_FIELDS as [$name, $off, $w]) $out[$name] = sm_decode(substr($b, $off, $w));
  return $out;
}
function battery_vout($tx) { global $BATTERY_VOUT; return $tx['vout'][$BATTERY_VOUT]['scriptPubKey']['hex'] ?? null; }
function battery_value($tx) {
  global $BATTERY_VOUT;
  $v = $tx['vout'][$BATTERY_VOUT]['value'] ?? null;      // WoC reports BSV, not satoshis
  return $v === null ? null : (int) round($v * 100000000);
}
/** The contributor's OP_RETURN (00 6a <push> <bytes>) → raw UTF-8 string. Same parser as tip.php. */
function mark_of($tx) {
  foreach (($tx['vout'] ?? []) as $o) {
    $h = $o['scriptPubKey']['hex'] ?? '';
    if (substr($h, 0, 4) !== '006a') continue;
    $b = @hex2bin($h); if ($b === false || strlen($b) < 3) return '';
    $op = ord($b[2]); $i = 3; $len = 0;
    if ($op < 0x4c) { $len = $op; }
    elseif ($op === 0x4c) { $len = ord($b[3] ?? "\0"); $i = 4; }
    elseif ($op === 0x4d) { $len = ord($b[3] ?? "\0") | (ord($b[4] ?? "\0") << 8); $i = 5; }
    else return '';
    $s = substr($b, $i, $len);
    return mb_check_encoding($s, 'UTF-8') ? $s : '';      // never emit invalid UTF-8 into the JSON
  }
  return '';
}
function does_spend($tx, $tipTxid, $vout) {
  foreach (($tx['vin'] ?? []) as $in) if (($in['txid'] ?? '') === $tipTxid && (int) ($in['vout'] ?? -1) === $vout) return true;
  return false;
}

// ── derived, for the page ────────────────────────────────────────────────────
/** Zoom level from `step`: step = step0 / 2^(level-1), step0 = 4/256 * 2^32. */
function level_of($state) {
  $step0 = 4.0 / 256 * 4294967296.0;
  $s = $state['step'] ?? 0;
  if ($s <= 0) return 1;
  return (int) round(log($step0 / $s, 2)) + 1;
}
/** How far the scan has crossed the current frame, 0..1 — the picture's real progress. */
function frame_progress($state) {
  $W = 256; $H = 192;
  $step = $state['step'] ?? 0; if ($step <= 0) return 0.0;
  $cr0 = $state['cx'] - intdiv($W, 2) * $step;
  $ci0 = $state['cy'] - intdiv($H, 2) * $step;
  $col = ($state['cr'] - $cr0) / $step;
  $row = ($state['ci'] - $ci0) / $step;
  $done = $row * $W + $col;
  $p = $done / ($W * $H);
  return max(0.0, min(1.0, $p));
}

// ── cache ────────────────────────────────────────────────────────────────────
function load_cache() { global $CACHE; $j = @file_get_contents($CACHE); $c = $j ? json_decode($j, true) : null; return is_array($c) ? $c : null; }
function save_cache($c) { global $CACHE; @file_put_contents($CACHE, json_encode($c), LOCK_EX); }

function init_cache() {
  global $GENESIS_TXID;
  if ($GENESIS_TXID === '') return null;
  $tx = get_tx($GENESIS_TXID); if (!$tx) return null;
  $st = battery_state(battery_vout($tx) ?? ''); if (!$st) return null;
  return [
    'genesis' => $GENESIS_TXID,
    'tip' => ['txid' => $GENESIS_TXID, 'fuel' => battery_value($tx), 'state' => $st],
    'ticks' => 0,
    'hops' => [],                  // recent hop txids — the page verifies these, it does not trust them
    'board' => [],                 // contributions: every hop where the fuel ROSE
    'raised' => 0,                 // total ever contributed, beyond the genesis fuel
    'updated' => time(),
  ];
}

/**
 * Walk any new hops onto the cache. $hint = a candidate spender txid (from POST) for the FIRST hop.
 *
 * ⚠ Bounded by WALL CLOCK as well as hop count. Paced calls make a cold walk slow — 21 hops took ~59 s
 * in testing — and PHP's default max_execution_time is 30 s, so an unbounded loop would be KILLED
 * mid-walk. Since progress is only saved after the loop, that would discard everything and restart from
 * genesis on the next request: a walk that can never finish, however many times it is tried.
 * Breaking out cleanly instead means whatever was reached IS saved, and the next request carries on.
 */
function advance(&$c, $hint = null) {
  global $BATTERY_VOUT, $MAX_ADVANCE, $BOARD, $HOPS;
  $moved = 0; $boardChanged = false;
  $deadline = microtime(true) + 10.0;
  for ($i = 0; $i < $MAX_ADVANCE; $i++) {
    if (microtime(true) > $deadline) break;      // resume on the next request; the cache keeps the ground gained
    $tipTxid = $c['tip']['txid'];
    $spender = null;
    if ($i === 0 && $hint && preg_match('/^[0-9a-f]{64}$/', $hint)) {
      $t = get_tx($hint); if ($t && does_spend($t, $tipTxid, $BATTERY_VOUT)) $spender = [$hint, $t];
    }
    if (!$spender) { $found = discover_spender($tipTxid, $BATTERY_VOUT); if ($found) $spender = $found; }
    if (!$spender) break;
    [$sTxid, $sTx] = $spender;
    $st = battery_state(battery_vout($sTx) ?? ''); if (!$st) break;   // not a battery output → stop, don't guess
    $newFuel = battery_value($sTx); if ($newFuel === null) break;
    $oldFuel = (int) ($c['tip']['fuel'] ?? 0);

    // a CONTRIBUTION is simply a hop where the fuel went up
    if ($newFuel > $oldFuel) {
      $boardChanged = true;
      $added = $newFuel - $oldFuel;
      $c['board'][] = [
        'sats' => $added,
        'mark' => mark_of($sTx),
        'txid' => $sTxid,
        'tick' => $c['ticks'] + 1,
        'at'   => (int) ($sTx['time'] ?? time()),
      ];
      $c['raised'] = (int) ($c['raised'] ?? 0) + $added;
    }
    $c['tip'] = ['txid' => $sTxid, 'fuel' => $newFuel, 'state' => $st];
    $c['ticks']++;
    // The recent hop list is what the BROWSER verifies for itself (BRC-113): we supply the chain, it
    // checks linkage + covenant + the genesis Merkle anchor. Bounded, because a chain of millions of
    // ticks cannot be shipped to a page — and does not need to be. Miners already validated the middle.
    $c['hops'][] = $sTxid;
    if (count($c['hops']) > $HOPS) $c['hops'] = array_slice($c['hops'], -$HOPS);
    $moved++; $hint = null;
  }
  if ($moved) {
    // keep only the top 21 BY AMOUNT — visibility has an ongoing price, so nothing needs moderating
    usort($c['board'], function ($a, $b) { return $b['sats'] <=> $a['sats'] ?: $a['tick'] <=> $b['tick']; });
    if (count($c['board']) > $BOARD) $c['board'] = array_slice($c['board'], 0, $BOARD);
    $c['updated'] = time();
    save_cache($c);
    /* The card lists the funders, so the one event that changes it is the one event that triggers it —
       no cron, no polling, no staleness. Fail-safe: if it cannot be built the old card simply stays. */
    if ($boardChanged) {
      @require_once __DIR__ . '/battery-og.php';
      if (function_exists('battery_render_card')) @battery_render_card($c);
    }
  } elseif ($GLOBALS['WOC_BLOCKED']) {
    // rate-limited: push the next reconcile well out rather than retrying into a longer block
    $c['updated'] = time() + 60;
    save_cache($c);
  }
  return $moved;
}

/**
 * Best-effort discovery of the next hop: WoC scripthash history for the tip's own output script.
 *
 * ⚠ The scripthash is SHA-256(script) **BYTE-REVERSED** (the Electrum/WoC convention), matching
 * `wocScriptHash()` in mint/src/editionBuilder.ts. The non-reversed form 404s, silently making
 * discovery impossible — tip.php has that bug, so demo one can only learn about ticks that POST
 * themselves in, never about an external one.
 */
function discover_spender($tipTxid, $vout) {
  $tip = get_tx($tipTxid); if (!$tip) return null;
  $scriptHex = $tip['vout'][$vout]['scriptPubKey']['hex'] ?? null; if (!$scriptHex) return null;
  $sh = bin2hex(strrev(hash('sha256', hex2bin($scriptHex), true)));
  $hist = woc_get("/script/$sh/history"); if (!is_array($hist)) return null;
  foreach ($hist as $h) {
    $txid = $h['tx_hash'] ?? ''; if ($txid === '' || $txid === $tipTxid) continue;
    $t = get_tx($txid); if ($t && does_spend($t, $tipTxid, $vout)) return [$txid, $t];
  }
  return null;
}

/**
 * Backfill the recent-hop list by walking BACKWARDS from the tip.
 *
 * Needed because a cache that is already caught up never calls advance(), so `hops` would stay empty
 * forever on any battery that was being followed before hop-tracking existed.
 *
 * Walking back needs NO INDEX: every transaction names its own parent in its vin. Forward discovery
 * requires a script-hash history lookup — an indexer, the very thing BRC-113 exists to do without.
 * Backwards is both cheaper and more honest, so the backfill uses the direction the chain is built in.
 */
function backfill_hops(&$c) {
  global $BATTERY_VOUT, $HOPS;
  $have = $c['hops'] ?? [];
  if (count($have) >= $HOPS) return;

  $chain = [];
  $txid = $c['tip']['txid'] ?? null;
  $genesis = $c['genesis'] ?? '';
  for ($i = 0; $i < $HOPS && $txid; $i++) {
    array_unshift($chain, $txid);
    if ($txid === $genesis) break;                    // reached the anchor; nothing before it
    $tx = get_tx($txid); if (!$tx) break;
    $parent = null;
    foreach (($tx['vin'] ?? []) as $in) {
      // the covenant input is the one spending a battery output 0 — the others are funding
      if ((int) ($in['vout'] ?? -1) === $BATTERY_VOUT) { $parent = $in['txid'] ?? null; break; }
    }
    if (!$parent) break;
    $txid = $parent;
  }
  if (count($chain) > count($have)) { $c['hops'] = $chain; save_cache($c); }
}

// ── request handling ─────────────────────────────────────────────────────────
if (php_sapi_name() === 'cli' && empty($GLOBALS['BATTERY_RUN'])) return;   // CLI include → expose parsers for tests

$c = load_cache();
if (!$c) { $c = init_cache(); if ($c) save_cache($c); }
if (!$c) { echo json_encode(['error' => 'battery not reachable', 'genesis' => $GENESIS_TXID]); exit; }

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST') {
  $body = json_decode(file_get_contents('php://input'), true);
  $txid = is_array($body) ? ($body['txid'] ?? '') : '';
  advance($c, $txid);
} elseif (isset($_GET['sync'])) {
  if (time() - ($c['updated'] ?? 0) >= $THROTTLE) advance($c);
}

backfill_hops($c);        // a caught-up cache would otherwise never populate the hop list

$fuel  = (int) ($c['tip']['fuel'] ?? 0);
$state = $c['tip']['state'] ?? null;

echo json_encode([
  'genesis'  => $c['genesis'],
  'tipTxid'  => $c['tip']['txid'],
  'ticks'    => $c['ticks'],
  'fuel'     => $fuel,
  'ticksLeft' => intdiv($fuel, $MAX_FEE),        // the fuel gauge: "n ticks of fuel remaining"
  'maxFee'   => $MAX_FEE,
  'state'    => $state,
  'level'    => $state ? level_of($state) : null,
  'progress' => $state ? round(frame_progress($state), 6) : null,
  'raised'   => (int) ($c['raised'] ?? 0),
  'genesisAnchor' => $c['genesis'],              // BRC-113: prove THIS was mined and the rest follows
  'hops'     => array_values($c['hops'] ?? []),  // for the page to verify — NOT to believe
  'board'    => $c['board'],                     // already sorted by amount, capped at 21
  'updated'  => $c['updated'],
], JSON_UNESCAPED_UNICODE);
