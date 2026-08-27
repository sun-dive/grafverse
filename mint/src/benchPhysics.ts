// © 2026 sun-dive — Apache License 2.0 (see LICENSE).
/**
 * ★★★ THE BENCH'S OWN PHYSICS — FREE OF THE COVENANT, ON PURPOSE.
 *
 * > *"The covenant is to be written after the game physics and not before. The game play should not
 * > be ruled by the covenant during testing for game feel. Once we have tweaked the game and got it
 * > running properly, then we translate that to the covenant."* — sun-dive, 22 Aug 2026
 *
 * ⚠⚠⚠ WHY THIS FILE EXISTS. `racebeta.html` used to drive `laneSection` — the covenant's own
 * reference — and the page called that a virtue: *the bench cannot quietly disagree with the chain.*
 * That is exactly right for VERIFICATION and exactly backwards for FEEL, because every limit Script
 * has was leaking into the gameplay. In one evening, all of these were reported as game bugs:
 *
 * | what it felt like | what was actually causing it |
 * |---|---|
 * | the car only went off at the END of the turn | the deslot is tested at 45° arc boundaries |
 * | slowing down teleported it to the start | a section is ATOMIC — ten triggers are one spend |
 * | letting go of the trigger voided the run | `VERIFY v > 0`; `dt = Δs/v` is singular at rest |
 * | the trigger only bites four times a straight | four sub-steps, chosen at ~257 B of Script each |
 *
 * ⇒ So this model answers to the DRIVER and nothing else:
 *   · floating point, in real units — metres, seconds, m/s
 *   · stepped in TIME at frame resolution, not in distance
 *   · the trigger is continuous and read every step
 *   · the deslot is tested CONTINUOUSLY, so the car leaves where it actually runs out of grip
 *   · **a car is allowed to stop.** Standing still is a state, not a refusal, and a standing start
 *     works because nothing here needs a square root it cannot have
 *
 * ★★ AND IT KEEPS THE COVENANT'S ALGEBRA, deliberately. The motor is the same rheostat, the step is
 * the same `α − β·v` in the same implicit form. Only the LIMITS are gone. That is what makes the
 * translation back a matter of choosing a step size and a fixed-point scale, rather than a rewrite —
 * and it is why tuning here is not throwaway work.
 *
 * ⚠ ISOLATION. Reached only from `grafbeta.ts` → `vendor/grafbeta.js` → `racebeta.html`. It imports
 * NOTHING from `betaLane.ts`, `shell.ts` or the compiler, so no amount of tuning here can move the
 * live racers page, the depot, the battery or `basic.html`. → the page-script isolation rule.
 */

/** Everything the car and the track argue about, in real units. */
export interface BenchRegs {
  /** chassis mass, and what the engine · tyres · fuel add (kg) */
  M0: number; WE: number; WT: number; WF: number
  /**
   * Free speed of the reference motor through the reference wheel (m/s).
   * ⚠ NOT a top speed: a loaded motor never reaches it. It is where the pull falls to nothing.
   */
  VFREE: number
  /** Pull at the axle at full throttle, before the wheel divides it. */
  F0: number
  /** Rolling resistance, linear in v (1/s). */
  ROLL: number
  /**
   * ★ CONSTANT DRAG (m/s²) — the unpowered motor and gear train, and the term that lets a car STOP.
   * A drag linear in v approaches zero and never arrives; Coulomb friction stops a body in a finite
   * distance. `DRAGC = v² / 2s`, so a 6" coast from 2.16 m/s is 15.3.
   */
  DRAGC: number
  /**
   * ★ THE CONTROLLER IS A RHEOSTAT — series resistance, relative to the armature's.
   * Lifting cuts the CURRENT, so it makes the car WEAK, not slow: free speed never mentions it.
   * Real parts: a 90 Ω controller on a 15–21 Ω armature ⇒ 4.3–6.0.
   */
  RC: number
  /** What `VFREE` and `F0` are quoted at. */
  ENG_REF: number; DIA_REF: number; TYR_REF: number
  /** ★ GRIP: the car holds a corner while `v² ≤ K·r·slip·(tyr/TYR_REF)`. For a magnetless car K = µ·g. */
  K: number
  /** Fuel burned per metre: a floor, plus what the engine draws at full throttle. */
  BURN0: number; BURN_E: number
  /** Trigger clicks at full pull — the wheel's resolution, not the physics'. */
  THROTTLE_MAX: number
}

/**
 * ★ THE STARTING SET IS THE COVENANT'S CURRENT ONE, converted to real units — so the bench opens
 * where the feel already is and every change from here is one you made on purpose.
 * ⚠⚠ EVERY ONE OF THESE IS STILL PROVISIONAL. `K` in particular has never been measured: the 51 ft
 * lap times cannot settle it, because holding 1.73 m/s needs µ 2.00 on a 6" curve and µ 0.80 on a
 * 15" one, and nobody knows that layout's radii. The one real measurement is still a car let go on a
 * known radius: `K = v²/r`.
 */
