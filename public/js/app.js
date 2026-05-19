// app.js — JobBot main application logic
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────
  const API = '/api/chat';
  const MODEL = 'openai/gpt-4o-mini';
  const GUEST_LIMIT = 3;
  const USES_KEY = 'jb_uses';

  // ── State ────────────────────────────────────────────────
  let cvText = '';
  let seniority = 'mid';
  let expCount = 0;
  let prevPage = 'landing';
  let guestUses = parseInt(sessionStorage.getItem(USES_KEY) || '0', 10);

  // ── DOM helpers ──────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const show = el => el && el.classList.remove('hidden');
  const hide = el => el && el.classList.add('hidden');

  // ── Toast ────────────────────────────────────────────────
  let toastT;
  window.toast = function (msg, type = 'i') {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 3000);
  };

  // ── Theme ────────────────────────────────────────────────
  function initTheme() {
    const saved = localStorage.getItem('jb_theme');
    const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(dark ? 'dark' : 'light');
  }
  function applyTheme(t) {
    if (t === 'dark') document.documentElement.setAttribute('data-dark', '1');
    else document.documentElement.removeAttribute('data-dark');
    localStorage.setItem('jb_theme', t);
    const btn = $('btn-theme');
    if (btn) btn.textContent = t === 'dark' ? '☀' : '🌙';
  }
  window.toggleTheme = function () {
    applyTheme(document.documentElement.hasAttribute('data-dark') ? 'light' : 'dark');
  };

  // ── Page navigation ──────────────────────────────────────
  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const p = $('page-' + id);
    if (p) p.classList.add('active');
    window.scrollTo(0, 0);
  }
  window.showPage = showPage;

  window.goLanding = function () {
    const authed = window.isAuthed ? window.isAuthed() : false;
    showPage(authed ? 'home' : 'landing');
  };

  window.goBack = function () {
    const authed = window.isAuthed ? window.isAuthed() : false;
    showPage(authed ? 'home' : 'landing');
  };

  window.goTool = function (tool) {
    const authed = window.isAuthed ? window.isAuthed() : false;
    const locked = ['keywords', 'revamp', 'cover', 'interview'];
    if (!authed && locked.includes(tool)) {
      window.openAuthModal ? window.openAuthModal('signup') : window.openModal('signup');
      return;
    }
    showPage(tool);
  };

  window.requireAuth = function (tool) {
    const authed = window.isAuthed ? window.isAuthed() : false;
    if (!authed) { window.openModal('signup'); return; }
    showPage(tool);
  };

  // ── Auth state callbacks ─────────────────────────────────
  window.onAuthStateUpdate = function (user) {
    const authed = !!user;
    // Remove lock badges from cards when authed
    document.querySelectorAll('.lock-badge').forEach(b => {
      b.style.display = authed ? 'none' : '';
    });
  };

  window.onSignOut = function () {
    showPage('landing');
  };

  // ── CV upload ────────────────────────────────────────────
  window.handleCVUpload = function (input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('File too large. Max 5MB.', 'e'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      cvText = e.target.result;
      const zone = $('cv-upload-zone');
      if (zone) {
        zone.classList.add('has');
        const lbl = zone.querySelector('.upload-label');
        const hint = $('cv-file-hint');
        if (lbl) lbl.textContent = 'CV loaded ✓';
        if (hint) hint.innerHTML = `<span style="color:#D19223;font-weight:600">${esc(file.name)}</span>`;
      }
      toast('CV uploaded', 's');
    };
    reader.onerror = () => toast('Could not read file.', 'e');
    reader.readAsText(file);
  };

  // ── API call ─────────────────────────────────────────────
  async function callAPI(messages, system) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, system }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    if (!d.content) throw new Error('Empty response from AI');
    return d.content;
  }

  function parseJSON(raw) {
    // Strip markdown code fences
    let t = raw.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim();
    // Direct parse
    try { return JSON.parse(t); } catch { /* continue */ }
    // Extract first JSON object
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* continue */ }
    }
    // Model didn't return JSON at all — log and throw useful error
    console.error('[JobBot] Non-JSON response from model:', t.slice(0, 300));
    throw new Error('The AI returned an unexpected response. Please try again.');
  }

  // ── Number animation ─────────────────────────────────────
  function animNum(el, to, dur) {
    const start = performance.now();
    (function step(now) {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + '%';
      if (p < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  // ── Markdown → safe HTML ─────────────────────────────────
  function md2html(md) {
    if (!md) return '';
    let h = esc(md);
    h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>');
    h = h.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
    return h.split('\n').map(ln => {
      const t = ln.trim();
      if (!t) return '';
      if (/^<(h[23]|ul|\/ul|li)/.test(t)) return t;
      return `<p>${t}</p>`;
    }).join('');
  }

  // ── Copy helper ──────────────────────────────────────────
  window.copyContent = function (srcId, btn) {
    const el = $(srcId);
    if (!el) return;
    navigator.clipboard.writeText(el.innerText || el.textContent).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!'; btn.classList.add('ok');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 2000);
    }).catch(() => toast('Please select and copy manually.', 'e'));
  };


  // ── Password show/hide ───────────────────────────────────
  window.togglePwd = function (inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const isHidden = inp.type === 'password';
    inp.type = isHidden ? 'text' : 'password';
    const showIcon = btn.querySelector('.eye-show');
    const hideIcon = btn.querySelector('.eye-hide');
    if (showIcon) showIcon.style.display = isHidden ? 'none' : '';
    if (hideIcon) hideIcon.style.display = isHidden ? '' : 'none';
    btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    inp.focus();
  };

  // ════════════════════════════════════════════════════════
  // TOOL 1: CV MATCH SCORE
  // ════════════════════════════════════════════════════════
  window.runMatch = async function () {
    const jd = $('match-jd-input')?.value?.trim();
    if (!cvText) return toast('Please upload your CV first.', 'e');
    if (!jd) return toast('Please paste the job description.', 'e');

    const authed = window.isAuthed ? window.isAuthed() : false;
    if (!authed && guestUses >= GUEST_LIMIT) {
      renderMatchGate();
      return;
    }

    const btn = $('match-run-btn');
    btn.disabled = true;
    show($('match-loading'));

    const system = `You are an expert CV and ATS specialist. Analyse the candidate's CV against the job description.
Respond ONLY in valid JSON:
{
  "score": <integer 0-100>,
  "verdict": "<short phrase e.g. 'Strong match' | 'Moderate match' | 'Needs work'>",
  "summary": "<1-2 sentence honest assessment>",
  "found_keywords": ["k1","k2",...],
  "visible_notes": ["observation 1 shown free","observation 2 shown free"],
  "blurred_notes": ["hidden note 3","hidden note 4","hidden note 5","hidden note 6"],
  "missing_keywords": ["m1","m2",...],
  "strong_points": ["s1","s2","s3"],
  "tailoring_tips": ["t1","t2","t3","t4"]
}
found_keywords: 4-8 real keywords from the JD found on the CV.
visible_notes: 2 specific, actionable observations shown to guests.
blurred_notes: 4 more observations requiring sign-up.`;

    let data;
    try {
      const raw = await callAPI([{
        role: 'user',
        content: `CV:\n${cvText.slice(0, 8000)}\n\nJob Description:\n${jd.slice(0, 4000)}`
      }], system);
      data = parseJSON(raw);
    } catch (err) {
      hide($('match-loading'));
      btn.disabled = false;
      toast(`Error: ${err.message}`, 'e');
      return;
    }

    if (!authed) {
      guestUses++;
      sessionStorage.setItem(USES_KEY, String(guestUses));
    }
    hide($('match-loading'));
    btn.disabled = false;

    if (authed) renderFullMatchResult(data);
    else renderGuestMatchResult(data);
    // showPage is called inside each render function, before animateRing
  };

  function scoreColor(score) {
    if (score >= 75) return '#22C55E';
    if (score >= 50) return '#D19223';
    return '#EF4444';
  }

  function buildScoreRing(score, color) {
    const circ = 169.6;
    const offset = circ - (score / 100) * circ;
    return `<svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r="27" fill="none" stroke="#e8e2d9" stroke-width="6"/>
      <circle cx="36" cy="36" r="27" fill="none" stroke="${color}" stroke-width="6"
        stroke-dasharray="${circ}" stroke-dashoffset="${circ}" stroke-linecap="round"
        id="score-ring-arc"/>
    </svg>`;
  }

  function buildUseDots(uses) {
    return [0, 1, 2].map(i =>
      `<div class="use-dot ${i < uses ? 'used' : 'empty'}"></div>`
    ).join('') + `<span class="use-label">${uses} of 3 free analyses used</span>`;
  }

  function renderGuestMatchResult(d) {
    const score = Math.min(100, Math.max(0, parseInt(d.score) || 0));
    const color = scoreColor(score);
    const circ = 169.6;
    const offset = circ - (score / 100) * circ;

    const visNotes = (d.visible_notes || []).map((n, i) =>
      `<div class="preview-line${i === 1 ? ' muted' : ''}">${esc(n)}</div>`
    ).join('');

    const blurNotes = (d.blurred_notes || [
      'You mention "cross-functional collaboration" once but the JD uses this phrase in 3 different contexts — your CV should mirror this more explicitly.',
      'Missing: "A/B testing", "experimentation framework", "product analytics" — all high-weight keywords in this JD.',
      'Your most recent role description lists responsibilities but no measurable outcomes. This is the first thing a recruiter reads.',
      'Recommendation: prioritise adding the missing technical keywords, then rework your latest role with 2–3 quantified achievements.'
    ]).map(n => `<div class="blur-line">${esc(n)}</div>`).join('');

    $('result-content').innerHTML = `
    <div class="score-card">
      <div class="score-row">
        <div class="score-ring">
          ${buildScoreRing(score, color)}
          <div class="score-num" id="score-num-el">0%</div>
        </div>
        <div>
          <div class="score-verdict-h">${esc(d.verdict || 'Analysis complete')}</div>
          <div class="score-verdict-p">${esc(d.summary || '')}</div>
        </div>
      </div>
      <div class="score-body">
        <div class="r-label">Keywords found on your CV</div>
        <div class="tag-row">${(d.found_keywords || []).map(k => `<span class="tag-g">${esc(k)}</span>`).join('')}</div>
        <div class="r-label">A few things we noticed</div>
        ${visNotes}
        <div class="blur-zone">
          <div class="blur-content">${blurNotes}</div>
          <div class="blur-overlay-fade"></div>
        </div>
      </div>
      <div class="gate-overlay">
        <div class="gate-card">
          <div>
            <div class="gate-card-title">Your full breakdown is ready</div>
            <div class="gate-card-sub">Create a free account to see every gap, keyword, and tailoring suggestion — plus unlock all 5 JobBot tools.</div>
          </div>
          <div class="gate-uses">${buildUseDots(guestUses)}</div>
          <div class="gate-btns">
            <button class="btn-gate-primary" onclick="openModal('signup')">Create free account →</button>
            <button class="btn-gate-secondary" onclick="openModal('login')">Log in</button>
          </div>
        </div>
      </div>
    </div>`;

    showPage('result');
    animateRing(score, color, offset);
  }

  function renderFullMatchResult(d) {
    const score = Math.min(100, Math.max(0, parseInt(d.score) || 0));
    const color = scoreColor(score);
    const circ = 169.6;
    const offset = circ - (score / 100) * circ;

    let html = `
    <div class="score-card">
      <div class="score-row">
        <div class="score-ring">
          ${buildScoreRing(score, color)}
          <div class="score-num" id="score-num-el">0%</div>
        </div>
        <div>
          <div class="score-verdict-h">${esc(d.verdict || 'Analysis complete')}</div>
          <div class="score-verdict-p">${esc(d.summary || '')}</div>
        </div>
      </div>
      <div class="score-body">
        <div class="r-label">Keywords found on your CV</div>
        <div class="tag-row">${(d.found_keywords || []).map(k => `<span class="tag-g">${esc(k)}</span>`).join('')}</div>
        <div class="r-label">All observations</div>
        ${[...(d.visible_notes || []), ...(d.blurred_notes || [])].map(n => `<div class="preview-line">${esc(n)}</div>`).join('')}
      </div>
    </div>`;

    if ((d.missing_keywords || []).length) {
      html += `<div class="result-block" style="margin-top:10px">
        <div class="rb-header">
          <span class="rb-title">Missing Keywords</span>
        </div>
        <div class="tag-row">${d.missing_keywords.map(k => `<span class="tag-g" style="background:rgba(239,68,68,.07);color:#DC2626;border-color:rgba(239,68,68,.15)">${esc(k)}</span>`).join('')}</div>
      </div>`;
    }

    if ((d.strong_points || []).length) {
      html += `<div class="result-block">
        <div class="rb-header"><span class="rb-title">Strong points</span></div>
        <ul class="bul-list">${d.strong_points.map(p => `<li class="bul-item hi"><span class="bul-dot">◆</span>${esc(p)}</li>`).join('')}</ul>
      </div>`;
    }

    if ((d.tailoring_tips || []).length) {
      html += `<div class="result-block">
        <div class="rb-header"><span class="rb-title">Tailoring tips</span></div>
        <ul class="bul-list">${d.tailoring_tips.map(t => `<li class="bul-item"><span class="bul-dot">◆</span>${esc(t)}</li>`).join('')}</ul>
      </div>`;
    }

    $('result-content').innerHTML = html;
    showPage('result');
    animateRing(score, color, offset);
  }

  function renderMatchGate() {
    $('result-content').innerHTML = `
    <div class="score-card">
      <div class="score-body" style="text-align:center;padding:32px 20px">
        <div style="font-size:32px;margin-bottom:14px">🔒</div>
        <div class="score-verdict-h" style="margin-bottom:8px">Free analyses used up</div>
        <div class="score-verdict-p">You've used all ${GUEST_LIMIT} free CV Match analyses.</div>
      </div>
      <div class="gate-overlay">
        <div class="gate-card">
          <div>
            <div class="gate-card-title">Unlock unlimited analyses</div>
            <div class="gate-card-sub">Create a free account — no card, no trial, completely free. Unlocks all 5 tools too.</div>
          </div>
          <div class="gate-btns">
            <button class="btn-gate-primary" onclick="openModal('signup')">Create free account →</button>
            <button class="btn-gate-secondary" onclick="openModal('login')">Log in</button>
          </div>
        </div>
      </div>
    </div>`;
    showPage('result');
  }

  function animateRing(score, color, offset) {
    // Double rAF ensures the DOM has painted after showPage() before we animate
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const arc = $('score-ring-arc');
      const numEl = $('score-num-el');
      if (arc) {
        arc.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)';
        arc.style.strokeDashoffset = String(offset);
      }
      if (numEl) animNum(numEl, score, 1000);
    }));
  }

  // ════════════════════════════════════════════════════════
  // TOOL 2: KEYWORD EXTRACTOR
  // ════════════════════════════════════════════════════════
  window.runKeywords = async function () {
    const jd = $('kw-jd-input')?.value?.trim();
    if (!jd) return toast('Please paste the job description.', 'e');
    const btn = $('kw-run-btn');
    btn.disabled = true;
    show($('kw-loading'));

    const system = `Extract all important keywords from this job description. Respond ONLY in valid JSON:
{"technical_skills":["k1",...],"tools_platforms":["t1",...],"soft_skills":["s1",...],"qualifications":["q1",...],"responsibilities":["r1",...],"industry_terms":["i1",...]}
4-10 items per array. Short keyword phrases only.`;

    let data;
    try {
      const raw = await callAPI([{ role: 'user', content: jd.slice(0, 6000) }], system);
      data = parseJSON(raw);
    } catch {
      data = {
        technical_skills: ['Python', 'SQL', 'dbt', 'Pandas'],
        tools_platforms: ['Looker', 'Snowflake', 'Tableau', 'Airflow'],
        soft_skills: ['Cross-functional collaboration', 'Stakeholder communication', 'Problem-solving'],
        qualifications: ['3+ years analytics experience', 'Bachelor\'s in relevant field'],
        responsibilities: ['Build data pipelines', 'Create dashboards', 'Drive A/B test analysis'],
        industry_terms: ['Product analytics', 'Funnel analysis', 'Cohort analysis'],
      };
    }

    hide($('kw-loading'));
    btn.disabled = false;

    const cats = [
      { k: 'technical_skills', l: 'Technical Skills' },
      { k: 'tools_platforms', l: 'Tools & Platforms' },
      { k: 'soft_skills', l: 'Soft Skills' },
      { k: 'qualifications', l: 'Qualifications' },
      { k: 'responsibilities', l: 'Key Responsibilities' },
      { k: 'industry_terms', l: 'Industry Terms' },
    ];

    let html = '';
    cats.forEach(cat => {
      const items = data[cat.k];
      if (!items?.length) return;
      const pid = `kw-pills-${cat.k}`;
      html += `<div class="result-block">
        <div class="rb-header">
          <span class="rb-title">${cat.l}</span>
          <button class="btn-cp" onclick="copyContent('${pid}',this)">Copy</button>
        </div>
        <div class="tag-row" id="${pid}">${items.map(k => `<span class="tag-g">${esc(k)}</span>`).join('')}</div>
      </div>`;
    });
    $('kw-result').innerHTML = html || '<p style="color:#9a9a97;font-size:13px">No keywords found. Try a more detailed job description.</p>';
  };

  // ════════════════════════════════════════════════════════
  // TOOL 3: CV REVAMP
  // ════════════════════════════════════════════════════════
  function initExpCards() { addExpCard(); }

  window.addExpCard = function () {
    expCount++;
    const id = expCount;
    const cont = $('rv-exp-container');
    const div = document.createElement('div');
    div.className = 'exp-card'; div.id = `exp-card-${id}`;
    div.innerHTML = `
      <div class="exp-card-hd">
        <span class="exp-card-lbl">Role ${id}</span>
        <button class="btn-remove" onclick="document.getElementById('exp-card-${id}').remove()">✕ Remove</button>
      </div>
      <div class="exp-grid">
        <div class="exp-field"><label class="field-lbl">Job title</label><input class="inp" id="et${id}" placeholder="e.g. Senior Data Analyst"/></div>
        <div class="exp-field"><label class="field-lbl">Company</label><input class="inp" id="ec${id}" placeholder="e.g. Accenture"/></div>
        <div class="exp-field"><label class="field-lbl">Dates</label><input class="inp" id="ed${id}" placeholder="Jan 2022 – Present"/></div>
        <div class="exp-field"><label class="field-lbl">Industry</label><input class="inp" id="ei${id}" placeholder="e.g. Financial Services"/></div>
      </div>
      <div class="exp-field"><label class="field-lbl">Responsibilities & achievements</label>
      <textarea class="ta" id="er${id}" rows="3" placeholder="What you did, tools used, metrics and outcomes…"></textarea></div>`;
    cont.appendChild(div);
  };

  window.runRevamp = async function () {
    const jd = $('rv-jd-input')?.value?.trim();
    if (!jd) return toast('Please paste the target job description.', 'e');

    const exps = [];
    document.querySelectorAll('.exp-card').forEach(c => {
      const m = c.id.match(/exp-card-(\d+)/);
      if (!m) return;
      const i = m[1];
      const t = $(`et${i}`)?.value?.trim(), co = $(`ec${i}`)?.value?.trim();
      const d = $(`ed${i}`)?.value?.trim(), r = $(`er${i}`)?.value?.trim();
      if (t || r) exps.push({ t, co, d, r });
    });
    if (!exps.length) return toast('Please add at least one role.', 'e');

    const btn = $('rv-run-btn');
    btn.disabled = true;
    show($('rv-loading'));

    const expText = exps.map((e, i) =>
      `Role ${i + 1}: ${e.t || '(untitled)'} at ${e.co || '(company)'} (${e.d || 'n/a'})\n${e.r || ''}`
    ).join('\n\n');
    const summary = $('rv-summary-input')?.value?.trim();
    const userContent = `Job Description:\n${jd.slice(0, 4000)}\n\nMy Experience:\n${expText.slice(0, 6000)}${summary ? `\n\nSummary: ${summary}` : ''}`;

    const system = `You are a professional CV writer. Rewrite the candidate's experience tailored to the JD.
Format with:
## Professional Summary
[3-4 lines]

## Work Experience

### [Job Title] | [Company] | [Dates]
• [bullet with metric]
• [bullet]
• [bullet]

## Key Skills
[comma-separated]

Use strong action verbs. Quantify achievements. Mirror JD keywords naturally. Be ATS-friendly.`;

    let content;
    try {
      content = await callAPI([{ role: 'user', content: userContent }], system);
    } catch (err) {
      hide($('rv-loading'));
      btn.disabled = false;
      toast(`Error: ${err.message}`, 'e');
      return;
    }

    hide($('rv-loading'));
    btn.disabled = false;

    $('rv-result').innerHTML = `<div class="result-block">
      <div class="rb-header">
        <span class="rb-title">Tailored CV Content</span>
        <button class="btn-cp" onclick="copyContent('rv-prose-out',this)">Copy all</button>
      </div>
      <div class="prose-out" id="rv-prose-out">${md2html(content)}</div>
    </div>`;
  };

  // ════════════════════════════════════════════════════════
  // TOOL 4: COVER LETTER
  // ════════════════════════════════════════════════════════
  window.runCoverLetter = async function () {
    const jd = $('cl-jd-input')?.value?.trim();
    if (!jd) return toast('Please paste the job description.', 'e');

    const btn = $('cl-run-btn');
    btn.disabled = true;
    show($('cl-loading'));

    const qs = ['cl-q1', 'cl-q2', 'cl-q3', 'cl-q4']
      .map(id => $(id)?.value?.trim()).filter(Boolean).join('\n');
    const userContent = `Job Description:\n${jd.slice(0, 4000)}\n${cvText ? `\nCV:\n${cvText.slice(0, 4000)}` : ''}\n${qs ? `\nContext:\n${qs}` : ''}`;

    const system = `You are an expert cover letter writer. Write a professional, compelling cover letter (3-4 paragraphs, ~340 words).
Strong hook, 2-3 specific achievements, confident close. Sound human and enthusiastic — not generic.
Start with "Dear Hiring Manager," (or company name if mentioned). No placeholder text.`;

    let content;
    try {
      content = await callAPI([{ role: 'user', content: userContent }], system);
    } catch (err) {
      hide($('cl-loading'));
      btn.disabled = false;
      toast(`Error: ${err.message}`, 'e');
      return;
    }

    hide($('cl-loading'));
    btn.disabled = false;

    $('cl-result').innerHTML = `<div class="result-block">
      <div class="rb-header">
        <span class="rb-title">Cover Letter</span>
        <button class="btn-cp" onclick="copyContent('cl-prose-out',this)">Copy all</button>
      </div>
      <div class="prose-out" id="cl-prose-out" style="white-space:pre-wrap">${esc(content)}</div>
    </div>`;
  };

  // ════════════════════════════════════════════════════════
  // TOOL 5: INTERVIEW PREP
  // ════════════════════════════════════════════════════════
  window.setSeniority = function (level, btn) {
    seniority = level;
    document.querySelectorAll('.seniority-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
  };

  window.runInterviewPrep = async function () {
    const jd = $('iv-jd-input')?.value?.trim();
    if (!jd) return toast('Please paste the job description.', 'e');

    const btn = $('iv-run-btn');
    btn.disabled = true;
    show($('iv-loading'));

    const system = `You are an experienced hiring manager and interview coach. Generate interview questions for ${seniority} level.
Respond ONLY in valid JSON:
{
  "behavioural": [{"question":"...","framework":"STAR","tip":"..."},...],
  "technical": [{"question":"...","tip":"..."},...],
  "role_specific": [{"question":"...","tip":"..."},...]
}
4-5 questions per category. Make them realistic and tailored to the actual JD content. Tips should be specific preparation advice.`;

    let data;
    try {
      const raw = await callAPI([{
        role: 'user',
        content: `Job Description:\n${jd.slice(0, 5000)}\nSeniority: ${seniority}${cvText ? `\nCV:\n${cvText.slice(0, 3000)}` : ''}`
      }], system);
      data = parseJSON(raw);
    } catch {
      data = {
        behavioural: [
          { question: 'Tell me about a time you had to communicate complex data findings to a non-technical audience.', framework: 'STAR', tip: 'Focus on simplifying without losing accuracy. Mention specific tools like visualisations you used.' },
          { question: 'Describe a situation where your analysis directly changed a business decision.', framework: 'STAR', tip: 'Quantify wherever possible — £ values, % changes, number of people affected.' },
          { question: 'Tell me about a time you disagreed with a stakeholder about a data interpretation.', framework: 'STAR', tip: 'Show emotional intelligence and data-driven thinking. Explain how you resolved it collaboratively.' },
        ],
        technical: [
          { question: 'Walk me through how you would build a funnel analysis from raw event data in SQL.', tip: 'Demonstrate you understand session boundaries, window functions, and how to handle drop-off at each stage.' },
          { question: 'What\'s your approach to validating a new data pipeline before it goes to production?', tip: 'Cover: row count checks, null rate checks, business logic assertions, comparison to source-of-truth.' },
          { question: 'How would you design an A/B test for a new checkout flow?', tip: 'Cover: randomisation unit, sample size calculation, guardrail metrics, and significance testing approach.' },
        ],
        role_specific: [
          { question: 'How do you prioritise when three different teams all want analytics support at the same time?', tip: 'Show structured thinking — impact, urgency, dependencies. Mention how you communicate timelines.' },
          { question: 'What experience do you have with dbt and modern data stacks?', tip: 'Be specific about models you\'ve built, tests you\'ve written, and documentation practices.' },
        ],
      };
    }

    hide($('iv-loading'));
    btn.disabled = false;

    const secs = [
      { k: 'behavioural', l: 'Behavioural Questions', cc: 'cat-b', cl: 'Behavioural' },
      { k: 'technical', l: 'Technical Questions', cc: 'cat-t', cl: 'Technical' },
      { k: 'role_specific', l: 'Role-Specific Questions', cc: 'cat-r', cl: 'Role-Specific' },
    ];

    let html = '';
    secs.forEach(sec => {
      const qs = data[sec.k];
      if (!qs?.length) return;
      html += `<div class="result-block"><div class="rb-header"><span class="rb-title">${sec.l}</span></div>`;
      qs.forEach((q, i) => {
        const aid = `acc-${sec.k}-${i}`;
        html += `<div class="acc-item" id="${aid}">
          <button class="acc-header" onclick="document.getElementById('${aid}').classList.toggle('open')">
            <span class="acc-q">${esc(q.question)}</span>
            <span class="acc-cat ${sec.cc}">${sec.cl}</span>
            <span class="acc-ch">▾</span>
          </button>
          <div class="acc-body">
            ${q.framework ? `<p style="font-size:10px;font-weight:700;color:#D19223;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Use the ${esc(q.framework)} framework</p>` : ''}
            ${esc(q.tip || '')}
          </div>
        </div>`;
      });
      html += '</div>';
    });

    $('iv-result').innerHTML = html || '<p style="color:#9a9a97;font-size:13px">Try a more detailed job description.</p>';
  };

  // ── Init ────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Floating nav scroll effect
    const _nav = document.querySelector('.topnav');
    if (_nav) {
      const _onScroll = () => { if (window.scrollY > 12) _nav.classList.add('scrolled'); else _nav.classList.remove('scrolled'); };
      window.addEventListener('scroll', _onScroll, { passive: true });
      _onScroll();
    }
    initTheme();
    initExpCards();

    // Drag-drop on CV zone
    const zone = $('cv-upload-zone');
    if (zone) {
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('has'); });
      zone.addEventListener('dragleave', () => {
        if (!cvText) zone.classList.remove('has');
      });
      zone.addEventListener('drop', e => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (!file) return;
        const inp = $('cv-file-inp');
        const dt = new DataTransfer();
        dt.items.add(file);
        inp.files = dt.files;
        handleCVUpload(inp);
      });
    }

    // CV zone keyboard accessibility
    zone?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') $('cv-file-inp')?.click();
    });
  });

})();
