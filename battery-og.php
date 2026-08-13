<?php
// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
// THE BATTERY — regenerate the social card when the board changes.
//
// Included by battery.php, which calls battery_render_card($c) ONLY when a new contribution is recorded.
// No cron: the one event that changes the card is the one event that triggers it.
//
// Pure PHP writes the fractal panel as a PPM — no GD, because that would be a second dependency for
// something that needs none. ImageMagick then sets the type, because it can do FONT FALLBACK via Pango
// and GD cannot: marks are user-supplied and contain emoji, and imagettftext renders anything missing
// from its single TTF as a tofu box.
//
// FAIL-SAFE BY DESIGN. If ImageMagick is missing, if anything throws — we return false
// and leave the existing card exactly where it is. A stale card is a small problem; a broken or blank
// one is on every share of the page until someone notices.

/**
 * Exact trunc(a * b / 2^32). PHP floats are IEEE doubles, exact only to 2^53, and zr*zr reaches 2^66 —
 * so `(int) ($zr * $zr / $FP)` silently rounds before it truncates. Bitcoin Script computes this
 * exactly, so an inexact card would show a pixel the chain never computed.
 * Mirrors mulShift() in battery.html and mint/src/battery.ts; the three must not drift.
 */
function battery_mulshift($a, $b) {
  $neg = ($a < 0) !== ($b < 0);
  $x = abs($a); $y = abs($b);
  $xh = floor($x / 65536); $xl = $x - $xh * 65536;
  $yh = floor($y / 65536); $yl = $y - $yh * 65536;
  $mid = $xh * $yl + $xl * $yh;
  $midHi = floor($mid / 65536); $midLo = $mid - $midHi * 65536;
  $q = $xh * $yh + $midHi + floor(($midLo * 65536 + $xl * $yl) / 4294967296);
  return $neg ? -$q : $q;
}

/** Locate an ImageMagick binary, or null. Cached for the request. */
function battery_magick() {
  static $bin = false;
  if ($bin !== false) return $bin;
  $bin = null;
  foreach (['magick', 'convert'] as $c) {
    $out = @shell_exec('command -v ' . escapeshellarg($c) . ' 2>/dev/null');
    if (is_string($out) && trim($out) !== '') { $bin = trim($out); break; }
  }
  return $bin;
}

/** Run a command with an ARGUMENT ARRAY — never a shell string. Marks are untrusted bytes. */
function battery_run(array $argv, $timeout = 20) {
  if (!function_exists('proc_open')) return false;
  $d = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
  $p = @proc_open($argv, $d, $pipes);              // PHP 7.4+: array form bypasses the shell entirely
  if (!is_resource($p)) return false;
  $start = time();
  stream_set_blocking($pipes[1], false); stream_set_blocking($pipes[2], false);
  do {
    $st = proc_get_status($p);
    if (!$st['running']) break;
    if (time() - $start > $timeout) { @proc_terminate($p); break; }
    usleep(50000);
  } while (true);
  foreach ($pipes as $pipe) @fclose($pipe);
  $code = @proc_close($p);
  return $code === 0;
}

/**
 * The fractal panel — written as a raw PPM in pure PHP. No GD.
 *
 * GD would work, but it would be a SECOND dependency for something that needs none: a PPM is a nine-byte
 * header and then RGB triples, and ImageMagick reads it natively. One dependency instead of two, and it
 * cannot fail on a host that shipped PHP without the gd extension — which is exactly what this machine
 * did, and what caught it.
 *
 * The arithmetic is the covenant's: truncating fixed point at 2^32, multiply first and divide last.
 */