export const BENCH_REGS: BenchRegs = {
  M0: 0.85, WE: 0.05, WT: 0.03,
  /* ⚠ WF = 0 IS A FINDING, NOT A GAP. At the drag-racing scaling the tank was ~90% of the car's mass,
     so power barely mattered and the whole field lapped within 0.08 s. A slot car does not carry its
     power — the rails do. ⇒ Fuel limits how LONG you may race, not how heavy you are. */
  WF: 0,
  VFREE: 2.375, F0: 311.4, ROLL: 0.08, DRAGC: 15.3, RC: 5.6,
  ENG_REF: 14, DIA_REF: 10, TYR_REF: 10,
  K: 10.6,
  /* ⚠ PER METRE, and rescaled from the covenant's per-SEGMENT figures — those were quoted against a
     40-step lap and mean nothing once the step is a frame. Set so a full tank is ~12 laps of the
     default layout, which is a race rather than an afterthought. */
  BURN0: 4200, BURN_E: 110,
  THROTTLE_MAX: 16,
}

export const IN = 0.0254

/** ★ where the grip lets go inside a 45° piece, at the limit — a third in. See `benchStep`. */
export const FLY_OUT_DEG = 15

/** One section: a straight, then a bend. The way you would lay the pieces on a board. */
export interface BenchSection {
  /** straight before the bend (m) */
  straight: number
  /** the bend that follows it */
  turnDeg: number
  /** which way it bends. PRESENTATION ONLY — the physics reads the radius and never the sign. */
  dir: number
  /** corner radius (m) */
  r: number
}

/** A lap as a list of sections, plus what the surface is doing. */
export interface BenchTrack {
  name: string
  sections: BenchSection[]
  /**
   * ★ Where the start/finish line sits, in metres along the lap. His: *"I think it was 1/3 the way
   * down the straight."* ⇒ A lap is measured from HERE, not from the first piece you happen to lay.
   */
  startAt?: number
  /** surface grip multiplier, 1 = clean. ★ This is his drop of oil, as a property of the TRACK. */
  slip: number
}

/**
 * ★★★ THE STRAIGHTS THE SHOP SOLD — and a straight may only be built from these, exactly.
 *
 * ⚠⚠ PROVISIONAL, AND AN ASSUMPTION OF MINE RATHER THAN SOMETHING HE SAID. What is known first-hand
 * is that his shop sold exactly two CURVES — turn left, turn right, one radius. He has never said
 * which STRAIGHT lengths existed, and 15″ is the only one this project has been working in.
 * ⇒ Until he says otherwise, treat every entry except 15 as a guess. Change this ONE array and every
 *   layout re-derives; nothing else hard-codes a length.
 */
export const STRAIGHT_PIECES = [12]

/**
 * Build `inches` from `pieces` exactly, fewest pieces first. `null` if it cannot be done — which is
 * a real answer, not a failure: it means that length was not something you could lay.
 *
 * ★ EXACT, NOT GREEDY. With only 15s and 9s, greedy takes 15 from 18 and strands a 3″ remainder,
 *   when 9 + 9 was right there — so a greedy fit reports "impossible" for lengths that are perfectly
 *   buildable. This is the same class of error as the `0S` parse: an approximation quietly answering
 *   a question that deserved an exact answer.
 */
export function straightPieces(inches: number, pieces: number[] = STRAIGHT_PIECES): number[] | null {
  if (inches === 0) return []
  const best: (number[] | null)[] = new Array(inches + 1).fill(null)
  best[0] = []
  for (let n = 1; n <= inches; n++) {
    for (const p of pieces) {
      if (p > n || best[n - p] === null) continue
      const cand = [...(best[n - p] as number[]), p]
      if (best[n] === null || cand.length < (best[n] as number[]).length) best[n] = cand
    }
  }
  const r = best[inches]
  return r ? [...r].sort((a, b) => b - a) : null
}

/** ★ every straight length that can actually be laid, up to `max` inches */
export const buildableStraights = (max: number, pieces: number[] = STRAIGHT_PIECES): number[] => {
  const out: number[] = []
  for (let n = 1; n <= max; n++) if (straightPieces(n, pieces)) out.push(n)
  return out
}

