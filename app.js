/* Liikennemerkit — Finnish road-sign trainer.
   Vanilla JS, no build step, no network. Data comes from window.SIGNS (data/signs.js).
   All progress lives in localStorage so it works fully offline from file://. */
(() => {
  "use strict";

  // Images are stored repo-root-relative; this file lives at the repo root.
  const IMG_BASE = "";
  const ALL = (window.SIGNS || []).slice();
  // Every sign is named, so all are usable as flashcards / quiz answers.
  const POOL = ALL;
  const BY_ID = Object.fromEntries(ALL.map((s) => [s.id, s]));

  // Categories present in the named pool, in canonical A→I order.
  const CATS = [];
  for (const s of POOL) {
    if (!CATS.find((c) => c.key === s.category)) {
      CATS.push({
        key: s.category,
        fi: s.category_fi,
        en: s.category_en,
        signs: [],
      });
    }
  }
  CATS.sort((a, b) => a.key.localeCompare(b.key));
  for (const c of CATS) c.signs = POOL.filter((s) => s.category === c.key);

  // ---------- storage ----------
  const LS = {
    get(k, def) {
      try {
        return JSON.parse(localStorage.getItem(k)) ?? def;
      } catch {
        return def;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };
  const settings = Object.assign(
    { answerLang: "both" },
    LS.get("lm_settings", {}),
  );
  const progress = LS.get("lm_progress", {}); // id -> {box,correct,wrong,seen,lastSeen}
  let history = LS.get("lm_history", []); // [{ts,id,correct}]
  const records = LS.get("lm_records", { timeAttack: 0 });

  const saveSettings = () => LS.set("lm_settings", settings);
  const saveProgress = () => LS.set("lm_progress", progress);
  const saveRecords = () => LS.set("lm_records", records);
  // Wipe every bit of learning progress (boxes, history, records, exam log)
  // while keeping the user's settings such as answer language.
  function resetProgress() {
    for (const k of Object.keys(progress)) delete progress[k];
    history = [];
    records.timeAttack = 0;
    LS.set("lm_progress", progress);
    LS.set("lm_history", history);
    LS.set("lm_records", records);
    LS.set("lm_exams", []);
    LS.set("lm_weak_dismissed", {});
  }
  const HISTORY_LIMIT = 800; // most recent attempts kept in localStorage
  function logAttempt(id, correct) {
    history.push({ ts: Date.now(), id, correct });
    if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
    LS.set("lm_history", history);
    const p = (progress[id] = progress[id] || {
      box: 1,
      correct: 0,
      wrong: 0,
      seen: 0,
    });
    p.seen++;
    p.lastSeen = Date.now();
    if (correct) {
      p.correct++;
      p.box = Math.min(5, p.box + 1);
    } else {
      p.wrong++;
      p.box = 1;
    }
    saveProgress();
  }

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $("#view");
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const shuffle = (a) => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const sample = (a, n) => shuffle(a).slice(0, n);
  const imgUrl = (s) => IMG_BASE + s.image;
  const signImg = (s, cls = "") =>
    `<img src="${esc(imgUrl(s))}" alt="${esc(s.id)}" class="${cls}" loading="lazy" />`;
  // One sign tile shared by Browse and the progress lists.
  const signCard = (s, subtext) =>
    `<div class="menu-card sign-card">
       <div class="signframe sm">${signImg(s)}</div>
       <div class="title">${label(s)}</div>
       <div class="desc">${subtext}</div>
     </div>`;

  // Display label for an answer option / answer reveal, honouring language setting.
  function label(s, lang = settings.answerLang) {
    if (lang === "fi") return esc(s.name_fi);
    if (lang === "en") return esc(s.name_en);
    return `${esc(s.name_fi)}<span class="opt-en">${esc(s.name_en)}</span>`;
  }
  // Plain (no-markup) label used to detect duplicate options.
  const plainLabel = (s) =>
    settings.answerLang === "en" ? s.name_en : s.name_fi;
  // Category heading label ({fi,en}), honouring language setting.
  function catLabel(c, lang = settings.answerLang) {
    if (lang === "fi") return esc(c.fi);
    if (lang === "en") return esc(c.en);
    return `${esc(c.fi)} <span class="cat-sub">(${esc(c.en)})</span>`;
  }
  // Description honouring language setting (both → fi with en in a muted block).
  function desc(s, lang = settings.answerLang) {
    if (lang === "fi") return esc(s.description_fi);
    if (lang === "en") return esc(s.description_en);
    return `${esc(s.description_fi)}<span class="opt-en">${esc(s.description_en)}</span>`;
  }
  // Big flashcard name block; fi stays the headline in `both` mode.
  function nameBlock(s, lang = settings.answerLang) {
    if (lang === "fi") return `<div class="name-fi">${esc(s.name_fi)}</div>`;
    if (lang === "en") return `<div class="name-fi">${esc(s.name_en)}</div>`;
    return `<div class="name-fi">${esc(s.name_fi)}</div><div class="name-en">${esc(s.name_en)}</div>`;
  }
  // One-line primary name for review rows / confusion tiles (fi for `both`).
  const primaryName = (s) =>
    esc(settings.answerLang === "en" ? s.name_en : s.name_fi);
  // English translation prefix shown in subtitles only in `both` mode.
  const subEn = (s) =>
    settings.answerLang === "both" ? `${esc(s.name_en)} · ` : "";
  // Plain (unescaped) category name honouring language; escaped at render time.
  const catName = (fi, en, lang = settings.answerLang) =>
    lang === "en" ? en : lang === "fi" ? fi : `${fi} · ${en}`;

  // ---------- weighted SRS pick ----------
  // Forgotten / low-box / unseen signs are far more likely to appear.
  function weight(s) {
    const p = progress[s.id];
    if (!p) return 6; // never seen → show often
    return [0, 8, 5, 3, 2, 1][p.box] || 1;
  }
  function weightedPick(pool, exclude) {
    const cand = exclude ? pool.filter((s) => s.id !== exclude) : pool;
    let total = 0;
    for (const s of cand) total += weight(s);
    let r = Math.random() * total;
    for (const s of cand) {
      r -= weight(s);
      if (r <= 0) return s;
    }
    return cand[cand.length - 1];
  }

  // ---------- distractors for multiple choice ----------
  function buildOptions(correct, poolForDistractors) {
    const pool =
      poolForDistractors && poolForDistractors.length >= 4
        ? poolForDistractors
        : POOL;
    // Prefer "similar" signs as distractors — that is what trips people up.
    const sims = (correct.similar_signs || [])
      .map((id) => BY_ID[id])
      .filter(Boolean);
    const opts = [correct];
    const used = new Set([correct.id, plainLabel(correct)]);
    const add = (s) => {
      if (s && !used.has(s.id) && !used.has(plainLabel(s))) {
        opts.push(s);
        used.add(s.id);
        used.add(plainLabel(s));
      }
    };
    shuffle(sims).forEach((s) => {
      if (opts.length < 4) add(s);
    });
    const samePool = shuffle(
      pool.filter((s) => s.category === correct.category),
    );
    samePool.forEach((s) => {
      if (opts.length < 4) add(s);
    });
    shuffle(POOL).forEach((s) => {
      if (opts.length < 4) add(s);
    });
    return shuffle(opts);
  }

  // ---------- router ----------
  const Views = {};
  let currentView = "home";
  function nav(name) {
    currentView = name;
    view.innerHTML = "";
    (Views[name] || Views.home)();
    window.scrollTo(0, 0);
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-nav]");
    if (t) nav(t.getAttribute("data-nav"));
  });
  // Static, language-aware views that should re-render live when the answer language setting changes.
  const LANG_AWARE_VIEWS = [
    "home",
    "categories",
    "stats",
    "browse",
    "practised",
    "wellknown",
    "weakspots",
  ];
  $("#answerLang").value = settings.answerLang;
  $("#answerLang").addEventListener("change", (e) => {
    settings.answerLang = e.target.value;
    saveSettings();
    if (LANG_AWARE_VIEWS.includes(currentView)) nav(currentView);
  });

  // ======================================================================
  //  HOME
  // ======================================================================
  Views.home = () => {
    const learned = Object.values(progress).filter((p) => p.box >= 4).length;
    const seen = Object.keys(progress).length;
    const weakCount = weakStats().weak.length;
    view.innerHTML = `
      <h1>Finnish road-sign trainer</h1>
      <p class="sub">${POOL.length} signs · ${CATS.length} categories · learn them, then beat the exam.</p>
      <div class="stat-strip">
        <button class="stat-chip${seen ? " tappable" : ""}" data-nav="practised"${seen ? "" : " disabled"}><b>${seen}</b><span>signs practised</span></button>
        <button class="stat-chip${learned ? " tappable" : ""}" data-nav="wellknown"${learned ? "" : " disabled"}><b>${learned}</b><span>well known</span></button>
        <button class="stat-chip${weakCount ? " tappable" : ""}" data-nav="weakspots"${weakCount ? "" : " disabled"}><b>${weakCount}</b><span>weak spots</span></button>
        <div class="stat-chip"><b>${records.timeAttack}</b><span>best time-attack</span></div>
      </div>
      <div class="menu-grid">
        ${menuCard("study", "🃏", "Study (flashcards)", "See a sign, recall its meaning, rate yourself. Forgotten signs come back more often.")}
        ${menuCard("categories", "📚", "Category training", "Pick one group (e.g. priority signs) and choose 10, 20, 30 or max questions.")}
        ${menuCard("examStart", "🎓", "Exam simulator", "20–30 questions, 30 s each, just like the theory test. Pass with few mistakes.")}
        ${menuCard("timeStart", "⚡", "Time attack", "60 seconds. How many can you name in a row? One miss resets the streak.")}
        ${menuCard("stats", "📈", "My weak spots", "The signs you confuse most over the past week.")}
        ${menuCard("browse", "🔎", "Browse all signs", "Flip through every sign by category, including road markings.")}
      </div>
      <div class="row actions">
        <button class="btn ghost" id="resetProgress">↺ Reset progress</button>
      </div>`;
    $("#resetProgress").onclick = () => {
      if (
        confirm(
          "Reset all progress? This clears your memory boxes, practice history, weak spots and best time-attack streak. Settings are kept. This cannot be undone.",
        )
      ) {
        resetProgress();
        nav("home");
      }
    };
  };
  const menuCard = (navName, ico, title, desc) =>
    `<button class="menu-card" data-nav="${navName}">
       <span class="ico">${ico}</span>
       <span class="title">${title}</span>
       <span class="desc">${desc}</span>
     </button>`;

  const backBar = (label = "← Home") =>
    `<button class="linkback" data-nav="home">${label}</button>`;

  // ======================================================================
  //  STUDY (flashcards + self-grading SRS)
  // ======================================================================
  Views.study = () => {
    let current = null,
      revealed = false;
    function draw() {
      current = weightedPick(POOL, current && current.id);
      revealed = false;
      render();
    }
    function render() {
      const p = progress[current.id];
      const box = p ? p.box : 0;
      view.innerHTML = `
        ${backBar()}
        <div class="panel">
          <div class="toolbar">
            <span class="pill">${esc(catName(current.category_fi, current.category_en))}</span>
            <span class="spacer"></span>
            <span class="pill" title="Leitner box: higher = better known">memory ${box}/5</span>
          </div>
          <div class="signframe">${signImg(current)}</div>
          <div class="answer ${revealed ? "" : "hidden"}">
            ${nameBlock(current)}
            <div class="desc">${desc(current)}</div>
            <div class="code">${esc(current.id)}</div>
          </div>
          ${similarBlock(current)}
          <div id="studyControls" style="margin-top:18px"></div>
        </div>`;
      const ctrl = $("#studyControls");
      if (!revealed) {
        ctrl.innerHTML = `<button class="btn wide lg" id="showBtn">Show answer</button>`;
        $("#showBtn").onclick = () => {
          revealed = true;
          render();
        };
      } else {
        ctrl.innerHTML = `
          <div class="grade-row">
            <button class="grade forgot" data-g="0">Forgot<small>show me again soon</small></button>
            <button class="grade soft" data-g="1">Not sure<small></small></button>
            <button class="grade know" data-g="2">I knew it<small></small></button>
          </div>`;
        ctrl.querySelectorAll(".grade").forEach((b) => {
          b.onclick = () => {
            const g = +b.dataset.g;
            logAttempt(current.id, g === 2);
            if (g === 1 && progress[current.id]) {
              progress[current.id].box = 2;
              saveProgress();
            }
            draw();
          };
        });
      }
    }
    draw();
  };

  // Small "similar signs" reminder shown on a flashcard.
  function similarBlock(s) {
    const sims = (s.similar_signs || []).map((id) => BY_ID[id]).filter(Boolean);
    if (!sims.length) return "";
    return `<div class="confusion">
      <h3>⚠️ Easy to confuse with</h3>
      <div class="confusion-grid">
        ${sims.map((x) => `<div class="confusion-item">${signImg(x)}<div class="t">${primaryName(x)}</div><div class="c">${subEn(x)}${esc(x.id)}</div></div>`).join("")}
      </div></div>`;
  }

  // ======================================================================
  //  CATEGORY PICKER
  // ======================================================================
  const QUIZ_COUNTS = [10, 20, 30, "max"];
  Views.categories = () => {
    const selected = QUIZ_COUNTS.includes(settings.quizCount)
      ? settings.quizCount
      : 10;
    view.innerHTML = `
      ${backBar()}
      <h1>Category training</h1>
      <p class="sub">Pick a group for a focused quiz.</p>
      <label class="quiz-count">
        <span>Questions</span>
        <select id="quizCount">
          ${QUIZ_COUNTS.map(
            (n) =>
              `<option value="${n}"${n === selected ? " selected" : ""}>${n === "max" ? "Max" : n}</option>`,
          ).join("")}
        </select>
      </label>
      <div class="cat-list">
        ${CATS.map(
          (c) => `
          <button class="cat" data-cat="${c.key}">
            <span class="cat-letter">${c.key}</span>
            <span>
              <span class="cat-name">${settings.answerLang === "en" ? esc(c.en) : esc(c.fi)}</span><br>
              <span class="cat-sub">${settings.answerLang === "both" ? esc(c.en) + " · " : ""}${c.signs.length} signs</span>
            </span>
          </button>`,
        ).join("")}
      </div>`;
    $("#quizCount").addEventListener("change", (e) => {
      const v = e.target.value;
      settings.quizCount = v === "max" ? "max" : +v;
      saveSettings();
    });
    view.querySelectorAll(".cat").forEach((b) => {
      b.onclick = () => startQuiz(b.dataset.cat);
    });
  };

  // ======================================================================
  //  QUIZ ENGINE (shared by category training)
  // ======================================================================
  function startQuiz(catKey) {
    const cat = CATS.find((c) => c.key === catKey);
    const want = QUIZ_COUNTS.includes(settings.quizCount)
      ? settings.quizCount
      : 10;
    const n = want === "max" ? cat.signs.length : Math.min(want, cat.signs.length);
    const qs = sample(cat.signs, n);
    runQuiz({
      title: catName(cat.fi, cat.en),
      questions: qs,
      distractorPool: cat.signs,
      onDone: (res) => quizResult(res, () => startQuiz(catKey)),
    });
  }

  // Generic question runner: image → 4 options, reveal + anti-confusion on wrong.
  function runQuiz(cfg) {
    let i = 0,
      correctCount = 0;
    const wrongs = [];
    function step() {
      const q = cfg.questions[i];
      const opts = buildOptions(q, cfg.distractorPool);
      view.innerHTML = `
        ${backBar()}
        <div class="panel">
          <div class="toolbar">
            <span class="pill">${esc(cfg.title)}</span>
            <span class="spacer"></span>
            <span>${i + 1} / ${cfg.questions.length}</span>
            <div class="progress"><i style="width:${(i / cfg.questions.length) * 100}%"></i></div>
          </div>
          <div class="signframe">${signImg(q)}</div>
          <h2 style="text-align:center;margin-top:14px">What is this sign?</h2>
          <div class="options" id="opts">
            ${opts.map((o) => `<button class="option" data-id="${o.id}">${label(o)}</button>`).join("")}
          </div>
          <div id="after"></div>
        </div>`;
      $("#opts")
        .querySelectorAll(".option")
        .forEach((b) => {
          b.onclick = () => choose(b, q, opts);
        });
    }
    function choose(btn, q, opts) {
      const chosenId = btn.dataset.id;
      const ok = chosenId === q.id;
      logAttempt(q.id, ok);
      if (ok) correctCount++;
      else wrongs.push({ q, chosenId });
      $("#opts")
        .querySelectorAll(".option")
        .forEach((b) => {
          b.disabled = true;
          if (b.dataset.id === q.id) b.classList.add("correct");
          else if (b.dataset.id === chosenId) b.classList.add("wrong");
        });
      const after = $("#after");
      after.innerHTML =
        `<div class="feedback ${ok ? "ok" : "no"}">${ok ? "✓ Correct!" : "✗ Not quite"}</div>` +
        (ok ? "" : confusionBox(q, BY_ID[chosenId])) +
        `<button class="btn wide lg" id="next" style="margin-top:14px">${i + 1 < cfg.questions.length ? "Next" : "See results"}</button>`;
      $("#next").onclick = () => {
        i++;
        i < cfg.questions.length
          ? step()
          : cfg.onDone({
              total: cfg.questions.length,
              correct: correctCount,
              wrongs,
            });
      };
    }
    step();
  }

  // Side-by-side "don't confuse these" panel.
  function confusionBox(correct, chosen) {
    const items = [correct];
    if (chosen && chosen.id !== correct.id) items.push(chosen);
    (correct.similar_signs || []).forEach((id) => {
      const s = BY_ID[id];
      if (s && !items.find((x) => x.id === s.id) && items.length < 4)
        items.push(s);
    });
    const tip =
      chosen && chosen.id !== correct.id
        ? `Don't mix up <b>${primaryName(correct)}</b> with <b>${primaryName(chosen)}</b>. Look closely at shape &amp; colour.`
        : `Take a good look — this one is easy to confuse with its look-alikes.`;
    return `<div class="confusion">
      <h3>⚠️ Don't confuse these</h3>
      <div class="c">${tip}</div>
      <div class="confusion-grid">
        ${items.map((s) => `<div class="confusion-item">${signImg(s)}<div class="t">${primaryName(s)}</div><div class="c">${subEn(s)}${esc(s.id)}</div></div>`).join("")}
      </div></div>`;
  }

  function quizResult(res, retry) {
    const pct = Math.round((res.correct / res.total) * 100);
    view.innerHTML = `
      ${backBar()}
      <div class="panel center">
        <div class="result-big ${pct >= 80 ? "result-pass" : "result-fail"}">${pct}%</div>
        <p class="sub">${res.correct} / ${res.total} correct</p>
        ${
          res.wrongs.length
            ? `<h2 style="margin-top:18px">Review your misses</h2>
          <div style="text-align:left">${res.wrongs
            .map(
              (w) =>
                `<div class="weak-row">${signImg(w.q)}<div><b>${primaryName(w.q)}</b><br><span class="cat-sub">${subEn(w.q)}${esc(w.q.id)}</span></div></div>`,
            )
            .join("")}</div>`
            : `<p class="feedback ok">Perfect round! 🎉</p>`
        }
        <div class="row actions">
          <button class="btn" id="again">Try again</button>
          <button class="btn ghost" data-nav="home">Home</button>
        </div>
      </div>`;
    $("#again").onclick = retry;
  }

  // ======================================================================
  //  EXAM SIMULATOR
  // ======================================================================
  Views.examStart = () => {
    view.innerHTML = `
      ${backBar()}
      <h1>🎓 Exam simulator</h1>
      <p class="sub">As close as we can get to the theory test: random signs, a strict 30-second timer per question, and a pass threshold.</p>
      <div class="panel">
        <div class="row">
          <label>Questions
            <select id="qcount"><option>20</option><option selected>25</option><option>30</option></select>
          </label>
          <label style="margin-left:18px">Time per question
            <select id="qtime"><option value="30" selected>30 s</option><option value="20">20 s</option><option value="45">45 s</option></select>
          </label>
          <label style="margin-left:18px">Max mistakes to pass
            <select id="qmax"><option>2</option><option selected>3</option><option>5</option></select>
          </label>
          <label style="margin-left:18px">Feedback
            <select id="qfeedback">
              <option value="each" selected>After each question</option>
              <option value="end">All at the end</option>
            </select>
          </label>
        </div>
        <button class="btn wide lg" id="startExam" style="margin-top:18px">Start exam</button>
      </div>`;
    $("#startExam").onclick = () =>
      runExam(
        +$("#qcount").value,
        +$("#qtime").value,
        +$("#qmax").value,
        $("#qfeedback").value,
      );
  };

  function runExam(count, perQ, maxWrong, feedbackMode) {
    const immediate = feedbackMode !== "end";
    const qs = sample(POOL, Math.min(count, POOL.length));
    let i = 0,
      correctCount = 0,
      timer = null;
    const wrongs = [];
    const answers = [];
    function step() {
      const q = qs[i];
      const opts = buildOptions(q);
      view.innerHTML = `
        <div class="panel">
          <div class="toolbar">
            <span class="pill">Exam</span>
            <span>Question ${i + 1} / ${qs.length}</span>
            <span class="spacer"></span>
            <span class="timer" id="tnum">${perQ}s</span>
          </div>
          <div class="timerbar"><i id="tbar"></i></div>
          <div class="signframe" style="margin-top:14px">${signImg(q)}</div>
          <h2 style="text-align:center;margin-top:14px">Choose the correct meaning</h2>
          <div class="options" id="opts">
            ${opts.map((o) => `<button class="option" data-id="${o.id}">${label(o)}</button>`).join("")}
          </div>
          <div id="after"></div>
        </div>`;
      $("#opts")
        .querySelectorAll(".option")
        .forEach((b) => {
          b.onclick = () => answer(b.dataset.id, q);
        });
      // timer
      let left = perQ;
      const bar = $("#tbar"),
        num = $("#tnum");
      const tick = () => {
        const f = left / perQ;
        bar.style.width = f * 100 + "%";
        bar.style.background =
          f < 0.25 ? "var(--red)" : f < 0.5 ? "var(--amber)" : "var(--green)";
        num.textContent = left + "s";
        if (left <= 0) {
          clearInterval(timer);
          answer(null, q);
          return;
        }
        left--;
      };
      tick();
      timer = setInterval(tick, 1000);
    }
    function answer(chosenId, q) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const opts = $("#opts");
      if (!opts || opts.dataset.done) return;
      opts.dataset.done = "1";
      const ok = chosenId === q.id;
      logAttempt(q.id, ok);
      if (ok) correctCount++;
      else wrongs.push({ q, chosenId });
      answers.push({ q, chosenId, ok });
      opts.querySelectorAll(".option").forEach((b) => {
        b.disabled = true;
        if (immediate) {
          if (b.dataset.id === q.id) b.classList.add("correct");
          else if (chosenId && b.dataset.id === chosenId)
            b.classList.add("wrong");
        } else if (chosenId && b.dataset.id === chosenId) {
          b.classList.add("chosen");
        }
      });
      const after = $("#after");
      const nextLabel =
        i + 1 < qs.length ? "Next question" : "Finish exam";
      after.innerHTML = immediate
        ? `<div class="feedback ${ok ? "ok" : "no"}">${ok ? "✓ Correct" : chosenId ? "✗ Wrong" : "⏱ Time up"}</div>` +
          (ok ? "" : confusionBox(q, BY_ID[chosenId])) +
          `<button class="btn wide lg" id="next" style="margin-top:14px">${nextLabel}</button>`
        : `<div class="feedback">${chosenId ? "Answer recorded" : "⏱ Time up"}</div>` +
          `<button class="btn wide lg" id="next" style="margin-top:14px">${nextLabel}</button>`;
      $("#next").onclick = () => {
        i++;
        i < qs.length ? step() : finish();
      };
    }
    function finish() {
      const wrong = wrongs.length;
      const passed = wrong <= maxWrong;
      LS.set(
        "lm_exams",
        LS.get("lm_exams", [])
          .concat([{ ts: Date.now(), total: qs.length, wrong, passed }])
          .slice(-50),
      );
      view.innerHTML = `
        ${backBar()}
        <div class="panel center">
          <div class="result-big ${passed ? "result-pass" : "result-fail"}">${passed ? "PASSED" : "FAILED"}</div>
          <div class="scorebar" style="justify-content:center">
            <div class="stat-chip"><b>${correctCount}</b><span>correct</span></div>
            <div class="stat-chip"><b>${wrong}</b><span>mistakes</span></div>
            <div class="stat-chip"><b>${maxWrong}</b><span>mistakes allowed to pass</span></div>
          </div>
          ${
            !immediate
              ? `<h2 style="margin-top:10px">Answers</h2><div style="text-align:left">${answers
                  .map((a) => {
                    const chosen = a.chosenId ? BY_ID[a.chosenId] : null;
                    return `<div class="weak-row${a.ok ? " ans-ok" : " ans-no"}">${signImg(a.q)}<div><b>${primaryName(a.q)}</b>${settings.answerLang === "both" ? `<br><span class="cat-sub">${esc(a.q.name_en)}</span>` : ""}<br><span class="${a.ok ? "feedback ok" : "feedback no"}">${a.ok ? "✓ Correct" : `✗ You: ${chosen ? primaryName(chosen) : "— (time up)"}`}</span></div></div>`;
                  })
                  .join("")}</div>`
              : wrong
                ? `<h2 style="margin-top:10px">Signs to review</h2><div style="text-align:left">${wrongs
                    .map(
                      (w) =>
                        `<div class="weak-row">${signImg(w.q)}<div><b>${primaryName(w.q)}</b><br><span class="cat-sub">${subEn(w.q)}${esc(w.q.id)}</span></div></div>`,
                    )
                    .join("")}</div>`
                : `<p class="feedback ok">Flawless! 🎉</p>`
          }
          <div class="row actions">
            <button class="btn" data-nav="examStart">New exam</button>
            <button class="btn ghost" data-nav="home">Home</button>
          </div>
        </div>`;
    }
    step();
  }

  // ======================================================================
  //  TIME ATTACK
  // ======================================================================
  Views.timeStart = () => {
    view.innerHTML = `
      ${backBar()}
      <h1>⚡ Time attack</h1>
      <p class="sub">60 seconds on the clock. Name as many signs in a row as you can — one mistake resets your streak. Your best run is saved.</p>
      <div class="panel center">
        <p>Personal best streak: <b style="color:var(--blue)">${records.timeAttack}</b></p>
        <button class="btn wide lg" id="go">Start 60-second run</button>
      </div>`;
    $("#go").onclick = runTimeAttack;
  };

  const TIME_ATTACK_SECONDS = 60;
  function runTimeAttack() {
    let left = TIME_ATTACK_SECONDS,
      streak = 0,
      best = 0,
      total = 0,
      timer = null,
      current = null;
    function draw() {
      current = weightedPick(POOL, current && current.id);
      const opts = buildOptions(current);
      view.innerHTML = `
        <div class="panel">
          <div class="toolbar">
            <span class="pill">Time attack</span>
            <span class="spacer"></span>
            <span>streak <b style="color:var(--blue)" id="sk">${streak}</b></span>
            <span class="timer" id="clk">${left}s</span>
          </div>
          <div class="timerbar"><i id="tbar" style="width:100%"></i></div>
          <div class="signframe" style="margin-top:14px">${signImg(current)}</div>
          <div class="options" id="opts">
            ${opts.map((o) => `<button class="option" data-id="${o.id}">${label(o)}</button>`).join("")}
          </div>
        </div>`;
      $("#opts")
        .querySelectorAll(".option")
        .forEach((b) => {
          b.onclick = () => pick(b.dataset.id);
        });
    }
    function pick(id) {
      total++;
      const ok = id === current.id;
      logAttempt(current.id, ok);
      if (ok) {
        streak++;
        best = Math.max(best, streak);
        draw();
      } else {
        streak = 0;
        // brief flash of the correct answer before continuing
        const opts = $("#opts");
        opts.querySelectorAll(".option").forEach((b) => {
          b.disabled = true;
          if (b.dataset.id === current.id) b.classList.add("correct");
          else if (b.dataset.id === id) b.classList.add("wrong");
        });
        setTimeout(() => {
          if (left > 0) draw();
        }, 650);
      }
    }
    function tickClock() {
      const c = $("#clk"),
        bar = $("#tbar");
      if (c) c.textContent = left + "s";
      if (bar) {
        bar.style.width = (left / TIME_ATTACK_SECONDS) * 100 + "%";
        bar.style.background = left < 15 ? "var(--red)" : "var(--green)";
      }
      if (left <= 0) {
        clearInterval(timer);
        end();
        return;
      }
      left--;
    }
    function end() {
      if (best > records.timeAttack) {
        records.timeAttack = best;
        saveRecords();
      }
      view.innerHTML = `
        ${backBar()}
        <div class="panel center">
          <p class="sub">Time! Your best streak this run:</p>
          <div class="streak-num">${best}</div>
          <p class="sub">${total} answered · personal best ${records.timeAttack}</p>
          <div class="row actions">
            <button class="btn" data-nav="timeStart">Play again</button>
            <button class="btn ghost" data-nav="home">Home</button>
          </div>
        </div>`;
    }
    draw();
    tickClock();
    timer = setInterval(tickClock, 1000);
  }

  // ======================================================================
  //  STATS / WEAK SPOTS
  // ======================================================================
  // Number of correct answers in a row a sign needs since its last miss to be
  // considered "redeemed" and drop off the weak-spots list automatically.
  const REDEEM_STREAK = 3;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000; // window for the activity summary
  // Shared weak-spots computation used by both the home chip and the Stats view,
  // so the headline count always matches the list. The weak list is ALL-TIME —
  // a sign stays weak until redeemed (REDEEM_STREAK correct in a row since its
  // last miss) or dismissed; it never expires by time. The answer tallies
  // returned alongside are a separate last-7-days activity snapshot.
  function weakStats() {
    // Per sign: tallies, current correct-streak since last miss, and last-miss ts.
    const agg = {};
    for (const h of history) {
      const a = (agg[h.id] = agg[h.id] || {
        wrong: 0,
        total: 0,
        streak: 0,
        lastWrong: 0,
      });
      a.total++;
      if (h.correct) {
        a.streak++;
      } else {
        a.wrong++;
        a.streak = 0; // a miss breaks the redeem streak
        a.lastWrong = h.ts;
      }
    }
    // Manually dismissed signs; a dismissal lapses if the sign is missed again.
    const dismissed = LS.get("lm_weak_dismissed", {});
    const isDismissed = (id) =>
      dismissed[id] != null && (agg[id]?.lastWrong || 0) <= dismissed[id];
    const weak = Object.entries(agg)
      .filter(([id, a]) => a.wrong > 0) // missed at least once this week
      .filter(([id, a]) => a.streak < REDEEM_STREAK) // not yet redeemed
      .filter(([id]) => !isDismissed(id)) // not manually dismissed
      .map(([id, a]) => ({ s: BY_ID[id], ...a, rate: a.wrong / a.total }))
      .filter((x) => x.s)
      .sort((a, b) => b.wrong - a.wrong || b.rate - a.rate);
    // Activity summary: last 7 days only (kept windowed on purpose).
    const weekAgo = Date.now() - WEEK_MS;
    const recent = history.filter((h) => h.ts >= weekAgo);
    return {
      weak,
      totalA: recent.length,
      totalW: recent.filter((h) => !h.correct).length,
      touched: new Set(recent.map((h) => h.id)).size,
    };
  }
  Views.stats = () => {
    const { weak: weakAll, totalA, totalW, touched } = weakStats();
    const weak = weakAll.slice(0, 5);
    view.innerHTML = `
      ${backBar()}
      <h1>📈 My weak spots</h1>
      <p class="sub">Every sign you've ever missed stays here until you get it
      right ${REDEEM_STREAK}× in a row — or tap ✓ to dismiss it. The numbers
      below cover the last 7 days.</p>
      <div class="stat-strip">
        <div class="stat-chip"><b>${totalA}</b><span>answers</span></div>
        <div class="stat-chip"><b>${totalA ? Math.round((1 - totalW / totalA) * 100) : 0}%</b><span>accuracy</span></div>
        <div class="stat-chip"><b>${touched}</b><span>signs touched</span></div>
      </div>
      <div class="panel" style="margin-top:18px">
        <h2>Top 5 signs you miss</h2>
        ${
          weak.length
            ? weak
                .map(
                  (w) => `
          <div class="weak-row">
            ${signImg(w.s)}
            <div style="min-width:130px"><b>${primaryName(w.s)}</b><br><span class="cat-sub">${subEn(w.s)}${esc(w.s.id)}${w.streak ? ` · ${w.streak}/${REDEEM_STREAK} to clear` : ""}</span></div>
            <div class="weak-bar"><i style="width:${Math.round(w.rate * 100)}%"></i></div>
            <div style="width:70px;text-align:right" class="cat-sub">${w.wrong}/${w.total} miss</div>
            <button class="weak-dismiss" data-dismiss="${esc(w.s.id)}" title="Got it — remove from weak spots">✓</button>
          </div>`,
                )
                .join("")
            : `<p class="empty">No mistakes logged yet this week — go do a quiz and come back! 🚦</p>`
        }
        ${weak.length ? `<button class="btn wide" id="drill" style="margin-top:16px">Drill this set now</button>` : ""}
      </div>`;
    view.querySelectorAll("[data-dismiss]").forEach((b) => {
      b.onclick = () => {
        const dismissed = LS.get("lm_weak_dismissed", {});
        dismissed[b.dataset.dismiss] = Date.now();
        LS.set("lm_weak_dismissed", dismissed);
        Views.stats();
      };
    });
    const drill = $("#drill");
    if (drill)
      drill.onclick = () =>
        runQuiz({
          title: "Weak-spot drill",
          questions: shuffle(weak.map((w) => w.s)),
          distractorPool: POOL,
          onDone: (res) => quizResult(res, () => Views.stats()),
        });
  };

  // ======================================================================
  //  PROGRESS LISTS (tap a home stat chip → see those signs)
  // ======================================================================
  // Browse-style grid of signs, each card showing the name and memory box.
  function renderSignList(title, subtitle, signs, emptyMsg) {
    const cards = signs
      .map((s) =>
        signCard(s, `memory ${progress[s.id] ? progress[s.id].box : 0}/5`),
      )
      .join("");
    view.innerHTML = `
      ${backBar()}
      <h1>${esc(title)}</h1>
      <p class="sub">${esc(subtitle)}</p>
      ${
        signs.length
          ? `<div class="sign-grid">${cards}</div>`
          : `<p class="empty">${esc(emptyMsg)}</p>`
      }`;
  }
  // Practised signs, strongest-known first.
  const byBoxDesc = (a, b) =>
    (progress[b.id]?.box || 0) - (progress[a.id]?.box || 0) ||
    a.id.localeCompare(b.id);
  Views.practised = () => {
    const signs = POOL.filter((s) => progress[s.id]).sort(byBoxDesc);
    renderSignList(
      "Signs practised",
      `${signs.length} sign${signs.length === 1 ? "" : "s"} you've answered at least once.`,
      signs,
      "You haven't practised any signs yet — try Study or a quiz! 🚦",
    );
  };
  Views.wellknown = () => {
    const signs = POOL.filter(
      (s) => progress[s.id] && progress[s.id].box >= 4,
    ).sort(byBoxDesc);
    renderSignList(
      "Well known",
      `${signs.length} sign${signs.length === 1 ? "" : "s"} at memory level 4–5. One miss drops a sign back to 1.`,
      signs,
      "Nothing well known yet — answer signs correctly a few times to build them up! 💪",
    );
  };
  Views.weakspots = () => {
    const signs = weakStats().weak.map((w) => w.s);
    renderSignList(
      "Weak spots",
      `${signs.length} sign${signs.length === 1 ? "" : "s"} you've missed and not yet cleared. See “My weak spots” to drill or dismiss them.`,
      signs,
      "No weak spots right now — nice! 🎉",
    );
  };

  // ======================================================================
  //  BROWSE (every sign, grouped by category)
  // ======================================================================
  Views.browse = () => {
    view.innerHTML = `
      ${backBar()}
      <h1>🔎 All signs</h1>
      <p class="sub">${ALL.length} signs across ${CATS.length} categories.</p>
      ${CATS.map(
        (c) => `
        <h2 class="cat-head">${c.key} · ${catLabel(c)}</h2>
        <div class="sign-grid">
          ${c.signs.map((s) => signCard(s, esc(s.id))).join("")}
        </div>`,
      ).join("")}`;
  };

  // ---------- boot ----------
  if (!ALL.length) {
    view.innerHTML = `<div class="empty">No sign data found. Check that <code>data/signs.js</code> is present and loaded.</div>`;
  } else {
    nav("home");
  }
})();
