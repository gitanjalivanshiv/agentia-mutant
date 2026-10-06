import {formatDuration} from '../estimate.js'
import type {GroupScore, ReportModel} from './model.js'
import {typeLabel} from './model.js'

/**
 * Demo-grade, single-file HTML report (brief §10): no external fonts, scripts or CDNs, so the copy
 * committed to the repo renders anywhere, offline. Light and dark themes via prefers-color-scheme.
 */

export interface Comparison {
  before: {runId: string; percent?: number; killed: number; survived: number}
  after: {runId: string; percent?: number; killed: number; survived: number}
  /** Mutants that survived before and are killed after. */
  newlyCaught: {id: string; description: string; by?: string}[]
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Inline code spans for `backticks` in descriptions, escaped first. */
const rich = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')

function band(percent: number | undefined): 'bad' | 'mid' | 'good' | 'none' {
  if (percent === undefined) return 'none'
  return percent < 50 ? 'bad' : percent < 80 ? 'mid' : 'good'
}

function dial(percent: number | undefined, label: string): string {
  const r = 70
  const c = 2 * Math.PI * r
  const p = percent ?? 0
  return `<svg class="dial ${band(percent)}" viewBox="0 0 180 180" role="img" aria-label="${esc(label)}">
  <circle class="track" cx="90" cy="90" r="${r}" />
  ${p > 0 ? `<circle class="value" cx="90" cy="90" r="${r}" stroke-dasharray="${((p / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 90 90)" />` : ''}
  <text x="90" y="88" class="pct">${percent === undefined ? '–' : `${percent}%`}</text>
  <text x="90" y="114" class="sub">caught</text>
</svg>`
}

function diffBlock(diff: string): string {
  const lines = diff
    .split('\n')
    .filter((l) => l && !l.startsWith('---') && !l.startsWith('+++'))
    .map((l) => {
      const cls = l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : 'ctx'
      return `<span class="${cls}">${esc(l)}</span>`
    })
  // Block-level spans: joining with newlines inside <pre> would double-space the diff.
  return `<pre class="diff">${lines.join('')}</pre>`
}

function bar(g: GroupScore): string {
  const scored = g.killed + g.survived
  const pct = g.score === undefined ? undefined : Math.round(g.score * 100)
  return `<tr>
  <td>${esc(g.group)}</td>
  <td class="num">${g.killed}</td><td class="num">${g.survived}</td><td class="num muted">${g.total - scored}</td>
  <td class="barcell"><div class="bar ${band(pct)}"><span style="width:${pct ?? 0}%"></span></div></td>
  <td class="num strong">${pct === undefined ? '–' : `${pct}%`}</td>
</tr>`
}

function survivorCard(m: ReportModel['survivors'][number]): string {
  const healed = m.healedBy?.length
  return `<article class="card survivor${healed ? ' healed' : ''}">
  <header>
    <span class="chip">${esc(typeLabel(m.component.type))}</span>
    <span class="comp">${esc(m.component.apiName)}</span>
    ${healed ? `<span class="badge good">✔ now caught by “${esc(m.healedBy![0]!.name)}”</span>` : '<span class="badge bad">✘ survived</span>'}
  </header>
  <h3>${rich(m.description)}</h3>
  <p class="should"><strong>A test should check:</strong> ${rich(m.shouldCheck)}</p>
  <details${healed ? '' : ' open'}><summary>What Mutant changed <span class="muted">${esc(m.operator)}</span></summary>${diffBlock(m.diff)}</details>
  <footer class="muted">${[m.story && `story ${esc(m.story)}`, m.promotion && `promotion ${esc(m.promotion)}`, m.durations?.deploySeconds && `deploy ${formatDuration(m.durations.deploySeconds)}`, m.durations?.testSeconds && `tests ${formatDuration(m.durations.testSeconds)}`].filter(Boolean).join(' · ')}</footer>
</article>`
}

function comparisonBlock(c: Comparison): string {
  return `<section class="compare">
  <div class="cmp-side"><div class="cmp-label">Before</div><div class="cmp-pct ${band(c.before.percent)}">${c.before.percent ?? '–'}%</div><div class="muted">${c.before.killed} caught · ${c.before.survived} missed</div></div>
  <div class="cmp-arrow" aria-hidden="true">→</div>
  <div class="cmp-side"><div class="cmp-label">After healing</div><div class="cmp-pct ${band(c.after.percent)}">${c.after.percent ?? '–'}%</div><div class="muted">${c.after.killed} caught · ${c.after.survived} missed</div></div>
  ${
    c.newlyCaught.length
      ? `<ul class="newly">${c.newlyCaught.map((n) => `<li>✔ ${rich(n.description)}${n.by ? ` <span class="muted">— caught by “${esc(n.by)}”</span>` : ''}</li>`).join('')}</ul>`
      : ''
  }
</section>`
}

export function renderHtml(model: ReportModel, comparison?: Comparison): string {
  const s = model.score
  const unscored = s.invalid + s.timeout + s.error
  const when = new Date(model.createdAt).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  })
  const headline =
    model.percent === undefined
      ? 'No mutant could be scored in this run.'
      : `Your tests caught <strong>${s.killed} of ${s.killed + s.survived}</strong> configuration breakages.`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mutation Test Report</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--ink:#14171c;--muted:#5f6876;--line:#e3e6eb;--accent:#4f46e5;--good:#0f9d58;--mid:#d98a00;--bad:#d93025;--good-bg:#e6f4ea;--bad-bg:#fce8e6;--add:#e6f4ea;--del:#fce8e6;--add-ink:#0b6b3a;--del-ink:#a1251b;--code:#f1f3f6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1115;--panel:#171a21;--ink:#e8eaee;--muted:#9aa3b2;--line:#2a2f3a;--accent:#8b85ff;--good:#3ccf7c;--mid:#f0b23e;--bad:#ff6b5e;--good-bg:#12301f;--bad-bg:#3a1714;--add:#12301f;--del:#3a1714;--add-ink:#8ee6b0;--del-ink:#ffb1a8;--code:#20242d}}