/** ★ The pieces the layouts are built from — the sizes this project has been working in throughout. */
export const PIECE = {
  /**
   * ★★★ ONE STRAIGHT, ONE CURVE — the whole set. *"All track pieces were the same length. If you
   * wanted a longer track you needed to add more pieces."* (sun-dive, 22 Aug)
   *
   * ★★ AND THE TWO ARE NOT INDEPENDENT. With every straight a whole number of pieces, closure needs
   * `L × k = 2r` for a positive integer k — so the piece length is FORCED by the corner radius, and
   * most pairings are impossible. 15″ straights cannot close against a 6″ corner at all; they would
   * need a 7.5″ or 15″ radius. ⇒ 12″ straights with 6″ corners is `k = 1`, the simplest root, and it
   * fits the plywood exactly at 96 × 36″.
   */
  STRAIGHT: 12 * IN, TIGHT: 6 * IN, WIDE: 9 * IN,
  /**
   * ★★★ ONE CURVE PIECE = 45°, and four of them make a U-turn. His shop's parts, told 22 Aug 2026:
   * *"I think it was 4, definitely not 8. 4 × 45 degrees for a 180."*
   * ⇒ With a single radius and a 45° piece, EVERY layout is a sequence of straights and L/R curves.
   *   That is the whole vocabulary, and it is why a layout can be recalled as counts rather than
   *   geometry: "six straights, four rights, two straights, two rights…"
   */
  CURVE_DEG: 45,
}

/**
 * ★★★ AN OVAL — TWO LONG STRAIGHTS AND TWO BENDS, and for tuning the feel it is the right shape.
 *
 * > *"The set I first bought was tiny — only a small figure 8. To make the track actually fun to play
 * > I bought a lot more track. Mostly straights and a few extra bends. Long straights are the most
 * > fun, because those allow one car to maybe outperform another and the cars would whizz down them.
 * > Which made timing the corners difficult, because you had to slow down or go off the track."*
 * > — sun-dive, 22 Aug 2026
 *
 * ★ TWO 180° BENDS OF THE SAME RADIUS CLOSE AT ANY STRAIGHT LENGTH — measured across 15″ to 90″, the
 * loop shuts exactly. So the straights can grow as long as you like, which is the whole point: a
 * layout that is mostly corner has no overtaking and no braking decision to get wrong.
 *
 * ★★ AND ONE CORNER RADIUS IS NOT A SIMPLIFICATION — IT IS THE REAL CONSTRAINT. His shop in New
 * Zealand sold exactly two curve parts: turn left, and turn right. Same radius, both of them.
 * ⇒ So corner CHARACTER came from sequence, never from parts: a hairpin is more of the same piece
 *   chained, a chicane is pieces alternating L then R. The variety is in the arrangement.
 * ⇒ Which means a layout is fully described by a run of straights and a run of L/R curve pieces —
 *   and that is a far easier thing to recall from memory than a list of radii.
 * ⚠ That is HIS shop, first-hand. What other markets stocked is not something this file knows.
 *
 * ⚠⚠ A NAMED LAYOUT IS A MODELLING SHORTCUT, NOT A FACT ABOUT HIS TRACK. His correction, 22 Aug:
 * *"it wasn't a simple figure 8. There are many ways to lay out the tracks."* The real model is an
 * arbitrary list of pieces with a closure check — this oval is the test rig, and it should not be
 * mistaken for the shape the game ships with.
 *
 * ⚠ `straights` is a COUNT OF 15″ PIECES, because that is how track is actually bought.
 */
export const benchOval = (straights = 4, radius = PIECE.WIDE, slip = 1): BenchTrack =>
  /* ★ BUILT FROM THE PIECES HE OWNS — four 45° curves to a U-turn, not one 180° bend. It matters
     because the FLY-OUT is measured within a piece, so the pieces have to be real. */
  benchLayout(straights + 'S 4R ' + straights + 'S 4R', radius, slip)

/**
 * ★★★ A LAYOUT AS THE PIECES YOU ACTUALLY OWN — the way you lay it out on the board.
 *
 * `S` 15″ straight · `M` 9″ · `T` 6″ · `Q` 3″ · `R` one 45° curve right · `L` one 45° curve left.
 * Spaces and commas ignored, and a leading count repeats, so `6S 4R 2S 2R` is six straights then four
 * rights and so on.
 *
 * ★★★ THE SHORT STRAIGHTS ARE NOT A CONVENIENCE — THEY ARE WHAT LETS A LAYOUT SHUT. His track needs
 * `S1 + S2 − S4 = −27″` and `S5 − S3 = +12″`, and neither is a multiple of 15. With 15″ pieces alone
 * the closest you can get is 3″ out on each axis, and √(3² + 3²) = 4.243″ — which is exactly the gap
 * the reconstruction could not shake. ⇒ 27 and 12 are both multiples of 3, so a 9″ or 6″ piece closes
 * it dead. Sets came with a mix of lengths for precisely this reason.
 *
 * ★ WHY THIS IS THE RIGHT MODEL. One radius and one curve angle means the vocabulary is two letters,
 * so a track can be written down from memory as COUNTS rather than geometry — which is the only form
 * a layout survives in when the track itself is gone.
 *
 * ⚠ CONSECUTIVE CURVES CHAIN with a zero-length straight between them, which the walker handles: a
 * `BenchSection` is "a straight then a bend", and a straight of length 0 is a perfectly good straight.
 */
