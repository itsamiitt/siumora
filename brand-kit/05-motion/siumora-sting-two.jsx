/* Siumora sting II — "chosen from the lattice". Ink stage, brass mark, one continuous composition.
   Expressive controls (DC props): mood, weave, energy, tagline. */
const { SceneStage, useScene, Easing, animate, clamp } = window;

const PALETTES = {
  'Brass on ink': { bg: '#14110F', stroke: '#C79A5C', accent: '#E3C08A', text: '#F7F3EA', mesh: 'rgba(199,154,92,0.26)' },
  'Ink on ivory': { bg: '#F7F3EA', stroke: '#1C1917', accent: '#6B2942', text: '#1C1917', mesh: 'rgba(28,25,23,0.2)' },
  'Mulberry': { bg: '#6B2942', stroke: '#EBDDD8', accent: '#E3C08A', text: '#F7F3EA', mesh: 'rgba(247,243,234,0.28)' },
};

const OPTS = {
  mood: 'Brass on ink',
  weave: 112,
  energy: 1,
  tagline: 'Something given, something kept',
};
const pal = () => PALETTES[OPTS.mood] || PALETTES['Brass on ink'];
const E = () => clamp(OPTS.energy, 0, 2);

const MOTION = {
  enter: (start, dur) => animate({ from: 0, to: 1, start, end: start + dur, ease: Easing.easeOutCubic }),
  draw: (start, dur) => animate({ from: 0, to: 1, start, end: start + dur, ease: Easing.easeInOutCubic }),
  push: (start, dur) => animate({ from: 0, to: 1, start, end: start + dur, ease: Easing.easeInCubic }),
};

/* shared settled values, so every scene boundary lands on the same frame */
const LAT_START = 1;
const LAT_SETTLE = () => LAT_START + 0.07 * E();
const LAT_END = () => LAT_SETTLE() + 6.2 * E();
const REVEAL_SCALE = () => 1 + 1.4 * E();
const RISE_Y = () => 48 * E();
const WORD_Y = () => 22 * E();

const S = 224;
const D = S / 2;
const K = 38;
const PETALS = [
  { key: 't', style: { left: D / 2, top: 0 } },
  { key: 'r', style: { top: D / 2, right: 0 } },
  { key: 'b', style: { left: D / 2, bottom: 0 } },
  { key: 'l', style: { top: D / 2, left: 0 } },
];

