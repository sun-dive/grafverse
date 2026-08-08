<?php
// grafverse — © 2026 sun-dive — Business Source License 1.1 (see LICENSE).
// BRC-226 LiveCounter — the live board's chain-follow cache. Serves { n, tipTxid, last21[] }.
//
//   GET  (no args)   → the cached board JSON (fast; no chain calls unless stale)
//   GET  ?sync       → force a chain reconcile (throttled): walk any new ticks onto the board
//   POST {"txid":…}  → the board reports a freshly-broadcast tick; verified on-chain, then appended
//
// TRUST MODEL: nothing is taken on faith. A tick is only recorded if the chain shows txid actually
// SPENDS the current tip's counter output (vin → tip:0). The covenant already enforced everything else
// (n→n+1, the relay refund, the author crumb), so once a spend of tip:0 is confirmed we simply read the
// new n + mark from the bytes. Fake "signers" cannot enter the board — the chain is the gatekeeper.

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
$GENESIS_TXID = '';                 // ← set to OUR canonical genesis txid at go-live (slice ⑥)
$COUNTER_VOUT = 0;                  // the counter covenant is always output 0
$BOARD        = 21;                 // "the last 21 signers"
$MAX_ADVANCE  = 40;                 // ticks to catch up per request (bounds a viral burst)
$THROTTLE     = 6;                  // seconds between chain reconciles
$CACHE        = __DIR__ . '/brc226-tip.json';
$WOC          = 'https://api.whatsonchain.com/v1/bsv/main';

// The covenant's fixed field prefix: pushData(0x50) 0x01 pushData(0x01) 0x01 pushData(0x06) 0x04 …
//   bytes: 01 50 | 01 01 | 01 06 | 04 <n:4 LE> | 14 <lastFunder:20> …  → n at offset 7, funder at offset 12
const LC_PREFIX = '01500101010604';
const LC_N_OFF = 7, LC_FUNDER_OFF = 12;

// ── tiny WoC client ─────────────────────────────────────────────────────────
function woc_get($path) {
  global $WOC;
  $ch = curl_init($WOC . $path);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8,
    CURLOPT_USERAGENT => 'grafverse-tip/1', CURLOPT_HTTPHEADER => ['Accept: application/json']]);
  $out = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  if ($out === false || $code !== 200) return null;
  $j = json_decode($out, true);
  return is_array($j) ? $j : null;
}
function get_tx($txid) { return preg_match('/^[0-9a-f]{64}$/', $txid) ? woc_get("/tx/hash/$txid") : null; }

// ── parsing counter + mark straight from tx bytes ────────────────────────────
function counter_state($scriptHex) {   // → [n, funderHex] | null  (validates the covenant field prefix)
  if (substr($scriptHex, 0, strlen(LC_PREFIX)) !== LC_PREFIX) return null;
  $b = @hex2bin($scriptHex); if ($b === false || strlen($b) < LC_FUNDER_OFF + 20) return null;
  $n = ord($b[LC_N_OFF]) | (ord($b[LC_N_OFF+1])<<8) | (ord($b[LC_N_OFF+2])<<16) | (ord($b[LC_N_OFF+3])<<24);
  return [$n, bin2hex(substr($b, LC_FUNDER_OFF, 20))];
}
function counter_vout($tx) { global $COUNTER_VOUT; return $tx['vout'][$COUNTER_VOUT]['scriptPubKey']['hex'] ?? null; }
function mark_of($tx) {                 // the signer's OP_RETURN (00 6a <push> <bytes>) → UTF-8 string
  foreach (($tx['vout'] ?? []) as $o) {
    $h = $o['scriptPubKey']['hex'] ?? '';
    if (substr($h, 0, 4) !== '006a') continue;
    $b = @hex2bin($h); if ($b === false || strlen($b) < 3) return '';
    $op = ord($b[2]); $i = 3; $len = 0;
    if ($op < 0x4c) { $len = $op; }
    elseif ($op === 0x4c) { $len = ord($b[3] ?? "\0"); $i = 4; }
    elseif ($op === 0x4d) { $len = ord($b[3] ?? "\0") | (ord($b[4] ?? "\0")<<8); $i = 5; }
    else return '';
    return substr($b, $i, $len);
  }
  return '';
}
function does_spend($tx, $tipTxid, $vout) {
  foreach (($tx['vin'] ?? []) as $in) if (($in['txid'] ?? '') === $tipTxid && (int)($in['vout'] ?? -1) === $vout) return true;
  return false;
}