export function benchLayout(spec: string, radius = PIECE.WIDE, slip = 1,
                            unit = PIECE.STRAIGHT): BenchTrack {
  const out: BenchSection[] = []
  let pending = 0                      /* straight metres waiting for a bend to attach to */
  /* ⚠ ONE LETTER NOW. `S` is one piece of track; there are no other lengths to name. */
  const LEN: Record<string, number> = { S: unit }
  const tokens = spec.toUpperCase().replace(/[^0-9SLR]/g, '').match(/\d*[SLR]/g) ?? []
  for (const tk of tokens) {
      /* ⚠ NOT `|| 1` — `parseInt('0S')` is 0 and `0 || 1` is 1, so a deliberate ZERO quietly became
         ONE. That turned an "arcs only" probe into one carrying five 15″ straights, and the closure
         equations got solved against it. → check the premise before diagnosing the symptom. */
      const lead = tk.slice(0, -1)
      const n = lead === '' ? 1 : parseInt(lead, 10), kind = tk[tk.length - 1]
    for (let i = 0; i < n; i++) {
      if (LEN[kind] !== undefined) pending += LEN[kind]
      else {
        out.push({ straight: pending, turnDeg: PIECE.CURVE_DEG, dir: kind === 'R' ? 1 : -1, r: radius })
        pending = 0
      }
    }
  }
  /* ⚠ trailing straights belong to the FIRST bend, because the lap wraps */
  if (pending > 0) {
    if (out.length) out[0] = { ...out[0], straight: out[0].straight + pending }
    else out.push({ straight: pending, turnDeg: 0, dir: 1, r: radius })
  }
  return { name: spec.trim(), sections: out, slip }
}

/**
 * ★★ DOES IT SHUT? Walk the pieces and report the gap between the last piece and the first.
 *
 * ⚠ A LAYOUT RECALLED FROM MEMORY USUALLY DOES NOT CLOSE, and the size of the gap is the clue: a gap
 * near one piece length means one piece is missing or misremembered, and there are rarely more than
 * a couple of candidates. ⇒ So this reports the gap rather than refusing the track — you can drive a
 * layout that does not quite shut while you work out which piece it was.
 */
