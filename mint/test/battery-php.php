<?php
// © BSV Association — Open BSV License v6.
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
check('genesis is level 1',         level_of($g), 1);
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
check('tick 20 is still level 1',  level_of($t), 1);

// scan progress: cr advanced 10 pixels from the left edge of row 0
$cols = ($t['cr'] - $g['cr']) / $step0;
check('the scan has advanced 10 pixels', (int) round($cols), 10);
$p = frame_progress($t);
check('frame progress is a sane fraction', $p > 0 && $p < 0.001);
printf("        level %d · pixel %d of %d · %.4f%% of frame 1\n", level_of($t), (int) round($cols), 256 * 192, $p * 100);

// ── a non-battery script must be rejected, not guessed at ────────────────────
check('a P2PKH script is NOT read as a battery', battery_state('76a914' . str_repeat('11', 20) . '88ac'), null);
check('a truncated battery script is rejected',   battery_state(BAT_PREFIX . '0500'), null);

echo "\n$pass/" . ($pass + $fail) . " checks passed\n";
if ($fail > 0) { echo "BATTERY.PHP: FAIL\n"; exit(1); }
echo "BATTERY.PHP OK — the board reads the same picture the chain computed.\n";
