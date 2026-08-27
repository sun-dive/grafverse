<?php
// © 2026 sun-dive — Apache License 2.0.
// tip.php · discover_spender regression test.
//
//   php mint/test/tip-php.php
//
// Pins the ONE thing that was silently broken: the WoC scripthash is SHA-256(script) BYTE-REVERSED
// (Electrum/WoC convention). The un-reversed digest 404s every time, so discovery never worked and the
// LiveCounter board could only ever learn about ticks that reported themselves via POST. That failed
// silently — `n` would simply stop while the chain moved on — so it needs a test, not a comment.

require __DIR__ . '/../../tip.php';     // CLI include → functions only, no HTTP

$pass = 0; $fail = 0;
function check($name, $got, $want = true) {
  global $pass, $fail;
  $ok = $got === $want;
  echo ($ok ? 'PASS  ' : 'FAIL  ') . $name . "\n";
  $ok ? $pass++ : $fail++;
}

echo "tip.php — external tick discovery\n\n";

$GENESIS = '2a5c1c758fa58856f88c9d27aaba64f4616666399faf712a294875b67ee7aeee';

$gen = get_tx($GENESIS);
if (!$gen) { echo "SKIP — WhatsOnChain unreachable\n"; exit(0); }

// ── the orientation itself ───────────────────────────────────────────────────
$scriptHex = $gen['vout'][0]['scriptPubKey']['hex'];
$reversed = bin2hex(strrev(hash('sha256', hex2bin($scriptHex), true)));
$plain    = hash('sha256', hex2bin($scriptHex));
check('reversed and un-reversed hashes actually differ', $reversed !== $plain);
check('WoC answers the REVERSED hash',      is_array(woc_get("/script/$reversed/history")));
check('WoC 404s the un-reversed hash',      woc_get("/script/$plain/history") === null);

// ── the behaviour that was broken: finding a spend NOBODY reported ───────────
// The genesis counter output is long since spent by tick 1, so discovery must find it.
$found = discover_spender($GENESIS, 0);
check('discover_spender finds the genesis spend', is_array($found));
if (is_array($found)) {
  [$txid, $tx] = $found;
  check('the spender really does spend genesis:0', does_spend($tx, $GENESIS, 0));
  $st = counter_state(counter_vout($tx) ?? '');
  check('and it is a LiveCounter output', is_array($st));
  check('the covenant advanced it to n=1', $st[0], 1);
  echo "        tick 1 = $txid\n";
}

// ── an UNSPENT tip must return null, not a false positive ────────────────────
$c = load_cache();
if (is_array($c) && !empty($c['tip']['txid'])) {
  $tipTxid = $c['tip']['txid'];
  $spend = discover_spender($tipTxid, 0);
  // Either it is genuinely unspent (null), or someone ticked since the cache was written — both fine,
  // but a non-null result MUST be a real spend of that output, never noise from the history list.
  check('an unspent tip yields null (or a genuine spend)',
        $spend === null || does_spend($spend[1], $tipTxid, 0));
}

echo "\n$pass/" . ($pass + $fail) . " checks passed\n";
if ($fail > 0) { echo "TIP.PHP: FAIL\n"; exit(1); }
echo "TIP.PHP OK — the board can now see ticks that never reported themselves.\n";