function battery_panel($state, $path) {
  $W = 256; $H = 192; $S = 2; $FP = 4294967296.0; $ESC = 4 * $FP;
  $step = $state['step'] ?? 0; if (!($step > 0)) return false;
  $cr0 = $state['cx'] - ($W / 2) * $step;
  $ci0 = $state['cy'] - ($H / 2) * $step;
  $mx  = (int) $state['mx'];
  $done = ((int) round(($state['ci'] - $ci0) / $step)) * $W + (int) round(($state['cr'] - $cr0) / $step);

  // one row of source pixels becomes $S identical output rows
  $rows = [];
  for ($y = 0; $y < $H; $y++) {
    $row = '';
    for ($x = 0; $x < $W; $x++) {
      $p = $y * $W + $x;
      $cr = $cr0 + $x * $step; $ci = $ci0 + $y * $step;
      $zr = 0.0; $zi = 0.0; $i = 0; $emag = 0.0;
      while ($i < $mx) {
        $zr2 = battery_mulshift($zr, $zr);
        $zi2 = battery_mulshift($zi, $zi);
        if ($zr2 + $zi2 > $ESC) { $emag = $zr2 + $zi2; break; }   // keep |z|² for smooth shading
        $nzi = battery_mulshift(2 * $zr, $zi) + $ci;
        $zr = $zr2 - $zi2 + $cr; $zi = $nzi; $i++;
      }
      $inside = ($i >= $mx);
      /* MUST MATCH batteryInk() in battery.html — the card and the page have to be the same picture,
         or a share preview shows something the page does not draw. Smooth escape time, then a CYCLIC
         ramp with no reference to mx: escape ÷ mx tied the palette to the iteration budget and faded
         the filaments to flat ground as mx rose, even though the counts were unchanged. */
      if ($inside) { $r = 6; $g = 9; $b = 16; }
      else {
        $v = (float) $i;
        if ($emag > 0) {
          $m = sqrt($emag / $FP);
          if ($m > 1.0000001) {
            $q = $i + 1 - log(log($m)) / log(2.0);
            if (is_finite($q)) $v = $q;
          }
        }
        $t = fmod($v, 32.0) / 32.0;                  // BAND = 32, as in battery.html
        $t = max(0.0, min(1.0, $t));
        $r = 255 * min(1.0, $t * 2.1);
        $g = 190 * pow($t, 1.5);
        $b = 90 + 165 * pow(1 - $t, 1.7);
      }
      if ($p >= $done) {                             // not yet paid for
        $a = 0.42;
        $r = 5 + ($r - 5) * $a; $g = 7 + ($g - 7) * $a; $b = 13 + ($b - 13) * $a;
        if ($inside) { $r = 16; $g = 22; $b = 40; }
      }
      // the frontier — a short cursor where the chain's work stops
      $fx = $done % $W; $fy = intdiv($done, $W);
      if ($done > 0 && $x === $fx && abs($y - $fy) <= 3) { $r = 56; $g = 225; $b = 255; }
      $row .= str_repeat(chr((int) $r) . chr((int) $g) . chr((int) $b), $S);
    }
    for ($k = 0; $k < $S; $k++) $rows[] = $row;
  }
  $ppm = "P6\n" . ($W * $S) . " " . ($H * $S) . "\n255\n" . implode('', $rows);
  return @file_put_contents($path, $ppm) !== false;
}