export function benchClosure(track: BenchTrack): {
  gap: number; headingErr: number; closes: boolean; extent: { w: number; h: number }
} {
  let x = 0, y = 0, h = 0
  const xs = [0], ys = [0]
  for (const p of track.sections) {
    x += Math.cos(h) * p.straight; y += Math.sin(h) * p.straight; xs.push(x); ys.push(y)
    const t = p.dir * p.turnDeg * Math.PI / 180
    const cx = x - Math.sin(h) * p.r * p.dir, cy = y + Math.cos(h) * p.r * p.dir
    h += t; x = cx + Math.sin(h) * p.r * p.dir; y = cy - Math.cos(h) * p.r * p.dir
    xs.push(x); ys.push(y)
  }
  const deg = ((h * 180 / Math.PI) % 360 + 360) % 360
  const headingErr = Math.min(deg, 360 - deg)
  const gap = Math.hypot(x, y)
  /* ⚠⚠ THE TOLERANCE IS 1 mm, NOT A MICRON. It was 1e-6 m, which floating-point accumulation over a
     dozen pieces essentially never reaches — so the closure search reported NOTHING CLOSES, twice,
     and that was the checker failing rather than the geometry. Real track has slop in every joint;
     a millimetre over a lap is shut. → a red test is not evidence either. */
  return {
    gap, headingErr, closes: gap < 1e-3 && headingErr < 0.01,
    extent: { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
  }
}

/** the car, as three numbers the driver chose */
export interface BenchCar { eng: number; tyr: number; dia: number }

export interface BenchState {
  /** distance travelled (m) — the ONE coordinate; everything else is read off it */
  s: number
  v: number
  t: number
  fuel: number
  lap: number
  /** ★ it has left the slot. */
  off: boolean
  /**
   * ★★ OVER THE LIMIT AND SLIDING, BUT STILL ON — the moment a driver can still save it.
   * The tail is out and the fly-out point is approaching; lift and the car gathers itself up.
   */
  going: boolean
}

/**
 * ★★★ HIS TRACK — the one he built, reconstructed from the whiteboard, 22 Aug 2026.
 *
 * His lap, in his own words and his own order, starting at the line:
 *   the 2nd-longest straight · 180° LEFT · 180° RIGHT · the inner straight (about the same length) ·
 *   90° RIGHT · 180° LEFT · a short straight · 90° LEFT · THE LONG STRAIGHT · 90° LEFT ·
 *   a short straight · 90° LEFT · back to the line
 *
 * ★ THE TURNS SUM TO EXACTLY −360°, which is the check that says the memory is self-consistent: a
 * lap has to come back to its own heading, and this one does to 0.00° with nothing fudged.
 *
 * ⚠⚠ IT DOES NOT QUITE SHUT — 4.24″ (3√2″), and that number is worth understanding rather than
 * hiding. It is identical for every straight length and for all three of the variants he was unsure
 * about, so it is not the straights and not the misremembered bend: it is a residue of 45° pieces.
 * All five straights lie on the axes, so nothing in the layout can absorb a diagonal offset.
 * ⇒ Over ~32 joints that is about 3 mm each, which is inside what track flex and joint slop actually
 *   take up — layouts got persuaded together like this all the time. So: drive it, and treat the
 *   4.24″ as the tolerance it almost certainly was, not as a fault in his memory.
 *
 * ★★★ AND THE PLYWOOD PICKS THE CORNER. The board was a standard sheet — 8ft × 4ft, 96″ × 48″ — and
 * that single fact settles the radius: at 9″ every version of this lap overhangs the sheet, and only
 * the 6″ corner fits. So the curve his shop sold was the TIGHT one. Deduced from the board, not
 * assumed, and it is the kind of constraint that makes a reconstruction checkable.
 *
 * ★ On the sheet: 87″ × 42″, leaving 9″ across and 6″ up — which is where the plaster-of-paris hills
 *   went. A 274″ lap, 66% of it straight, and a longest straight of 75″: six foot three, flat out.
 *   ⇒ *"Long straights are the most fun."* It is two thirds of the lap.
 */
export const benchHisTrack = (slip = 1, linePct = 33): BenchTrack => {
  /**
   * ★★ HIS TRACK — from the lap he walked through out loud, on 12″ pieces and 6″ corners.
   *
   *   12″ · 180°L · 180°R · 60″ · 90°R · 180°L · 12″ · 90°L · 84″ · 90°L · 24″ · 90°L
   *
   * 96 × 36″ on the plywood · 286″ lap · closes to 0.000″ · 74% straight · longest run 84″.
   *
   * ⚠⚠ A FOUR-STRAIGHT VERSION WAS TRIED AND WAS WRONG — recorded so it is not tried again.
   * Searching for "four straights, longest possible, closes, fits 96 × 48" returned exactly two
   * layouts (mirror images), and `7S 4R 5S 2R 3S 4L 3S 6R` looked nothing like the whiteboard: a tall
   * narrow loop stuck on the left with the straights running past it. It only MEASURED 96 × 48
   * because of that loop, not because it used the board.
   * ⇒ THE LESSON: those constraints pin the bounding box, not the shape. Closure and fit are
   *   necessary and nowhere near sufficient — the drawing has to be LOOKED AT, and a candidate has to
   *   be rendered and compared before it is believed. Solving is not seeing.
   */
  const spec = '1S 4L 4R 5S 2R 4L 1S 2L 7S 2L 2S 2L'
  const t = benchLayout(spec, PIECE.TIGHT, slip, PIECE.STRAIGHT)
  /* ★ the line sits on the longest straight; `linePct` slides it along, 0 = the full 84″ run */
  const g = benchGeom(t)
  let at = 0, bestLen = 0, bestAt = 0
  for (let i = 0; i < g.L.length; i++) {
    if (g.L[i].straight > bestLen) { bestLen = g.L[i].straight; bestAt = at }
    at += g.L[i].len
  }
  return { ...t, name: 'the one he built', startAt: bestAt + bestLen * linePct / 100 + 1e-4 }
}

/**
 * Where the longest straight begins, in metres along the lap.
 *
 * ⚠ IT SUMS `benchGeom`'s OWN `len` VALUES, because `benchAt` walks the lap by subtracting exactly
 * those. Accumulating `straight + turnLen` separately drifts by a float or two and lands the line a
 * hair BEFORE the boundary — which put the start on the last curve of the previous section instead
 * of on the straight. Same numbers, same order, or the two disagree at every joint.
 */
function startOfLongest(spec: string, slip: number): number {
  const t = benchLayout(spec, PIECE.TIGHT, slip, PIECE.STRAIGHT)
  const g = benchGeom(t)
  let best = 0, bestLen = 0
  for (let i = 0; i < g.L.length; i++) {
    if (g.L[i].straight > bestLen) {
      bestLen = g.L[i].straight
      best = 0
      for (let j = 0; j < i; j++) best += g.L[j].len
    }
  }
  /* ⚠ A TENTH OF A MILLIMETRE PAST THE JOINT. Landing exactly ON a section boundary is ambiguous in
     floating point — `benchAt` takes a modulo first, and the line came back as "the final instant of
     the previous curve, 45° in" rather than the first inch of the straight. Physically nothing;
     it just puts the car unambiguously on the straight it is supposed to start on. */
  return best + 1e-4
}

/** arc length of a section's bend (m) */
export const benchTurnLen = (s: BenchSection): number => 2 * Math.PI * s.r * (s.turnDeg / 360)

/** ★ the lap, piece by piece — shared with the drawing so the picture and the physics cannot drift */
export function benchGeom(track: BenchTrack): {
  L: { r: number; len: number; straight: number; turn: number; dir: number; deg: number }[]
  lap: number
} {
  const L = []
  let lap = 0
  for (const s of track.sections) {
    const turn = benchTurnLen(s)
    L.push({ r: s.r, len: s.straight + turn, straight: s.straight, turn, dir: s.dir, deg: s.turnDeg })
    lap += s.straight + turn
  }
  return { L, lap }
}

/**
 * ★★ WHERE AM I, AND IS IT BENDING? The whole reason the deslot can now happen 20° into a corner
 * instead of at the end of one: the radius is a function of distance, sampled every step, so the
 * grip test asks about the piece of track under the car RIGHT NOW.
 * ⇒ `r = 0` means straight — no lateral limit at all, which is why being "over the corner's speed"
 *   on a straight is not a crash and never was.
 */
export function benchAt(track: BenchTrack, s: number): {
  sec: number; r: number; onArc: boolean; into: number; dir: number; deg: number
} {
  const g = benchGeom(track)
  let m = ((s % g.lap) + g.lap) % g.lap
  for (let k = 0; k < g.L.length; k++) {
    const L = g.L[k]
    if (m < L.straight) return { sec: k, r: 0, onArc: false, into: 0, dir: L.dir, deg: L.deg }
    if (m < L.len) return { sec: k, r: L.r, onArc: true, dir: L.dir, deg: L.deg,
                            into: (m - L.straight) / L.turn * L.deg }
    m -= L.len
  }
  const last = g.L[g.L.length - 1]
  return { sec: g.L.length - 1, r: 0, onArc: false, into: 0, dir: last.dir, deg: last.deg }
}

/** the speed this radius will hold (m/s). `r = 0` (a straight) has no limit — Infinity, not a number. */
export function benchCeiling(regs: BenchRegs, r: number, tyr: number, slip: number): number {
  if (r <= 0) return Infinity
  return Math.sqrt(regs.K * r * slip * (tyr / regs.TYR_REF))
}

/**
 * ★★★ ONE STEP, IN TIME.
 *
 * ⚠ THE STEP IS IMPLICIT, and that is worth keeping even though nothing here forces it. Acceleration
 * is linear in v — `a = α − β·v` — and the explicit form overshoots once `β·dt > 2`, which at real
 * slot-car forces it does. The backward form is a CONTRACTION toward equilibrium: it cannot pass free
 * speed at any step size, so a dropped frame cannot fling the car to Mach 3.
 *
 *      v' = (v + α·dt) / (1 + β·dt)
 *
 * ★ THE CAR MAY STOP, and this is the line that says so. `v` is clamped at zero rather than verified
 * above it: a stationary car is a state you can sit in and drive out of, not a refused transaction.
 * Coulomb drag would otherwise push it backwards, which is not a thing a slot car does.
 *
 * ⚠ AND A STANDING START WORKS. From rest the car moves only if `acc0 > DRAGC` — you have to give it
 * enough to break the gear train loose, which is both real and a nice thing to feel.
 */
export function benchStep(
  st: BenchState, car: BenchCar, th01: number, dt: number,
  regs: BenchRegs = BENCH_REGS, track: BenchTrack,
): BenchState {
  if (st.off) return st
  const th = Math.max(0, Math.min(1, th01))
  const mass = regs.M0 + car.eng * regs.WE + car.tyr * regs.WT + st.fuel * regs.WF
  const wheel = car.dia / regs.DIA_REF
  const vfree = regs.VFREE * (car.eng / regs.ENG_REF) * wheel

  /* ⚠ A RELEASED TRIGGER IS AN OPEN CIRCUIT — no drive, and no braking either. Letting go and
     lifting are genuinely different acts, and this is the line where they differ. */
  const acc0 = th > 0 ? regs.F0 / (1 + regs.RC * (1 - th)) / wheel / mass : 0
  const alpha = acc0 - regs.DRAGC
  const beta = acc0 / vfree + regs.ROLL

  let v = (st.v + alpha * dt) / (1 + beta * dt)
  if (v < 0) v = 0
  /* trapezoid on the distance — free, and it stops a fast car overshooting the corner entry */
  const ds = (st.v + v) / 2 * dt
  const s = st.s + ds
  const fuel = Math.max(0, st.fuel - (regs.BURN0 + car.eng * regs.BURN_E * th) * ds)

  /* ★★★ IT DOES NOT LET GO THE INSTANT IT IS OVER — IT FLIES OUT PARTWAY ROUND THE PIECE.
   *
   * > *"If we made the fly-out point half way around the 45 degree based on the speed at that moment,
   * > that would be pretty close to how it really is."* — sun-dive, 22 Aug 2026
   *
   * A car that arrives too fast does not vanish at the corner mouth. The lateral load builds as it
   * follows the curve, the back walks out, and it departs somewhere in the middle of the piece:
   *
   *     fly-out angle = 15° × (limit / v)        — a THIRD into a 45° piece when barely over
   *
   * ★ A THIRD, NOT A HALF — his correction, 22 Aug: *"if the fly out point was one third into the 45
   *   degree bend section, that might be more realistic and fun. The thing you'd do is full throttle
   *   out of a bend."* ⇒ It puts the danger at the ENTRY, which leaves the exit as somewhere you get
   *   back on the power. That is the technique the corner is supposed to teach.
   *
   * ⇒ Marginally over and you get most of the piece before it goes, which is time enough to lift and
   *   save it. Wildly over and you are gone almost at the mouth. Both are what actually happens.
   * ★ AND IT IS RECOVERABLE ON PURPOSE: re-evaluated every step against the CURRENT speed, so a
   *   driver who sees the tail step out and gets off the trigger can still gather it up. No latched
   *   state, no doom you cannot drive out of — which is the difference between a corner and a trap. */
  const prev = benchAt(track, st.s)
  const here = benchAt(track, s)
  const lim = benchCeiling(regs, here.r, car.tyr, track.slip)
  /* ★★ THE FLY-OUT IS A POINT, NOT A REGION, and that is what makes the exit drivable. The exposure
     is at the one-third mark of each 45° piece — the transient, where the load slams on and the back
     steps out. Get through it and the car is tracking round steadily and holds, which is exactly why
     *"the thing you'd do is full throttle out of a bend"* is a technique and not a death wish.
     ⚠ Evaluated as a CROSSING, so a long frame cannot step over the mark unnoticed. */
  const flyAt = FLY_OUT_DEG * Math.min(1, lim / v)
  const samePiece = prev.onArc && here.onArc && prev.sec === here.sec
  const atMark = here.onArc && here.into >= flyAt && (!samePiece || prev.into < flyAt)
  const off = atMark && v > lim
  /* ★ over the limit and still short of the mark: the tail is out and you can still save it */
  const going = here.onArc && v > lim && here.into < flyAt

  /* ⚠ LAPS ARE COUNTED FROM THE LINE, not from piece zero — otherwise the first lap is short by
     however far down the straight the line sits. */
  const g = benchGeom(track)
  const line = track.startAt ?? 0
  const lap = st.lap + (Math.floor((s - line) / g.lap) - Math.floor((st.s - line) / g.lap))

  return { s, v, t: st.t + dt, fuel, lap, off, going }
}

/** how hard the car is leaning on its grip, 0..1+ — the number the tail's attitude is drawn from */
export function benchLoad(
  st: BenchState, car: BenchCar, regs: BenchRegs = BENCH_REGS, track: BenchTrack,
): number {
  const here = benchAt(track, st.s)
  const lim = benchCeiling(regs, here.r, car.tyr, track.slip)
  return lim === Infinity ? 0 : st.v / lim
}

export const benchStart = (fuel: number, track?: BenchTrack): BenchState =>
  ({ s: track?.startAt ?? 0, v: 0, t: 0, fuel, lap: 0, off: false, going: false })

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   ★★★ PIECE STEPPING — the scheme the covenant will actually run, so the two COMPLY BY CONSTRUCTION.

   > *"The straight should pass the speed reached at the end of that track piece. The turns should
   > measure the speed at 20% into the corner."* — sun-dive, 22 Aug 2026

   ⚠⚠ AND THIS IS WHY THE BENCH GOES COARSER ON PURPOSE. Compliance does not need ACCURACY, it needs
   SAMENESS. There is no external truth for a game car to be wrong about: whatever stepping ships IS
   the physics. Tuning against a fine integration nobody will ever run just means tuning twice.
   ⇒ So the free game steps exactly as the chain will, and the two agree by definition rather than by
     chasing an error term down.

   ★ THE SHAPE FALLS OUT OF HIS RULE, and it is cheap:
       · a STRAIGHT piece  → integrate across it, carry the exit speed forward. One step.
       · a TURN piece      → integrate 20% of it, TEST there, then integrate the other 80%.
     So a corner is inherently two steps with the deslot test on the joint between them — no arbitrary
     sub-step count, no test point invented to suit the script.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ WHERE THE CAR GETS THROWN OFF — and this is the ONLY number left to tune.
 *
 * > *"So the only thing that really needs tuning is where does the car get thrown off the track.
 * > 10% 15% 20% 30% into the turn."* — sun-dive, 22 Aug 2026
 *
 * He is right, and the reason is structural: a straight piece makes no ruling at all — it just hands
 * its exit speed to the next piece. Every ruling in the game happens at ONE moment, this one.
 *
 * ⚠⚠ AND THE SUB-STEP COUNT IS NOT A SECOND DIAL — IT IS PART OF THE SPEC. Measured: at corner
 * throttle 3/16, ×1 sub-steps rules OFF at piece 7 while ×2, ×3 and ×6 all give a clean lap. The test
 * point does not move; the SPEED ARRIVING AT IT does. ⇒ So the free game and the chain must run the
 * identical count or they will disagree about whether you crashed. Fixed at 1. Never a slider.
 */
export const TEST_AT = 0.20

/** One piece of track, as it would be laid — and as the covenant's 2-bit track data describes it. */
export interface BenchPiece {
  kind: 'S' | 'L' | 'R'
  /** length along the slot (m) */
  len: number
  /** corner radius, 0 on a straight */
  r: number
  /** degrees of turn, 0 on a straight */
  deg: number
  /** distance from the lap's origin to this piece's start (m) */
  at: number
}

/**
 * ★ The lap as a flat list of pieces — one straight length, one corner, exactly what the shop sold.
 * ⚠ This is the SAME list the covenant reads as `S`/`L`/`R` at two bits each. One description doing
 * three jobs: the physics steps, the chain's data, and the 3D track's build instruction.
 */
export function benchPieces(track: BenchTrack, unit = PIECE.STRAIGHT): BenchPiece[] {
  const out: BenchPiece[] = []
  let at = 0
  for (const sc of track.sections) {
    const n = Math.round(sc.straight / unit)
    for (let i = 0; i < n; i++) { out.push({ kind: 'S', len: unit, r: 0, deg: 0, at }); at += unit }
    const arc = benchTurnLen(sc)
    out.push({ kind: sc.dir > 0 ? 'R' : 'L', len: arc, r: sc.r, deg: sc.turnDeg, at })
    at += arc
  }
  return out
}

/** the implicit step, over a distance — the one line both worlds share */
function advance(v: number, ds: number, th: number, car: BenchCar, regs: BenchRegs): number {
  if (v <= 0) return 0
  const mass = regs.M0 + car.eng * regs.WE + car.tyr * regs.WT
  const wheel = car.dia / regs.DIA_REF
  const vfree = regs.VFREE * (car.eng / regs.ENG_REF) * wheel
  const acc0 = th > 0 ? regs.F0 / (1 + regs.RC * (1 - th)) / wheel / mass : 0
  const alpha = acc0 - regs.DRAGC
  const beta = acc0 / vfree + regs.ROLL
  const dt = ds / v
  const nv = (v + alpha * dt) / (1 + beta * dt)
  return nv > 0 ? nv : 0
}

/** how long a stretch took, using the average speed across it */
const spanTime = (v0: number, v1: number, ds: number): number =>
  (v0 + v1) > 0 ? ds / ((v0 + v1) / 2) : 0

export interface PieceResult {
  v: number; t: number; fuel: number
  /** ★ it left the slot at the test point */
  off: boolean
  /** speed as measured at the test point (turns only) */
  vTest: number
}

/**
 * ★★★ RUN ONE PIECE. `subs` sub-steps per stretch — 1 is the cheap covenant, higher is smoother.
 * ⚠ The turn's test point is NOT a sub-step boundary by accident: the 20% mark splits the piece, and
 * the grip is read there whatever `subs` is, so the ruling never moves when you change the cost.
 */
export function benchRunPiece(
  v0: number, fuel: number, p: BenchPiece, th: number, car: BenchCar,
  regs: BenchRegs, track: BenchTrack, subs = 1, testAt = TEST_AT,
): PieceResult {
  const run = (v: number, ds: number): number => {
    for (let i = 0; i < subs; i++) v = advance(v, ds / subs, th, car, regs)
    return v
  }
  let v = v0, t = 0
  if (p.kind === 'S') {
    const nv = run(v, p.len)
    t = spanTime(v, nv, p.len); v = nv
    fuel = Math.max(0, fuel - (regs.BURN0 + car.eng * regs.BURN_E * th) * p.len)
    return { v, t, fuel, off: false, vTest: v }
  }
  /* ── a turn: 20% in, read the grip, then the rest ── */
  const dsA = p.len * testAt, dsB = p.len - dsA
  const vA = run(v, dsA)
  t += spanTime(v, vA, dsA)
  const lim = benchCeiling(regs, p.r, car.tyr, track.slip)
  const off = vA > lim
  const vB = run(vA, dsB)
  t += spanTime(vA, vB, dsB)
  fuel = Math.max(0, fuel - (regs.BURN0 + car.eng * regs.BURN_E * th) * p.len)
  return { v: vB, t, fuel, off, vTest: vA }
}
