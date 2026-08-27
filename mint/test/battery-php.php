<?php
// © 2026 sun-dive — Apache License 2.0.
// battery.php parser check — read the battery's state straight from real mainnet script bytes and
// compare against the TypeScript reference. If these disagree, the board is lying about the picture.
//
//   php mint/test/battery-php.php
//
// The nine fields are read positionally from the locking script, so this also pins the published layout:
// a change to field order or width breaks here before it breaks the page.

require __DIR__ . '/../../battery.php';     // CLI include → parsers only, no HTTP

$pass = 0; $fail = 0;
function check($name, $got, $want = true) {
  global $pass, $fail;
  $ok = $got === $want;
  echo ($ok ? 'PASS  ' : 'FAIL  ') . $name . ($ok ? '' : "\n        got " . var_export($got, true) . ", want " . var_export($want, true)) . "\n";
  $ok ? $pass++ : $fail++;
}

echo "battery.php — parsing the live battery from mainnet bytes\n\n";

/* TWO BATTERIES, DELIBERATELY.
 *
 * PARSING is grid-independent — the nine fields are read positionally from script bytes, and the
 * layout is the same whatever W and H are. So those checks run against the LIVE genesis on mainnet,
 * which is real evidence rather than a fixture.
 *
 * LEVEL and FRAME PROGRESS are not: both divide by the grid, and battery.php holds the grid as a
 * constant because it serves one battery. The live genesis is the 256x192 one that is being replaced,
 * so asking battery.php's 3840x2160 constants to describe it is asking the wrong question — it
 * returned level -3 and 45% of a frame, which is exactly the nonsense you would expect.
 *
 * Those checks therefore run against a SYNTHETIC state at the deployed grid. When the new genesis is
 * minted, GENESIS_TXID below moves to it and the whole file runs against one battery again.
 */
$LIVE_W = BAT_W; $LIVE_H = BAT_H;
$LIVE_STEP0 = round(BAT_SPAN0 / $LIVE_W * 4294967296.0);

// ── genesis: frame 1, top-left pixel, z = 0 ──────────────────────────────────
$gen = get_tx('d9a55ddb6c52bc51425f3c9e1416033179899e76abd634deda4510eed3790146');
if (!$gen) { echo "SKIP — WhatsOnChain unreachable\n"; exit(0); }

$g = battery_state(battery_vout($gen));
check('genesis output IS a battery script', $g !== null);
$step0 = 4.0 / 256 * 4294967296.0;                       // 67,108,864
check('genesis step == step0 (frame 1, no zoom)', $g['step'], $step0);
check('genesis cr == -128 * step',  $g['cr'], -128.0 * $step0);
check('genesis ci == -96 * step',   $g['ci'], -96.0 * $step0);
check('genesis z == 0',             $g['zr'] == 0 && $g['zi'] == 0, true);
check('genesis i == 0',             $g['i'], 0.0);
check('genesis mx == MX0 (6)',      $g['mx'], 6.0);
/* level/progress at the DEPLOYED grid, not the live one — see the note above */
$syn = ['step' => $LIVE_STEP0, 'cx' => 0.0, 'cy' => 0.0,
        'cr' => -intdiv($LIVE_W, 2) * $LIVE_STEP0, 'ci' => -intdiv($LIVE_H, 2) * $LIVE_STEP0,
        'zr' => 0.0, 'zi' => 0.0, 'i' => 0.0, 'mx' => 128.0];
check('a genesis state at the deployed grid is level 1', level_of($syn), 1);
$synDeep = $syn; $synDeep['step'] = $LIVE_STEP0 / 1024;   // ten halvings
check('ten halvings reads as level 11', level_of($synDeep), 11);
check('genesis fuel == 10,000 sat', battery_value($gen), 10000);

// the layout published in the genesis OP_RETURN — the contract this parser depends on
$layout = mark_of($gen);
check('genesis publishes the field layout', str_contains($layout, 'fields cr,ci,zr,zi,i,step,cx,cy,mx'));
check('genesis publishes the widths',       str_contains($layout, 'widths 5,5,5,5,2,5,5,5,2'));

// ── tick 20: the state the TypeScript reference says it must be ──────────────
$tip = get_tx('47672fa42a3d1f021469ea475aeebfc3fd9f3d66ecfb26479ac40348fdc7dd2c');
$t = battery_state(battery_vout($tip));
check('tick 20 output IS a battery script', $t !== null);

// from `node tools/battery.mjs --status` — the reference renderer replayed 20 times
$want = ['cr' => -7918845952.0, 'ci' => -6442450944.0, 'zr' => 0.0, 'zi' => 0.0,
         'i' => 0.0, 'step' => 67108864.0, 'cx' => 0.0, 'cy' => 0.0, 'mx' => 6.0];
$agree = true;
foreach ($want as $k => $v) if ($t[$k] != $v) { $agree = false; echo "        $k: got {$t[$k]}, want $v\n"; }
check('PHP parse == the TypeScript reference state', $agree);

check('tick 20 fuel == 3,820 sat', battery_value($tip), 3820);
/* NOT level_of($t): tick 20 belongs to the 256x192 battery, and level_of divides by the deployed
   grid. Its step is unchanged from ITS genesis, which is the grid-free way to say the same thing —
   twenty ticks are nowhere near finishing a frame, so no zoom has happened. */
check('tick 20 has not zoomed — step still equals its own genesis step', $t['step'], $g['step']);

// scan progress: cr advanced 10 pixels from the left edge of row 0
$cols = ($t['cr'] - $g['cr']) / $step0;
check('the scan has advanced 10 pixels', (int) round($cols), 10);
/* progress, again at the deployed grid: advance the synthetic state by 10 pixels of its own row */
$synScan = $syn; $synScan['cr'] = $syn['cr'] + 10 * $LIVE_STEP0;
$p = frame_progress($synScan);
$expect = 10 / ($LIVE_W * $LIVE_H);
check('frame progress matches 10 pixels of the deployed grid', abs($p - $expect) < 1e-9);
printf("        deployed grid %dx%d · pixel 10 of %d · %.8f%% of frame 1\n",
  $LIVE_W, $LIVE_H, $LIVE_W * $LIVE_H, $p * 100);

// ── a non-battery script must be rejected, not guessed at ────────────────────
check('a P2PKH script is NOT read as a battery', battery_state('76a914' . str_repeat('11', 20) . '88ac'), null);
check('a truncated battery script is rejected',   battery_state(BAT_PREFIX . '0500'), null);

echo "\n$pass/" . ($pass + $fail) . " checks passed\n";
if ($fail > 0) { echo "BATTERY.PHP: FAIL\n"; exit(1); }
echo "BATTERY.PHP OK — the board reads the same picture the chain computed.\n";