/** Compose the card. Returns true only if a NEW card was actually written. */
function battery_render_card($c) {
  $magick = battery_magick();
  if (!$magick) return false;                       // no ImageMagick → keep the card we have

  $dir  = __DIR__;
  $panel = $dir . '/.battery-panel.ppm';
  $out   = $dir . '/battery-og.png';
  $tmp   = $dir . '/.battery-og-new.png';
  $state = $c['tip']['state'] ?? null;
  if (!$state || !battery_panel($state, $panel)) return false;

  $PW = 512; $PH = 384; $CW = 1200; $CH = 630;
  $PX = 44; $PY = 104; $RX = $PX + $PW + 46;
  $INK = '#f3f7ff'; $DIM = '#aebfe0'; $FAINT = '#7d92b8'; $CYAN = '#38e1ff'; $LIME = '#b4ff3a';
  $SANS = 'DejaVu-Sans'; $SANS_B = 'DejaVu-Sans-Bold'; $MONO = 'DejaVu-Sans-Mono-Bold';
  $step0 = 4.0 / 256 * 4294967296.0;
  $level = ($state['step'] ?? 0) > 0 ? ((int) round(log($step0 / $state['step'], 2)) + 1) : 1;
  $nf = function ($n) { return number_format((float) $n); };

  $a = [$magick, '-size', "{$CW}x{$CH}", 'xc:#05070d',
    $panel, '-geometry', "+{$PX}+{$PY}", '-composite',
    '-fill', 'none', '-stroke', '#1b2740', '-strokewidth', '1',
    '-draw', 'rectangle ' . ($PX - 1) . ',' . ($PY - 1) . ' ' . ($PX + $PW) . ',' . ($PY + $PH),
    '-stroke', 'none',
    '-fill', $FAINT, '-font', $SANS, '-pointsize', '13',
    '-annotate', '+' . $PX . '+' . ($PY + $PH + 26), 'solid = computed on chain   ·   faint = not yet paid for',
    '-fill', $INK, '-font', $SANS_B, '-pointsize', '36',
    '-annotate', '+' . $RX . '+' . ($PY + 30), 'The Bitcoin Battery',
    '-fill', $DIM, '-font', $SANS, '-pointsize', '17',
    '-annotate', '+' . $RX . '+' . ($PY + 60), 'a program that pays for its own execution',
    '-fill', $FAINT, '-font', $SANS, '-pointsize', '15',
    '-annotate', '+' . $RX . '+' . ($PY + 92),
      'tick ' . $nf($c['ticks'] ?? 0) . '   ·   frame ' . $level . '   ·   ' . $nf($c['tip']['fuel'] ?? 0) . ' sat of fuel',
  ];

  $board = array_slice($c['board'] ?? [], 0, 9);
  $a[] = '-fill'; $a[] = $FAINT; $a[] = '-font'; $a[] = $SANS_B; $a[] = '-pointsize'; $a[] = '13';
  $a[] = '-annotate'; $a[] = '+' . $RX . '+' . ($PY + 136);
  $a[] = $board ? 'TOP FUNDERS' : 'NOBODY HAS FUNDED IT YET';

  $y = $PY + 166;
  foreach ($board as $b) {
    $mark = trim(preg_replace('/\s+/u', ' ', (string) ($b['mark'] ?? '')));
    if ($mark === '') $mark = '(no mark)';
    if (function_exists('mb_substr')) $mark = mb_substr($mark, 0, 28, 'UTF-8');
    $a[] = '-fill'; $a[] = $LIME; $a[] = '-font'; $a[] = $MONO; $a[] = '-pointsize'; $a[] = '15';
    $a[] = '-annotate'; $a[] = '+' . $RX . '+' . $y;
    $a[] = str_pad($nf($b['sats'] ?? 0), 9, ' ', STR_PAD_LEFT) . ' sat';
    // the mark through PANGO — automatic font fallback, so an emoji survives. XML-escaped as markup.
    $esc = htmlspecialchars($mark, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $a[] = '('; $a[] = '-background'; $a[] = 'none';
    $a[] = 'pango:<span font="DejaVu Sans 11.5" foreground="' . $DIM . '">' . $esc . '</span>';
    $a[] = ')'; $a[] = '-geometry'; $a[] = '+' . ($RX + 122) . '+' . ($y - 13); $a[] = '-composite';
    $y += 27;
  }
  $more = count($c['board'] ?? []) - count($board);
  if ($more > 0) {
    $a[] = '-fill'; $a[] = $FAINT; $a[] = '-font'; $a[] = $SANS; $a[] = '-pointsize'; $a[] = '13';
    $a[] = '-annotate'; $a[] = '+' . $RX . '+' . ($y + 6); $a[] = 'and ' . $more . ' more';
  }

  $a[] = '-fill'; $a[] = $FAINT; $a[] = '-font'; $a[] = $SANS; $a[] = '-pointsize'; $a[] = '14';
  $a[] = '-annotate'; $a[] = '+' . $RX . '+' . ($CH - 92); $a[] = 'No toll gate. Every satoshi pays a miner.';
  $a[] = '-fill'; $a[] = $CYAN; $a[] = '-font'; $a[] = $SANS_B; $a[] = '-pointsize'; $a[] = '22';
  $a[] = '-annotate'; $a[] = '+' . $RX . '+' . ($CH - 58); $a[] = 'grafverse.com/battery.html';
  /* INDEXED, not truecolor: flat bands and type quantise to 256 colours with no visible loss (RMSE
     0.0007) and 91 KB becomes 18 KB — the same size as LOSSLESS WEBP, without WebP's og:image
     compatibility risk. A preview that fails to render is worse than one a few KB larger. */
  $a[] = '-colors'; $a[] = '256';
  $a[] = 'PNG8:' . $tmp;

  $ok = battery_run($a);
  @unlink($panel);
  // only replace a good card with another good one
  if ($ok && is_file($tmp) && filesize($tmp) > 3000) { @rename($tmp, $out); return true; }
  @unlink($tmp);
  return false;
}