// ── cache ────────────────────────────────────────────────────────────────────
function load_cache() { global $CACHE; $j = @file_get_contents($CACHE); $c = $j ? json_decode($j, true) : null; return is_array($c) ? $c : null; }
function save_cache($c) { global $CACHE; @file_put_contents($CACHE, json_encode($c), LOCK_EX); }

function entry($n, $mark, $funder, $txid) {
  return ['n' => $n, 'mark' => $mark, 'funder' => substr($funder, 0, 12), 'txid' => $txid];
}

// Seed the cache from the genesis tx (entry #0 = the opening mark, "Follow the white 🐇").
function init_cache() {
  global $GENESIS_TXID, $COUNTER_VOUT, $BOARD;
  if ($GENESIS_TXID === '') return null;
  $tx = get_tx($GENESIS_TXID); if (!$tx) return null;
  $st = counter_state(counter_vout($tx) ?? ''); if (!$st) return null;
  $g = entry($st[0], mark_of($tx), $st[1], $GENESIS_TXID);
  return ['genesis' => $GENESIS_TXID, 'tip' => ['txid' => $GENESIS_TXID, 'n' => $st[0]],
          'last21' => [$g], 'total' => $st[0], 'updated' => time()];
}

// Walk any new ticks onto the board. $hint = a candidate spender txid (from POST) for the FIRST hop.
function advance(&$c, $hint = null) {
  global $COUNTER_VOUT, $MAX_ADVANCE, $BOARD;
  $moved = 0;
  for ($i = 0; $i < $MAX_ADVANCE; $i++) {
    $tipTxid = $c['tip']['txid'];
    $spender = null;
    if ($i === 0 && $hint && preg_match('/^[0-9a-f]{64}$/', $hint)) {
      $t = get_tx($hint); if ($t && does_spend($t, $tipTxid, $COUNTER_VOUT)) $spender = [$hint, $t];
    }
    if (!$spender) { $found = discover_spender($tipTxid, $COUNTER_VOUT); if ($found) $spender = $found; }
    if (!$spender) break;
    [$sTxid, $sTx] = $spender;
    $st = counter_state(counter_vout($sTx) ?? ''); if (!$st) break;   // the covenant guarantees this is n+1
    $c['last21'][] = entry($st[0], mark_of($sTx), $st[1], $sTxid);
    if (count($c['last21']) > $BOARD) $c['last21'] = array_slice($c['last21'], -$BOARD);
    $c['tip'] = ['txid' => $sTxid, 'n' => $st[0]];
    $c['total'] = $st[0];
    $moved++; $hint = null;
  }
  if ($moved) { $c['updated'] = time(); save_cache($c); }
  return $moved;
}

// Best-effort discovery of an EXTERNAL spend (a tick not reported via POST): WoC scripthash history.
// scripthash = sha256(outputScript) hex. Returns [txid, tx] of the spend, or null if unresolved.
function discover_spender($tipTxid, $vout) {
  $tip = get_tx($tipTxid); if (!$tip) return null;
  $scriptHex = $tip['vout'][$vout]['scriptPubKey']['hex'] ?? null; if (!$scriptHex) return null;
  $sh = hash('sha256', hex2bin($scriptHex));                 // WoC scripthash (big-endian sha256 hex)
  $hist = woc_get("/script/$sh/history"); if (!is_array($hist)) return null;
  foreach ($hist as $h) {
    $txid = $h['tx_hash'] ?? ''; if ($txid === '' || $txid === $tipTxid) continue;
    $t = get_tx($txid); if ($t && does_spend($t, $tipTxid, $vout)) return [$txid, $t];
  }
  return null;
}

// ── request handling ─────────────────────────────────────────────────────────
if (php_sapi_name() === 'cli' && empty($GLOBALS['TIP_RUN'])) return;   // CLI include → expose parsers for tests, skip HTTP

$c = load_cache();
if (!$c) { $c = init_cache(); if ($c) save_cache($c); }
if (!$c) { echo json_encode(['error' => 'counter not deployed yet', 'genesis' => null]); exit; }

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST') {
  $body = json_decode(file_get_contents('php://input'), true);
  $txid = is_array($body) ? ($body['txid'] ?? '') : '';
  advance($c, $txid);   // verify + append this (and any further) ticks
} elseif (isset($_GET['sync'])) {
  if (time() - ($c['updated'] ?? 0) >= $THROTTLE) advance($c);   // throttled external reconcile
}

echo json_encode([
  'genesis' => $c['genesis'],
  'n'       => $c['total'],
  'tipTxid' => $c['tip']['txid'],
  'last21'  => array_reverse($c['last21']),   // newest first, for the board
  'updated' => $c['updated'],
], JSON_UNESCAPED_UNICODE);