:root[data-theme="dark"]{--bg:#0f1115;--panel:#171a21;--ink:#e8eaee;--muted:#9aa3b2;--line:#2a2f3a;--accent:#8b85ff;--good:#3ccf7c;--mid:#f0b23e;--bad:#ff6b5e;--good-bg:#12301f;--bad-bg:#3a1714;--add:#12301f;--del:#3a1714;--add-ink:#8ee6b0;--del-ink:#ffb1a8;--code:#20242d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:28px 16px 48px}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.brand{font-weight:800;letter-spacing:-.02em;font-size:20px}.brand span{color:var(--accent)}
.meta{color:var(--muted);font-size:13px}
.hero{display:grid;grid-template-columns:220px 1fr;gap:24px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px;align-items:center}
.dial{width:200px;height:200px}.dial circle{fill:none;stroke-width:16}.dial .track{stroke:var(--line)}.dial .value{stroke-linecap:round;stroke:var(--muted)}
.dial.bad .value{stroke:var(--bad)}.dial.mid .value{stroke:var(--mid)}.dial.good .value{stroke:var(--good)}
.dial .pct{font-size:40px;font-weight:800;text-anchor:middle;fill:var(--ink)}.dial .sub{font-size:13px;text-anchor:middle;fill:var(--muted)}
h1{font-size:24px;line-height:1.25;margin:0 0 6px;letter-spacing:-.01em}h1 strong{color:var(--accent)}
.lede{color:var(--muted);margin:0 0 16px}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.tile{border:1px solid var(--line);border-radius:12px;padding:10px 12px}.tile b{display:block;font-size:24px}.tile span{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.tile.k b{color:var(--good)}.tile.s b{color:var(--bad)}
.verified{margin-top:12px;font-size:13px;color:var(--good)}.verified.no{color:var(--bad)}
section{margin-top:28px}h2{font-size:17px;margin:0 0 12px}
.card{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--bad);border-radius:12px;padding:16px 18px;margin-bottom:12px}
.card.healed{border-left-color:var(--good)}
.card header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.card h3{font-size:16px;margin:8px 0 6px}.card footer{font-size:12px;margin-top:8px}
.chip{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;background:var(--code);border-radius:999px;padding:2px 8px}
.comp{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:var(--muted)}
.badge{margin-left:auto;font-size:12px;font-weight:600;border-radius:999px;padding:2px 10px}.badge.bad{background:var(--bad-bg);color:var(--bad)}.badge.good{background:var(--good-bg);color:var(--good)}
.should{background:var(--code);border-radius:8px;padding:8px 10px;margin:8px 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;background:var(--code);border-radius:4px;padding:0 4px}
details summary{cursor:pointer;font-size:13px;color:var(--muted)}
.diff{background:var(--code);border-radius:8px;padding:10px 0;overflow-x:auto;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;margin:8px 0 0}
.diff span{display:block;padding:0 12px;white-space:pre}.diff .add{background:var(--add);color:var(--add-ink)}.diff .del{background:var(--del);color:var(--del-ink)}.diff .hunk{color:var(--muted)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
tr:last-child td{border-bottom:0}.num{text-align:right;font-variant-numeric:tabular-nums}.strong{font-weight:700}.muted{color:var(--muted)}
.barcell{width:30%}.bar{height:8px;background:var(--line);border-radius:999px;overflow:hidden}.bar span{display:block;height:100%;background:var(--muted)}
.bar.bad span{background:var(--bad)}.bar.mid span{background:var(--mid)}.bar.good span{background:var(--good)}
.list{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px 16px}
.list li{list-style:none;padding:10px 0;border-bottom:1px solid var(--line)}.list li:last-child{border-bottom:0}
.list .why{font-size:13px;color:var(--muted)}.ok{color:var(--good);font-weight:700}.warn{color:var(--mid);font-weight:700}
.compare{display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}
.cmp-label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.cmp-pct{font-size:56px;font-weight:800;line-height:1.1}
.cmp-pct.bad{color:var(--bad)}.cmp-pct.mid{color:var(--mid)}.cmp-pct.good{color:var(--good)}.cmp-arrow{font-size:40px;color:var(--muted)}
.newly{grid-column:1/-1;margin:4px 0 0;padding:0}.newly li{list-style:none;padding:4px 0}
.fail{background:var(--bad-bg);color:var(--bad);border-radius:12px;padding:12px 16px;white-space:pre-wrap;font-size:13px}
.foot{margin-top:36px;color:var(--muted);font-size:13px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media (max-width:720px){.hero{grid-template-columns:1fr;justify-items:center;text-align:center}.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.compare{grid-template-columns:1fr}.cmp-arrow{transform:rotate(90deg)}.barcell{display:none}}
@media print{body{background:#fff}.card,.hero,table,.list,.compare{break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="brand">Agentia <span>Mutant</span></div>
    <div class="meta">Run ${esc(model.runId)} · ${esc(when)} UTC${model.durationSeconds ? ` · ${formatDuration(model.durationSeconds)}` : ''} · lab ${esc(model.lab.environment)} ← ${esc(model.lab.source)}</div>
  </div>

  ${comparison ? comparisonBlock(comparison) : ''}

  <div class="hero"${comparison ? ' style="margin-top:20px"' : ''}>
    ${dial(model.percent, `Mutation score ${model.percent ?? 'not available'}`)}
    <div>
      <h1>${headline}</h1>
      <p class="lede">Mutant deliberately broke your Salesforce configuration in ${esc(model.lab.environment)}, one change at a time, deployed each through Copado and ran your Robotic Testing suite (${model.baselineTests} test${model.baselineTests === 1 ? '' : 's'}). A breakage the tests noticed is <em>caught</em>; one they missed is a <em>blind spot</em>.</p>
      <div class="tiles">
        <div class="tile k"><b>${s.killed}</b><span>Caught</span></div>
        <div class="tile s"><b>${s.survived}</b><span>Blind spots</span></div>
        <div class="tile"><b>${unscored}</b><span>Not scored</span></div>
        <div class="tile"><b>${model.mutants.length}</b><span>Mutants</span></div>
      </div>
      ${model.verified === undefined ? '' : `<div class="verified${model.verified ? '' : ' no'}">${model.verified ? `✔ ${esc(model.lab.environment)} was reverted and verified identical to the baseline` : '✘ The lab did not match the baseline after the run'}</div>`}
    </div>
  </div>

  ${model.failure ? `<section><h2>Run problems</h2><div class="fail">${esc(model.failure)}</div></section>` : ''}

  ${
    model.survivors.length
      ? `<section><h2>Blind spots: breakages your tests missed (${model.survivors.length})</h2>${model.survivors.map(survivorCard).join('\n')}</section>`
      : ''
  }

  <section>
    <h2>By metadata type</h2>
    <table><thead><tr><th>Type</th><th class="num">Caught</th><th class="num">Missed</th><th class="num">Not scored</th><th class="barcell"></th><th class="num">Score</th></tr></thead>
    <tbody>${model.byType.map(bar).join('')}</tbody></table>
  </section>

  ${
    model.killed.length
      ? `<section><h2>Caught (${model.killed.length})</h2><ul class="list">${model.killed
          .map(
            (m) =>
              `<li><span class="ok">✔</span> ${rich(m.description)}<div class="why">caught by “${esc(m.killedBy?.[0]?.name ?? 'a test')}”${m.killedBy?.[0]?.message ? `: ${esc(m.killedBy[0].message)}` : ''}</div></li>`,
          )
          .join('')}</ul></section>`
      : ''
  }

  ${
    model.other.length
      ? `<section><h2>Not scored (${model.other.length})</h2><ul class="list">${model.other
          .map(
            (m) =>
              `<li><span class="warn">${esc(m.outcome ?? 'not run')}</span> ${rich(m.description)}<div class="why">${esc(m.reason ?? '')}</div></li>`,
          )
          .join('')}</ul></section>`
      : ''
  }

  ${model.flakyTests.length ? `<section><h2>Flaky tests excluded</h2><ul class="list">${model.flakyTests.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}

  <div class="foot"><span>Copado runs your tests. Mutant tests your tests.</span><span>Generated by <code>agentia mutant report</code> · works offline</span></div>
</div>
</body>
</html>
`
}