function Composition(p) {
  const c = pal();
  const cell = clamp(OPTS.weave, 48, 220);
  const cols = Math.ceil(1500 / cell) | 1;
  const rows = Math.ceil(900 / cell) | 1;
  const center = Math.floor((rows * cols) / 2);
  const cells = rows * cols;
  const wp = p.wordmark || 0;
  const letters = 'SIUMORA'.split('');
  const glow = p.glow || 0;

  return (
    <div style={{ position: 'absolute', inset: 0, background: c.bg, overflow: 'hidden' }}>
      {p.latticeOpacity > 0 ? (
        <div
          style={{
            position: 'absolute', left: '50%', top: '50%',
            display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
            opacity: p.latticeOpacity,
            transform: `translate(-50%, -50%) translate(${p.drift || 0}px, ${(p.drift || 0) * 0.4}px) scale(${p.latticeScale || 1})`,
          }}
        >
          {Array.from({ length: cells }, (_, i) => (
            <div
              key={i}
              style={{
                position: 'relative', width: cell, height: cell, borderRadius: 999,
                border: `1px solid ${i === center ? c.accent : c.mesh}`,
              }}
            >
              {i === center ? (
                <div
                  style={{
                    position: 'absolute', left: (cell - cell * 0.18) / 2, top: (cell - cell * 0.18) / 2,
                    width: cell * 0.18, height: cell * 0.18, borderRadius: 999, background: c.accent, opacity: glow,
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          transform: `scale(${p.breathe || 1})`,
        }}
      >
        <div
          style={{
            position: 'relative', width: S, height: S,
            opacity: p.markOpacity == null ? 1 : p.markOpacity,
            transform: `translateY(${p.markY || 0}px) scale(${p.markScale == null ? 1 : p.markScale})`,
          }}
        >
          {PETALS.map((q) => (
            <div
              key={q.key}
              style={{
                position: 'absolute', width: D, height: D, borderRadius: 999,
                border: `1.6px solid ${c.stroke}`, ...q.style,
              }}
            />
          ))}
          {p.sweep > 0 && p.sweep < 1 ? (
            <div
              style={{
                position: 'absolute', left: -22, top: -22, width: S + 44, height: S + 44,
                borderRadius: 999, border: `1.5px solid ${c.accent}`,
                borderRightColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: 'transparent',
                opacity: Math.sin(Math.PI * p.sweep) * 0.9,
                transform: `rotate(${p.sweep * (180 + 240 * E())}deg)`,
              }}
            />
          ) : null}
          {p.pulse > 0 && p.pulse < 1 ? (
            <div
              style={{
                position: 'absolute', left: (S - K) / 2, top: (S - K) / 2, width: K, height: K,
                borderRadius: 999, border: `1.5px solid ${c.accent}`,
                opacity: 0.5 * (1 - p.pulse), transform: `scale(${1 + (2 + 2.5 * E()) * p.pulse})`,
              }}
            />
          ) : null}
          <div
            style={{
              position: 'absolute', left: (S - K) / 2, top: (S - K) / 2, width: K, height: K,
              borderRadius: 999, background: c.accent,
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${p.wordY || 0}px)` }}>
          <div
            style={{
              display: 'flex', fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontSize: 64,
              color: c.text, letterSpacing: `${0.36 + 0.22 * (1 - wp)}em`, paddingLeft: `${0.36 + 0.22 * (1 - wp)}em`,
            }}
          >
            {letters.map((ch, i) => {
              const lp = clamp((wp - i * 0.05) / 0.55, 0, 1);
              return (
                <span key={i} style={{ display: 'inline-block', opacity: lp, transform: `translateY(${(1 - lp) * 16 * E()}px)` }}>
                  {ch}
                </span>
              );
            })}
          </div>
          <div style={{ height: 1, width: 190 * (p.rule || 0), background: c.stroke, opacity: 0.8, marginTop: 24 }} />
          <div
            style={{
              marginTop: 20, fontFamily: 'Jost, sans-serif', fontWeight: 300, fontSize: 17,
              letterSpacing: '0.28em', paddingLeft: '0.28em', color: c.text, textTransform: 'uppercase',
              opacity: (p.tagline || 0) * 0.8, transform: `translateY(${(1 - (p.tagline || 0)) * 14}px)`,
            }}
          >
            {OPTS.tagline}
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 44, textAlign: 'center',
          fontFamily: 'Jost, sans-serif', fontWeight: 300, fontSize: 12,
          letterSpacing: '0.34em', paddingLeft: '0.34em', color: c.text, opacity: (p.url || 0) * 0.55,
        }}
      >
        SIUMORA.COM
      </div>
    </div>
  );
}

const breatheOf = (progress) => 1 + 0.006 * E() * Math.sin(Math.PI * progress);

/* 1 — a screen of identical circles; one of them is already lit */
function Lattice() {
  const { localTime, progress } = useScene();
  return (
    <Composition
      latticeOpacity={1}
      latticeScale={LAT_START + (LAT_SETTLE() - LAT_START) * Easing.easeInOutSine(progress)}
      drift={6 * progress}
      glow={MOTION.enter(0.7, 1.3)(localTime)}
      markOpacity={0}
      markScale={REVEAL_SCALE()}
    />
  );
}

/* 2 — the camera pushes into the lit cell; its four neighbours become the mark */
function Chosen() {
  const { localTime, progress, dur } = useScene();
  const push = MOTION.push(0, dur * 0.85)(localTime);
  const reveal = MOTION.draw(dur * 0.34, dur * 0.5)(localTime);
  return (
    <Composition
      latticeOpacity={1 - reveal}
      latticeScale={LAT_SETTLE() + (LAT_END() - LAT_SETTLE()) * push}
      drift={6}
      glow={1}
      markOpacity={reveal}
      markScale={REVEAL_SCALE() - (REVEAL_SCALE() - 1) * reveal}
      breathe={breatheOf(progress)}
    />
  );
}

/* 3 — the piece is finished: a polish sweep, the kernel rings, the name arrives */
function Set() {
  const { localTime, progress } = useScene();
  const rise = MOTION.draw(0.5, 1.2)(localTime);
  return (
    <Composition
      latticeOpacity={0}
      markY={-RISE_Y() * rise}
      markScale={1 - 0.22 * rise}
      wordY={-WORD_Y() * rise}
      sweep={clamp(localTime / 1.5, 0, 1)}
      pulse={clamp((localTime - 0.25) / 1.2, 0, 1)}
      wordmark={MOTION.enter(1.1, 1.5)(localTime)}
      breathe={breatheOf(progress)}
    />
  );
}

/* 4 — signoff */
function Signoff() {
  const { localTime, progress } = useScene();
  return (
    <Composition
      latticeOpacity={0.1 * MOTION.draw(0.4, 1.6)(localTime)}
      latticeScale={LAT_END()}
      drift={6 + 14 * progress}
      glow={1}
      markY={-RISE_Y()}
      markScale={0.78}
      wordY={-WORD_Y()}
      wordmark={1}
      rule={MOTION.draw(0.3, 1)(localTime)}
      tagline={MOTION.enter(1.2, 1.1)(localTime)}
      url={MOTION.enter(1.9, 1)(localTime)}
      breathe={breatheOf(progress)}
    />
  );
}

function SiumoraStingTwo(props) {
  if (props.mood) OPTS.mood = props.mood;
  if (props.weave != null) OPTS.weave = +props.weave;
  if (props.energy != null) OPTS.energy = +props.energy;
  if (props.tagline != null) OPTS.tagline = props.tagline;

  return (
    <SceneStage width={1280} height={720} bg={pal().bg} scenes={window.OM_SCENES} playback={window.OM_PLAYBACK}>
      {{ Lattice: Lattice, Chosen: Chosen, Set: Set, Signoff: Signoff }}
    </SceneStage>
  );
}

window.SiumoraStingTwo = SiumoraStingTwo;
