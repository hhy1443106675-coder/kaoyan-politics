/**
 * 研政智库 2027 · 考研政治全真题库与智能刷题系统
 * Pure Frontend Offline Engine (4,631 Questions + 227 History Coordinates)
 */
(function () {
  "use strict";

  const BANK = window.KAOYAN_POLITICS_BANK || [];
  const HISTORY = window.KAOYAN_HISTORY_TIMELINE || { events: [], comparisons: [] };
  const STORAGE_KEY = "kaoyan_politics_hub_v1";
  const THEME_KEY = "kaoyan_politics_theme";
  const SESSION_KEY = "kaoyan_politics_last_session_v1";

  // 建立 O(1) 哈希索引，大幅提升 3,762 道题的检索与判题响应速度
  const BANK_MAP = new Map();
  BANK.forEach(q => BANK_MAP.set(q.id, q));

  // 用户进度状态：{ answers: {id: {userAns, isRight, ts}}, wrong: {id: count}, starred: {id: 1}, mastered: {id: 1}, essays: {id: text}, settings: {autoRemoveWrong: false} }
  let userStore = {
    answers: {},
    wrong: {},
    starred: {},
    mastered: {},
    essays: {},
    settings: { autoRemoveWrong: false }
  };

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        userStore.answers = parsed.answers || {};
        userStore.wrong = parsed.wrong || {};
        userStore.starred = parsed.starred || {};
        userStore.mastered = parsed.mastered || {};
        userStore.essays = parsed.essays || {};
        userStore.settings = parsed.settings || { autoRemoveWrong: false };
      }
    } catch (e) {
      console.warn("Load store failed:", e);
    }
    // 仅在本地局域网同步服务 (127.0.0.1 / localhost / 10.x / 192.168.x) 下请求 /api/progress，避免 GitHub Pages 产生 404
    const isLocalHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
    if (location.protocol.startsWith("http") && isLocalHost) {
      fetch("/api/progress")
        .then(r => r.ok ? r.json() : null)
        .then(remote => {
          if (remote && (remote.answers || remote.wrong || remote.starred)) {
            userStore.answers = { ...(remote.answers || {}), ...userStore.answers };
            userStore.wrong = { ...(remote.wrong || {}), ...userStore.wrong };
            userStore.starred = { ...(remote.starred || {}), ...userStore.starred };
            userStore.mastered = { ...(remote.mastered || {}), ...userStore.mastered };
            userStore.essays = { ...(remote.essays || {}), ...userStore.essays };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(userStore));
            updateGlobalStatsUI();
            if (state.view === "dashboard") renderDashboard();
            else if (state.view === "practice") applyFiltersAndRenderPractice(true);
          }
        })
        .catch(() => {});
    }
  }

  function saveStore(isReset) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userStore));
    } catch (e) {
      console.warn("Save store failed:", e);
    }
    updateGlobalStatsUI();
    const isLocalHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
    if (location.protocol.startsWith("http") && isLocalHost) {
      const payload = isReset ? { _reset: true } : userStore;
      fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }
  }

  function saveLastSession() {
    if (state.view !== "practice" || state.filteredQuestions.length === 0) return;
    const curQ = state.filteredQuestions[state.currentIndex];
    const snap = {
      filterBank: state.filterBank,
      filterSubject: state.filterSubject,
      filterChapter: state.filterChapter,
      filterType: state.filterType,
      filterStatus: state.filterStatus,
      currentIndex: state.currentIndex,
      qid: curQ ? curQ.id : "",
      label: `${curQ ? curQ.subject_short + " · " + curQ.chapter : "综合题库"} (第 ${state.currentIndex + 1}/${state.filteredQuestions.length} 题)`
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(snap));
    } catch (e) {}
  }

  // 当前工作台状态
  let state = {
    view: "dashboard", // dashboard | practice | mock | timeline
    catalogBank: "xiao1000_2027",
    filterBank: "all",
    filterSubject: "all",
    filterChapter: "all",
    filterType: "all",
    filterStatus: "all",
    searchQuery: "",
    practiceMode: "do", // do | recite
    layoutMode: "single", // single | list
    filteredQuestions: [],
    currentIndex: 0,
    sheetPage: 0,
    listPage: 0,
    // 当前单题的多选临时勾选 { qid: Set(['A','B']) }
    draftSelections: {},
    // 当前已揭晓答案的题目 { qid: true }
    revealedMap: {},
    // 模考状态
    mockQuestions: [],
    mockAnswers: {},
    mockSubmitted: false,
    mockTimerId: null,
    mockRemainSec: 0,
    // 史纲时间轴状态
    tlMode: "all", // all | comparisons | quiz
    tlEra: "all",  // all | old_dem | new_dem | socialist
    tlQuery: ""
  };

  const SUBJECT_META = [
    { short: "马原", full: "马克思主义基本原理", color: "#dc2626", desc: "唯物论 · 辩证法 · 认识论 · 唯物史观 · 政经 · 科社" },
    { short: "毛中特", full: "毛泽东思想和中国特色社会主义理论体系概论", color: "#d97706", desc: "新民主主义革命 · 社会主义改造 · 初步探索 · 中特理论" },
    { short: "新思想", full: "习近平新时代中国特色社会主义思想概论", color: "#e11d48", desc: "中国式现代化 · 高质量发展 · 全过程人民民主 · 党的自我革命" },
    { short: "史纲", full: "中国近现代史纲要", color: "#2563eb", desc: "旧民主主义探索 · 辛亥与五四 · 抗战与解放 · 新中国建设" },
    { short: "思修", full: "思想道德与法治", color: "#16a34a", desc: "人生观与理想信念 · 中国精神与核心价值观 · 道德与法治" },
    { short: "时政与当代", full: "形势与政策以及当代世界经济与政治", color: "#9333ea", desc: "年度重大会议精神 · 习近平重要讲话 · 当代世界经济与政治" }
  ];

  // =========================================================================
  // Toast 提示
  // =========================================================================
  function showToast(msg) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const el = document.createElement("div");
    el.className = "toast-msg";
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 220);
    }, 2200);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightText(str, query) {
    const safe = escapeHtml(str);
    const q = (query || "").trim();
    if (!q) return safe;
    const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      return safe.replace(new RegExp(`(${escapedQ})`, "gi"), `<mark class="hl-match">$1</mark>`);
    } catch (e) {
      return safe;
    }
  }

  function closeMobileSidebar() {
    const sb = document.getElementById("sidebar");
    const bd = document.getElementById("sidebarBackdrop");
    if (sb) sb.classList.remove("open");
    if (bd) bd.classList.remove("open");
  }

  // =========================================================================
  // 主题切换
  // =========================================================================
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || "light";
    applyTheme(saved);
    document.getElementById("btnThemeToggle").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "light";
      const next = cur === "light" ? "dark" : "light";
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("iconSun").style.display = theme === "dark" ? "block" : "none";
    document.getElementById("iconMoon").style.display = theme === "dark" ? "none" : "block";
  }

  // =========================================================================
  // 全局统计刷新
  // =========================================================================
  function updateGlobalStatsUI() {
    const total = BANK.length;
    const doneIds = Object.keys(userStore.answers);
    const doneCount = doneIds.length;
    let rightCount = 0;
    doneIds.forEach(id => {
      if (userStore.answers[id] && userStore.answers[id].isRight) rightCount++;
    });
    const acc = doneCount > 0 ? Math.round((rightCount / doneCount) * 100) + "%" : "--%";
    const wrongCount = Object.keys(userStore.wrong).length;
    const starCount = Object.keys(userStore.starred).length;

    document.getElementById("globalProgressText").textContent = `${doneCount} / ${total}`;
    document.getElementById("globalProgressBar").style.width = `${Math.min(100, (doneCount / Math.max(1, total)) * 100).toFixed(1)}%`;
    document.getElementById("globalAccText").textContent = acc;
    document.getElementById("globalWrongText").textContent = wrongCount;
    document.getElementById("globalStarText").textContent = starCount;
    document.getElementById("qfWrongNum").textContent = wrongCount;
    document.getElementById("qfStarNum").textContent = starCount;
  }

  // =========================================================================
  // 视图切换
  // =========================================================================
  function switchView(viewName, preserveIndex) {
    closeMobileSidebar();
    state.view = viewName;
    document.querySelectorAll(".view-panel").forEach(p => p.classList.remove("active"));
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add("active");

    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === viewName);
    });

    if (viewName === "dashboard") {
      renderDashboard();
    } else if (viewName === "practice") {
      applyFiltersAndRenderPractice(preserveIndex);
    } else if (viewName === "timeline") {
      renderTimeline();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // =========================================================================
  // Dashboard 渲染：六大学科卡片 + 章节/真题套卷目录 + 断点续刷
  // =========================================================================
  function renderDashboard() {
    renderResumeBannerButton();
    renderSubjectCards();
    renderChapterCatalog();
  }

  function renderResumeBannerButton() {
    const btn = document.getElementById("btnResumeLastSession");
    const txt = document.getElementById("resumeSessionText");
    if (!btn || !txt) return;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) {
        btn.style.display = "none";
        return;
      }
      const snap = JSON.parse(raw);
      if (snap && snap.label) {
        btn.style.display = "inline-flex";
        txt.textContent = `继续上次：${snap.label}`;
      } else {
        btn.style.display = "none";
      }
    } catch (e) {
      btn.style.display = "none";
    }
  }

  function renderSubjectCards() {
    const grid = document.getElementById("dashboardSubjectGrid");
    if (!grid) return;
    let html = "";
    SUBJECT_META.forEach(sm => {
      const qs = BANK.filter(q => q.subject_short === sm.short);
      const total = qs.length;
      let done = 0;
      let right = 0;
      qs.forEach(q => {
        const rec = userStore.answers[q.id];
        if (rec) {
          done++;
          if (rec.isRight) right++;
        }
      });
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const acc = done > 0 ? Math.round((right / done) * 100) + "%" : "--%";
      html += `
        <div class="subject-card" data-goto-subj="${escapeHtml(sm.short)}">
          <div class="sc-top">
            <span class="sc-badge">${escapeHtml(sm.short)}</span>
            <span class="sc-count">${total} 题</span>
          </div>
          <div class="sc-title" title="${escapeHtml(sm.full)}">${escapeHtml(sm.full)}</div>
          <div class="sc-bar"><div class="sc-bar-fill" style="width:${pct}%"></div></div>
          <div class="sc-foot">
            <span>已刷 ${done}/${total} (${pct}%)</span>
            <span>正确率 <strong>${acc}</strong></span>
          </div>
        </div>
      `;
    });
    grid.innerHTML = html;

    grid.querySelectorAll(".subject-card").forEach(card => {
      card.addEventListener("click", () => {
        const s = card.getAttribute("data-goto-subj");
        setSubjectFilter(s);
        switchView("practice");
      });
    });
  }

  function renderChapterCatalog() {
    const grid = document.getElementById("chapterCatalogGrid");
    if (!grid) return;

    const cbank = state.catalogBank;
    const bankQs = BANK.filter(q => q.bank === cbank && (state.filterSubject === "all" || q.subject_short === state.filterSubject));

    // Group by chapter (or year for past_paper)
    const groups = new Map();
    bankQs.forEach(q => {
      const key = cbank === "past_paper" ? `${q.year}年考研政治真题` : `${q.subject_short}｜${q.chapter}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          subject_short: q.subject_short,
          chapter: q.chapter,
          year: q.year,
          items: []
        });
      }
      groups.get(key).items.push(q);
    });

    let groupList = Array.from(groups.values());
    if (cbank === "past_paper") {
      groupList.sort((a, b) => b.year - a.year);
    }

    if (groupList.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--text-muted)">当前学科筛选下暂无该题库章节，请点击顶部「全部学科」查看。</div>`;
      return;
    }

    let html = "";
    groupList.forEach(g => {
      const total = g.items.length;
      let singleCnt = 0, multiCnt = 0, essayCnt = 0, doneCnt = 0;
      g.items.forEach(q => {
        if (q.type === "single") singleCnt++;
        else if (q.type === "multiple") multiCnt++;
        else essayCnt++;
        if (userStore.answers[q.id]) doneCnt++;
      });
      const typeSummary = [
        singleCnt ? `单选 ${singleCnt}` : "",
        multiCnt ? `多选 ${multiCnt}` : "",
        essayCnt ? `大题 ${essayCnt}` : ""
      ].filter(Boolean).join(" · ");

      html += `
        <div class="chapter-card" data-cbank="${escapeHtml(cbank)}" data-cchapter="${escapeHtml(g.chapter)}" data-csubj="${escapeHtml(g.subject_short)}" data-cyear="${g.year}">
          <div class="cc-head">
            <span class="cc-subj">${escapeHtml(cbank === "past_paper" ? g.year + " 真题卷" : g.subject_short)}</span>
            <span class="cc-total">共 ${total} 题</span>
          </div>
          <div class="cc-title">${escapeHtml(cbank === "past_paper" ? g.year + "年全国硕士研究生招生考试政治真题" : g.chapter)}</div>
          <div class="cc-foot">
            <span>${typeSummary}</span>
            <span>进度 <strong>${doneCnt}/${total}</strong></span>
          </div>
        </div>
      `;
    });

    grid.innerHTML = html;

    grid.querySelectorAll(".chapter-card").forEach(card => {
      card.addEventListener("click", () => {
        const b = card.getAttribute("data-cbank");
        const ch = card.getAttribute("data-cchapter");
        const yr = card.getAttribute("data-cyear");
        const subj = card.getAttribute("data-csubj");

        state.filterBank = b;
        if (b === "past_paper") {
          state.filterSubject = "all";
          syncTopSubjectChips();
          populateChapterDropdown();
          state.filterChapter = `YEAR_${yr}`;
        } else {
          state.filterSubject = subj;
          syncTopSubjectChips();
          populateChapterDropdown();
          state.filterChapter = ch;
        }
        document.getElementById("filterBankSelect").value = state.filterBank;
        document.getElementById("filterChapterSelect").value = state.filterChapter;
        syncSidebarBankPills();
        switchView("practice");
      });
    });
  }

  // =========================================================================
  // 过滤器与章节下拉框同步
  // =========================================================================
  function populateChapterDropdown() {
    const sel = document.getElementById("filterChapterSelect");
    if (!sel) return;

    const subset = BANK.filter(q => {
      if (state.filterBank !== "all" && q.bank !== state.filterBank) return false;
      if (state.filterSubject !== "all" && q.subject_short !== state.filterSubject) return false;
      return true;
    });

    let optionsHtml = `<option value="all">全部章节 / 年份套卷 (${subset.length})</option>`;

    if (state.filterBank === "past_paper") {
      const yearCounts = {};
      subset.forEach(q => { yearCounts[q.year] = (yearCounts[q.year] || 0) + 1; });
      Object.keys(yearCounts).sort((a, b) => b - a).forEach(yr => {
        optionsHtml += `<option value="YEAR_${yr}">${yr}年考研政治真题 (${yearCounts[yr]}题)</option>`;
      });
    } else {
      const chMap = new Map();
      subset.forEach(q => {
        const c = q.chapter || "默认章节";
        chMap.set(c, (chMap.get(c) || 0) + 1);
      });
      chMap.forEach((cnt, ch) => {
        optionsHtml += `<option value="${escapeHtml(ch)}">${escapeHtml(ch)} (${cnt}题)</option>`;
      });
    }

    sel.innerHTML = optionsHtml;
    if (!Array.from(sel.options).some(o => o.value === state.filterChapter)) {
      state.filterChapter = "all";
    }
    sel.value = state.filterChapter;
  }

  function applyFiltersAndRenderPractice(preserveIndex) {
    const qLower = state.searchQuery.trim().toLowerCase();

    state.filteredQuestions = BANK.filter(q => {
      if (state.filterBank !== "all" && q.bank !== state.filterBank) return false;
      if (state.filterSubject !== "all" && q.subject_short !== state.filterSubject) return false;
      if (state.filterChapter !== "all") {
        if (state.filterChapter.startsWith("YEAR_")) {
          const yr = parseInt(state.filterChapter.replace("YEAR_", ""), 10);
          if (q.year !== yr) return false;
        } else if (q.chapter !== state.filterChapter) {
          return false;
        }
      }
      if (state.filterType !== "all" && q.type !== state.filterType) return false;

      if (state.filterStatus === "undone" && userStore.answers[q.id]) return false;
      if (state.filterStatus === "wrong" && !userStore.wrong[q.id]) return false;
      if (state.filterStatus === "starred" && !userStore.starred[q.id]) return false;
      if (state.filterStatus === "mastered" && !userStore.mastered[q.id]) return false;

      if (qLower) {
        const hay = `${q.content} ${q.analysis} ${q.point_note} ${q.chapter} ${q.year} ${(q.options || []).map(o => o.content).join(" ")}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });

    document.getElementById("navCurrentCount").textContent = state.filteredQuestions.length;

    if (!preserveIndex) {
      state.currentIndex = 0;
      state.sheetPage = 0;
      state.listPage = 0;
    } else if (state.currentIndex >= state.filteredQuestions.length) {
      state.currentIndex = Math.max(0, state.filteredQuestions.length - 1);
    }

    renderQuestionStage();
    renderAnswerSheet();
  }

  // =========================================================================
  // 刷题主舞台渲染（支持单题沉浸模式 & 瀑布流列表模式）
  // =========================================================================
  function renderQuestionStage() {
    const stage = document.getElementById("questionStage");
    if (!stage) return;

    const list = state.filteredQuestions;
    if (list.length === 0) {
      stage.innerHTML = `
        <div class="question-card" style="text-align:center;padding:48px 24px">
          <h3 style="margin-bottom:8px">当前筛选条件下没有匹配的题目</h3>
          <p style="color:var(--text-muted);margin-bottom:18px">你可以重置筛选条件或切换其他题库继续刷题。</p>
          <button class="qc-submit-btn" id="btnResetFiltersEmpty">重置全部筛选条件</button>
        </div>
      `;
      const btn = document.getElementById("btnResetFiltersEmpty");
      if (btn) {
        btn.addEventListener("click", () => {
          state.filterBank = "all";
          state.filterSubject = "all";
          state.filterChapter = "all";
          state.filterType = "all";
          state.filterStatus = "all";
          state.searchQuery = "";
          document.getElementById("globalSearchInput").value = "";
          document.getElementById("filterBankSelect").value = "all";
          document.getElementById("filterTypeSelect").value = "all";
          document.getElementById("filterStatusSelect").value = "all";
          syncTopSubjectChips();
          syncSidebarBankPills();
          populateChapterDropdown();
          applyFiltersAndRenderPractice();
        });
      }
      return;
    }

    if (state.layoutMode === "single") {
      const q = list[state.currentIndex];
      stage.innerHTML = buildQuestionCardHtml(q, state.currentIndex, list.length, true);
      bindQuestionCardEvents(stage);
    } else {
      const pageSize = 20;
      const totalPages = Math.ceil(list.length / pageSize);
      if (state.listPage >= totalPages) state.listPage = Math.max(0, totalPages - 1);
      const start = state.listPage * pageSize;
      const slice = list.slice(start, start + pageSize);

      let html = slice.map((q, idx) => buildQuestionCardHtml(q, start + idx, list.length, false)).join("");
      if (totalPages > 1) {
        html += `
          <div class="question-card" style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px">
            <button class="qc-nav-btn" id="btnListPrevPage" ${state.listPage === 0 ? "disabled" : ""}>← 上一页 (20题)</button>
            <span style="font-weight:700;font-size:0.9rem">第 ${state.listPage + 1} / ${totalPages} 页（共 ${list.length} 题）</span>
            <button class="qc-nav-btn" id="btnListNextPage" ${state.listPage >= totalPages - 1 ? "disabled" : ""}>下一页 (20题) →</button>
          </div>
        `;
      }
      stage.innerHTML = html;
      bindQuestionCardEvents(stage);

      const prevP = document.getElementById("btnListPrevPage");
      const nextP = document.getElementById("btnListNextPage");
      if (prevP) prevP.addEventListener("click", () => { state.listPage--; renderQuestionStage(); window.scrollTo({ top: 0, behavior: "smooth" }); });
      if (nextP) nextP.addEventListener("click", () => { state.listPage++; renderQuestionStage(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    }
  }

  function buildQuestionCardHtml(q, idx, totalLen, isSingleMode) {
    const rec = userStore.answers[q.id];
    const isRevealed = state.practiceMode === "recite" || state.revealedMap[q.id] || !!rec;
    const draftSet = state.draftSelections[q.id] || new Set(rec ? (rec.userAns || "").split("") : []);
    const hlQuery = state.searchQuery;

    const typeLabel = q.type === "single" ? "单选题 · 1分" : q.type === "multiple" ? "多选题 · 2分" : "材料分析题 · 10分";
    const typeClass = q.type === "single" ? "badge-single" : q.type === "multiple" ? "badge-multiple" : "badge-essay";

    const isStar = !!userStore.starred[q.id];
    const isWrong = !!userStore.wrong[q.id];
    const isMaster = !!userStore.mastered[q.id];

    // 构建选项
    let optionsHtml = "";
    if (q.type !== "essay" && q.options && q.options.length > 0) {
      const rightSet = new Set((q.answer || "").split(""));
      optionsHtml = `<div class="qc-options">` + q.options.map(opt => {
        const k = opt.key;
        const picked = draftSet.has(k);
        let cls = "opt-row";
        if (!isRevealed) {
          if (picked) cls += " selected";
        } else {
          if (state.practiceMode === "recite" && !rec) {
            if (rightSet.has(k)) cls += " correct";
          } else {
            if (rightSet.has(k) && picked) cls += " correct";
            else if (rightSet.has(k) && !picked) cls += " missed";
            else if (!rightSet.has(k) && picked) cls += " wrong";
          }
        }
        return `
          <div class="${cls}" data-qid="${escapeHtml(q.id)}" data-opt="${escapeHtml(k)}" data-qtype="${q.type}">
            <span class="opt-key">${escapeHtml(k)}</span>
            <div class="opt-text">${highlightText(opt.content, hlQuery)}</div>
          </div>
        `;
      }).join("") + `</div>`;
    } else if (q.type === "essay") {
      const savedEssay = (userStore.essays && userStore.essays[q.id]) || "";
      optionsHtml = `
        <div style="margin-top:10px">
          <textarea class="essay-textarea" data-essay-qid="${escapeHtml(q.id)}" placeholder="在此输入你的主观题答题思路或关键词要点（自动实时保存），随后点击下方「展开参考答案与解析」进行比对...">${escapeHtml(savedEssay)}</textarea>
        </div>
      `;
    }

    // 底部操作按钮
    let submitBtnHtml = "";
    if (!isRevealed) {
      if (q.type === "multiple") {
        submitBtnHtml = `<button class="qc-submit-btn" data-action="submit-multi" data-qid="${escapeHtml(q.id)}">确认提交多选答案 (Enter)</button>`;
      } else if (q.type === "essay") {
        submitBtnHtml = `<button class="qc-submit-btn" data-action="reveal-essay" data-qid="${escapeHtml(q.id)}">展开参考答案与解析</button>`;
      } else {
        submitBtnHtml = `<button class="qc-nav-btn" data-action="reveal-single" data-qid="${escapeHtml(q.id)}">直接看解析</button>`;
      }
    } else {
      submitBtnHtml = `<button class="qc-nav-btn" data-action="redo-question" data-qid="${escapeHtml(q.id)}">重做本题</button>`;
    }

    let navBtnsHtml = "";
    if (isSingleMode) {
      navBtnsHtml = `
        <div class="qc-nav-btns">
          <button class="qc-nav-btn" id="btnPrevQuestion" ${idx === 0 ? "disabled" : ""}>← 上一题</button>
          <button class="qc-nav-btn" id="btnNextQuestion" ${idx >= totalLen - 1 ? "disabled" : ""}>下一题 →</button>
        </div>
      `;
    }

    // 解析与核心背诵卡片
    let analysisHtml = "";
    if (isRevealed) {
      let verdictBadge = "";
      if (q.type === "essay") {
        verdictBadge = `<span class="verdict-pill verdict-info">材料分析题参考要点</span>`;
      } else if (rec) {
        verdictBadge = rec.isRight
          ? `<span class="verdict-pill verdict-right">✓ 回答正确（你的答案：${escapeHtml(rec.userAns)}）</span>`
          : `<span class="verdict-pill verdict-wrong">✗ 回答错误（你的答案：${escapeHtml(rec.userAns || "未选")}）</span>`;
      } else {
        verdictBadge = `<span class="verdict-pill verdict-info">背题模式 · 答案直览</span>`;
      }

      const pointNoteBlock = q.point_note
        ? `<div class="point-note-box"><strong>【核心背诵 · 命题点拨】</strong>\n${highlightText(q.point_note, hlQuery)}</div>`
        : "";

      analysisHtml = `
        <div class="qc-analysis-box">
          <div class="ans-verdict-row">
            ${verdictBadge}
            ${q.type !== "essay" ? `<span class="ans-key-label">标准答案：<strong>${escapeHtml(q.answer)}</strong></span>` : ""}
          </div>
          <div class="analysis-section-title">权威精析与干扰项辨析</div>
          <div class="analysis-content">${highlightText(q.analysis || "请结合核心考点理解记忆。", hlQuery)}</div>
          ${pointNoteBlock}
          <div class="qc-source-line">来源：${escapeHtml(q.source_note || q.bank_name)} · 章节：${escapeHtml(q.chapter)}</div>
        </div>
      `;
    }

    return `
      <article class="question-card" data-card-qid="${escapeHtml(q.id)}">
        <div class="qc-meta-bar">
          <div class="qc-badges">
            <span class="badge-index">第 ${idx + 1} / ${totalLen} 题</span>
            <span class="badge-type ${typeClass}">${typeLabel}</span>
            <span class="badge-subj">${escapeHtml(q.subject_short)} · ${escapeHtml(q.chapter)}</span>
            ${q.tag ? `<span class="badge-tag">${escapeHtml(q.tag)}</span>` : ""}
          </div>
          <div class="qc-actions">
            <button class="qc-act-btn ${isStar ? "active-star" : ""}" data-action="toggle-star" data-qid="${escapeHtml(q.id)}">
              ${isStar ? "★ 已收藏" : "☆ 收藏 (S)"}
            </button>
            <button class="qc-act-btn ${isWrong ? "active-wrong" : ""}" data-action="toggle-wrong" data-qid="${escapeHtml(q.id)}">
              ${isWrong ? "✗ 在错题本" : "+ 记错题 (W)"}
            </button>
            <button class="qc-act-btn ${isMaster ? "active-master" : ""}" data-action="toggle-master" data-qid="${escapeHtml(q.id)}">
              ${isMaster ? "✓ 已掌握" : "标记掌握"}
            </button>
          </div>
        </div>

        <div class="qc-stem">${highlightText(q.content, hlQuery)}</div>
        ${optionsHtml}

        <div class="qc-footer-bar">
          <div>${submitBtnHtml}</div>
          ${navBtnsHtml}
        </div>

        ${analysisHtml}
      </article>
    `;
  }

  function bindQuestionCardEvents(stage) {
    saveLastSession();

    // 选项点击
    stage.querySelectorAll(".opt-row").forEach(row => {
      row.addEventListener("click", () => {
        const qid = row.getAttribute("data-qid");
        const opt = row.getAttribute("data-opt");
        const qtype = row.getAttribute("data-qtype");
        handleOptionPick(qid, opt, qtype);
      });
    });

    // 材料分析题自测输入框自动持久化
    stage.querySelectorAll(".essay-textarea").forEach(ta => {
      ta.addEventListener("input", () => {
        const qid = ta.getAttribute("data-essay-qid");
        if (!userStore.essays) userStore.essays = {};
        if (ta.value.trim()) userStore.essays[qid] = ta.value;
        else delete userStore.essays[qid];
        saveStore();
      });
    });

    // 动作按钮
    stage.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-action");
        const qid = btn.getAttribute("data-qid");
        if (act === "submit-multi") submitMultipleChoice(qid);
        else if (act === "reveal-essay" || act === "reveal-single") {
          state.revealedMap[qid] = true;
          if (act === "reveal-essay") {
            userStore.answers[qid] = { userAns: "已自测", isRight: true, ts: Date.now() };
            saveStore();
            renderAnswerSheet();
          }
          renderQuestionStage();
        } else if (act === "redo-question") {
          delete userStore.answers[qid];
          delete state.draftSelections[qid];
          delete state.revealedMap[qid];
          saveStore();
          renderQuestionStage();
          renderAnswerSheet();
        } else if (act === "toggle-star") {
          if (userStore.starred[qid]) delete userStore.starred[qid];
          else userStore.starred[qid] = 1;
          saveStore();
          renderQuestionStage();
          renderAnswerSheet();
        } else if (act === "toggle-wrong") {
          if (userStore.wrong[qid]) delete userStore.wrong[qid];
          else userStore.wrong[qid] = 1;
          saveStore();
          renderQuestionStage();
          renderAnswerSheet();
        } else if (act === "toggle-master") {
          if (userStore.mastered[qid]) delete userStore.mastered[qid];
          else userStore.mastered[qid] = 1;
          saveStore();
          renderQuestionStage();
        }
      });
    });

    const prevBtn = document.getElementById("btnPrevQuestion");
    const nextBtn = document.getElementById("btnNextQuestion");
    if (prevBtn) prevBtn.addEventListener("click", () => goRelativeQuestion(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => goRelativeQuestion(1));
  }

  function handleOptionPick(qid, optKey, qtype) {
    const q = BANK_MAP.get(qid);
    if (!q) return;

    if (qtype === "single") {
      // 单选题：即点即判
      const isRight = q.answer === optKey;
      userStore.answers[qid] = { userAns: optKey, isRight, ts: Date.now() };
      if (!isRight) {
        userStore.wrong[qid] = (userStore.wrong[qid] || 0) + 1;
      } else if (userStore.settings && userStore.settings.autoRemoveWrong && userStore.wrong[qid]) {
        delete userStore.wrong[qid];
        showToast("✓ 答对错题，已自动从错题本移除！");
      }
      state.draftSelections[qid] = new Set([optKey]);
      state.revealedMap[qid] = true;
      saveStore();
      renderQuestionStage();
      renderAnswerSheet();
    } else if (qtype === "multiple") {
      // 多选题：若已判题则先重置，否则切换选项
      if (state.revealedMap[qid] || userStore.answers[qid]) return;
      if (!state.draftSelections[qid]) state.draftSelections[qid] = new Set();
      const set = state.draftSelections[qid];
      if (set.has(optKey)) set.delete(optKey);
      else set.add(optKey);
      renderQuestionStage();
    }
  }

  function submitMultipleChoice(qid) {
    const q = BANK_MAP.get(qid);
    if (!q) return;
    const set = state.draftSelections[qid] || new Set();
    if (set.size === 0) {
      showToast("请至少勾选 1 个选项后再提交");
      return;
    }
    const userAns = Array.from(set).sort().join("");
    const rightAns = (q.answer || "").split("").sort().join("");
    const isRight = userAns === rightAns;
    userStore.answers[qid] = { userAns, isRight, ts: Date.now() };
    if (!isRight) {
      userStore.wrong[qid] = (userStore.wrong[qid] || 0) + 1;
    } else if (userStore.settings && userStore.settings.autoRemoveWrong && userStore.wrong[qid]) {
      delete userStore.wrong[qid];
      showToast("✓ 答对错题，已自动从错题本移除！");
    }
    state.revealedMap[qid] = true;
    saveStore();
    renderQuestionStage();
    renderAnswerSheet();
  }

  function goRelativeQuestion(delta) {
    const nextIdx = state.currentIndex + delta;
    if (nextIdx < 0 || nextIdx >= state.filteredQuestions.length) return;
    state.currentIndex = nextIdx;
    state.sheetPage = Math.floor(nextIdx / 60);
    renderQuestionStage();
    renderAnswerSheet();
  }

  // =========================================================================
  // 右侧题号导航矩阵 (分页每页 60 题，秒级响应不卡顿)
  // =========================================================================
  function renderAnswerSheet() {
    const grid = document.getElementById("answerSheetGrid");
    const posText = document.getElementById("asPositionText");
    const pager = document.getElementById("asPagination");
    if (!grid || !posText || !pager) return;

    const list = state.filteredQuestions;
    const total = list.length;
    if (total === 0) {
      posText.textContent = "0 / 0";
      grid.innerHTML = "";
      pager.innerHTML = "";
      return;
    }

    posText.textContent = `${state.currentIndex + 1} / ${total}`;

    const pageSize = 60;
    const totalPages = Math.ceil(total / pageSize);
    if (state.sheetPage >= totalPages) state.sheetPage = Math.max(0, totalPages - 1);

    const start = state.sheetPage * pageSize;
    const slice = list.slice(start, start + pageSize);

    grid.innerHTML = slice.map((q, i) => {
      const realIdx = start + i;
      const rec = userStore.answers[q.id];
      let cls = "as-cell";
      if (realIdx === state.currentIndex) cls += " current";
      if (rec) cls += rec.isRight ? " right" : " wrong";
      if (userStore.starred[q.id]) cls += " starred";
      return `<button class="${cls}" data-jump-idx="${realIdx}">${realIdx + 1}</button>`;
    }).join("");

    grid.querySelectorAll(".as-cell").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-jump-idx"), 10);
        state.currentIndex = idx;
        if (state.layoutMode === "list") {
          state.listPage = Math.floor(idx / 20);
        }
        renderQuestionStage();
        renderAnswerSheet();
      });
    });

    if (totalPages > 1) {
      pager.innerHTML = `
        <button class="as-page-btn" id="asPrevPage" ${state.sheetPage === 0 ? "disabled" : ""}>上一组</button>
        <span>${start + 1}–${Math.min(total, start + pageSize)} / ${total}</span>
        <button class="as-page-btn" id="asNextPage" ${state.sheetPage >= totalPages - 1 ? "disabled" : ""}>下一组</button>
      `;
      const pBtn = document.getElementById("asPrevPage");
      const nBtn = document.getElementById("asNextPage");
      if (pBtn) pBtn.addEventListener("click", () => { state.sheetPage--; renderAnswerSheet(); });
      if (nBtn) nBtn.addEventListener("click", () => { state.sheetPage++; renderAnswerSheet(); });
    } else {
      pager.innerHTML = `<span>共 ${total} 道题</span>`;
    }
  }

  // =========================================================================
  // 全真限时模考舱 (16 单选 + 17 多选 = 50 分标准卷)
  // =========================================================================
  function sampleArray(arr, count) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy.slice(0, count);
  }

  function launchMockExam() {
    const src = document.getElementById("mockSourceSelect").value;
    const mins = parseInt(document.getElementById("mockDurationSelect").value, 10) || 45;

    let pool = [];
    if (src.startsWith("past_20")) {
      const yr = parseInt(src.replace("past_", ""), 10);
      pool = BANK.filter(q => q.bank === "past_paper" && q.year === yr && q.type !== "essay");
    } else if (src === "past_paper_random") {
      pool = BANK.filter(q => q.bank === "past_paper" && q.type !== "essay");
    } else if (src === "wrong_book") {
      pool = BANK.filter(q => userStore.wrong[q.id] && q.type !== "essay");
      if (pool.length < 10) {
        showToast("错题本题目不足 10 道，已自动从 2027 肖秀荣 1000 题补齐！");
        pool = pool.concat(BANK.filter(q => q.bank === "xiao1000_2027" && q.type !== "essay"));
      }
    } else {
      pool = BANK.filter(q => q.bank === src && q.type !== "essay");
    }

    let singles = pool.filter(q => q.type === "single");
    let multiples = pool.filter(q => q.type === "multiple");

    if (!src.startsWith("past_20")) {
      // 严格按考研真题学科分值权重组卷：马原(4单+5多) + 毛中特&新思想(6单+6多) + 史纲(3单+3多) + 思修&时政(3单+3多)
      const pickWeighted = (list, targetCount, quotas) => {
        if (list.length <= targetCount) return sampleArray(list, targetCount);
        let picked = [];
        const usedIds = new Set();
        quotas.forEach(qt => {
          const subPool = list.filter(q => qt.match(q.subject_short) && !usedIds.has(q.id));
          const chosen = sampleArray(subPool, qt.cnt);
          chosen.forEach(q => { picked.push(q); usedIds.add(q.id); });
        });
        if (picked.length < targetCount) {
          const rest = list.filter(q => !usedIds.has(q.id));
          picked = picked.concat(sampleArray(rest, targetCount - picked.length));
        }
        return picked.slice(0, targetCount);
      };
      singles = pickWeighted(singles, 16, [
        { match: s => s === "马原", cnt: 4 },
        { match: s => s === "毛中特" || s === "新思想", cnt: 6 },
        { match: s => s === "史纲", cnt: 3 },
        { match: s => s === "思修" || s === "时政与当代", cnt: 3 }
      ]);
      multiples = pickWeighted(multiples, 17, [
        { match: s => s === "马原", cnt: 5 },
        { match: s => s === "毛中特" || s === "新思想", cnt: 6 },
        { match: s => s === "史纲", cnt: 3 },
        { match: s => s === "思修" || s === "时政与当代", cnt: 3 }
      ]);
    } else {
      singles = singles.slice(0, 16);
      multiples = multiples.slice(0, 17);
    }

    state.mockQuestions = singles.concat(multiples);
    state.mockAnswers = {};
    state.mockSubmitted = false;
    state.mockRemainSec = mins * 60;

    if (state.mockTimerId) clearInterval(state.mockTimerId);
    state.mockTimerId = setInterval(() => {
      if (state.mockSubmitted) return;
      state.mockRemainSec--;
      const timerEl = document.getElementById("mockTimerDisplay");
      if (timerEl) {
        const m = String(Math.floor(Math.max(0, state.mockRemainSec) / 60)).padStart(2, "0");
        const s = String(Math.max(0, state.mockRemainSec) % 60).padStart(2, "0");
        timerEl.textContent = `${m}:${s}`;
      }
      if (state.mockRemainSec <= 0) {
        clearInterval(state.mockTimerId);
        submitMockPaper();
      }
    }, 1000);

    document.getElementById("mockSetupCard").style.display = "none";
    const activeArea = document.getElementById("mockActiveArea");
    activeArea.style.display = "block";
    renderMockActiveArea();
  }

  function renderMockActiveArea() {
    const area = document.getElementById("mockActiveArea");
    if (!area) return;

    const qs = state.mockQuestions;
    const m = String(Math.floor(Math.max(0, state.mockRemainSec) / 60)).padStart(2, "0");
    const s = String(Math.max(0, state.mockRemainSec) % 60).padStart(2, "0");

    let scoreSummaryHtml = "";
    if (state.mockSubmitted) {
      let totalScore = 0;
      let singleRight = 0, multiRight = 0;
      const subjStats = {
        "马原": { got: 0, max: 0 },
        "毛中特 & 新思想": { got: 0, max: 0 },
        "史纲": { got: 0, max: 0 },
        "思修与时政": { got: 0, max: 0 }
      };
      qs.forEach(q => {
        const pts = q.type === "single" ? 1 : 2;
        const bucket = q.subject_short === "马原" ? "马原"
          : (q.subject_short === "毛中特" || q.subject_short === "新思想") ? "毛中特 & 新思想"
          : q.subject_short === "史纲" ? "史纲" : "思修与时政";
        subjStats[bucket].max += pts;

        const uAns = (state.mockAnswers[q.id] || "").split("").sort().join("");
        const rAns = (q.answer || "").split("").sort().join("");
        const ok = uAns === rAns;
        if (ok) {
          totalScore += pts;
          subjStats[bucket].got += pts;
          if (q.type === "single") singleRight++;
          else multiRight++;
        }
      });

      const breakdownHtml = Object.keys(subjStats).map(k => `
        <div class="msb-box">
          <span>${escapeHtml(k)}</span>
          <strong>${subjStats[k].got} / ${subjStats[k].max} 分</strong>
        </div>
      `).join("");

      scoreSummaryHtml = `
        <div class="hero-banner" style="margin-bottom:16px">
          <div class="hero-text" style="max-width:100%">
            <div class="hero-badge">MOCK EXAM REPORT · 模考成绩诊断报告</div>
            <h2>客观题总分：${totalScore} / 50 分</h2>
            <p>单项选择题：答对 <strong>${singleRight} / 16</strong> 题（得 ${singleRight} 分） · 多项选择题：答对 <strong>${multiRight} / 17</strong> 题（得 ${multiRight * 2} 分）。所有答错题目已自动同步至你的错题本！</p>
            <div class="mock-subj-breakdown">${breakdownHtml}</div>
          </div>
        </div>
      `;
    }

    const barHtml = `
      <div class="mock-running-bar">
        <div>
          <strong>考研政治 50 分标准客观题模考卷</strong>
          <span style="margin-left:12px;font-size:0.84rem;color:var(--text-muted)">已作答 ${Object.keys(state.mockAnswers).filter(k => state.mockAnswers[k]).length} / ${qs.length} 题</span>
        </div>
        <div style="display:flex;align-items:center;gap:14px">
          <span class="mock-timer" id="mockTimerDisplay">${m}:${s}</span>
          ${!state.mockSubmitted
            ? `<button class="qc-submit-btn" id="btnSubmitMockNow">交卷并查看得分</button>`
            : `<button class="qc-nav-btn" id="btnExitMock">返回重新组卷</button>`}
        </div>
      </div>
    `;

    const navStripHtml = `
      <div class="mock-nav-strip">
        <span style="font-size:0.76rem;font-weight:700;color:var(--text-muted);margin-right:4px">题号速跳：</span>
        ${qs.map((q, idx) => {
          const uStr = (state.mockAnswers[q.id] || "").split("").sort().join("");
          const rStr = (q.answer || "").split("").sort().join("");
          let cls = "mock-nav-cell";
          if (!state.mockSubmitted) {
            if (uStr) cls += " answered";
          } else {
            cls += (uStr === rStr) ? " right" : " wrong";
          }
          return `<button type="button" class="${cls}" data-mock-jump="${idx}">${idx + 1}</button>`;
        }).join("")}
      </div>
    `;

    const cardsHtml = qs.map((q, idx) => {
      const uStr = state.mockAnswers[q.id] || "";
      const uSet = new Set(uStr.split(""));
      const rSet = new Set((q.answer || "").split(""));
      const isRight = uStr.split("").sort().join("") === (q.answer || "").split("").sort().join("");

      const optsHtml = (q.options || []).map(opt => {
        const k = opt.key;
        const picked = uSet.has(k);
        let cls = "opt-row";
        if (!state.mockSubmitted) {
          if (picked) cls += " selected";
        } else {
          if (rSet.has(k) && picked) cls += " correct";
          else if (rSet.has(k) && !picked) cls += " missed";
          else if (!rSet.has(k) && picked) cls += " wrong";
        }
        return `
          <div class="${cls}" data-mock-qid="${escapeHtml(q.id)}" data-mock-opt="${escapeHtml(k)}" data-mock-type="${q.type}">
            <span class="opt-key">${escapeHtml(k)}</span>
            <div class="opt-text">${escapeHtml(opt.content)}</div>
          </div>
        `;
      }).join("");

      const pointNoteBlock = (state.mockSubmitted && q.point_note)
        ? `<div class="point-note-box"><strong>【核心背诵 · 命题点拨】</strong>\n${escapeHtml(q.point_note)}</div>`
        : "";

      const analysisBlock = state.mockSubmitted ? `
        <div class="qc-analysis-box">
          <div class="ans-verdict-row">
            ${isRight
              ? `<span class="verdict-pill verdict-right">✓ 回答正确 (+${q.type === "single" ? 1 : 2}分)</span>`
              : `<span class="verdict-pill verdict-wrong">✗ 回答错误（你的答案：${escapeHtml(uStr || "未作答")}）</span>`}
            <span class="ans-key-label">标准答案：<strong>${escapeHtml(q.answer)}</strong></span>
          </div>
          <div class="analysis-content">${escapeHtml(q.analysis)}</div>
          ${pointNoteBlock}
        </div>
      ` : "";

      return `
        <article class="question-card" id="mock-card-${idx}">
          <div class="qc-meta-bar">
            <div class="qc-badges">
              <span class="badge-index">第 ${idx + 1} 题</span>
              <span class="badge-type ${q.type === "single" ? "badge-single" : "badge-multiple"}">${q.type === "single" ? "单选题 (1分)" : "多选题 (2分)"}</span>
              <span class="badge-subj">${escapeHtml(q.subject_short)} · ${escapeHtml(q.chapter)}</span>
            </div>
          </div>
          <div class="qc-stem">${escapeHtml(q.content)}</div>
          <div class="qc-options">${optsHtml}</div>
          ${analysisBlock}
        </article>
      `;
    }).join("");

    area.innerHTML = scoreSummaryHtml + barHtml + navStripHtml + cardsHtml;

    area.querySelectorAll("[data-mock-jump]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = btn.getAttribute("data-mock-jump");
        const el = document.getElementById(`mock-card-${idx}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });

    area.querySelectorAll("[data-mock-qid]").forEach(row => {
      row.addEventListener("click", () => {
        if (state.mockSubmitted) return;
        const qid = row.getAttribute("data-mock-qid");
        const opt = row.getAttribute("data-mock-opt");
        const qtype = row.getAttribute("data-mock-type");
        if (qtype === "single") {
          state.mockAnswers[qid] = opt;
        } else {
          const set = new Set((state.mockAnswers[qid] || "").split("").filter(Boolean));
          if (set.has(opt)) set.delete(opt);
          else set.add(opt);
          state.mockAnswers[qid] = Array.from(set).sort().join("");
        }
        renderMockActiveArea();
      });
    });

    const subBtn = document.getElementById("btnSubmitMockNow");
    if (subBtn) subBtn.addEventListener("click", submitMockPaper);

    const exitBtn = document.getElementById("btnExitMock");
    if (exitBtn) {
      exitBtn.addEventListener("click", () => {
        if (state.mockTimerId) clearInterval(state.mockTimerId);
        document.getElementById("mockActiveArea").style.display = "none";
        document.getElementById("mockSetupCard").style.display = "block";
      });
    }
  }

  function submitMockPaper() {
    if (state.mockTimerId) clearInterval(state.mockTimerId);
    state.mockSubmitted = true;

    state.mockQuestions.forEach(q => {
      const uAns = (state.mockAnswers[q.id] || "").split("").sort().join("");
      const rAns = (q.answer || "").split("").sort().join("");
      const isRight = uAns === rAns;
      userStore.answers[q.id] = { userAns: uAns, isRight, ts: Date.now() };
      if (!isRight) {
        userStore.wrong[q.id] = (userStore.wrong[q.id] || 0) + 1;
      }
    });
    saveStore();
    renderMockActiveArea();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // =========================================================================
  // 史纲时间轴实验室 (124 核心专题 + 34 组教材权威考证 + 历史分期 + 遮罩背诵 + 联动刷题)
  // =========================================================================
  function getEventYear(ev) {
    const lbl = ev.dates?.textbook?.label || ev.dates?.original?.label || "";
    const m = lbl.match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : 1900;
  }

  function extractTimelineKeyword(title) {
    const clean = (title || "").replace(/^[0-9年月日\s、，．\.]+/, "").trim();
    const mBook = clean.match(/《([^》]{2,10})》/);
    if (mBook) return mBook[1];
    const parts = clean.split(/[，,。；;、\s（）()“”""]+/).filter(p => p.length >= 2);
    return parts[0] ? parts[0].slice(0, 6) : clean.slice(0, 4);
  }

  function renderTimeline() {
    const container = document.getElementById("timelineListContainer");
    if (!container) return;

    const q = state.tlQuery.trim().toLowerCase();

    if (state.tlMode === "comparisons") {
      const comps = (HISTORY.comparisons || []).filter(c => {
        if (!q) return true;
        return `${c.title} ${c.note || ""} ${c.textbook?.label || ""}`.toLowerCase().includes(q);
      });
      container.innerHTML = comps.map(c => `
        <div class="tl-card" style="border-left-color:var(--primary)">
          <div class="tl-date">教材权威考证 · ${escapeHtml(c.kind || "易错辨析")}</div>
          <div class="tl-title">${highlightText(c.title, state.tlQuery)}</div>
          <div class="tl-desc">
            <p><strong>统编教材标准表述：</strong><span style="color:var(--success);font-weight:700">${highlightText(c.textbook?.label || "见注释", state.tlQuery)}</span></p>
            ${c.original?.label ? `<p><strong>旧表/常见误记：</strong>${escapeHtml(c.original.label)}</p>` : ""}
            ${c.note ? `<p style="margin-top:6px;color:var(--text-primary)">${highlightText(c.note, state.tlQuery)}</p>` : ""}
          </div>
        </div>
      `).join("");
      return;
    }

    const isQuiz = state.tlMode === "quiz";

    const events = (HISTORY.events || []).filter(ev => {
      const yr = getEventYear(ev);
      if (state.tlEra === "old_dem" && yr >= 1919) return false;
      if (state.tlEra === "new_dem" && (yr < 1919 || yr >= 1949)) return false;
      if (state.tlEra === "socialist" && yr < 1949) return false;

      if (!q) return true;
      const dateLbl = ev.dates?.textbook?.label || ev.dates?.original?.label || "";
      return `${dateLbl} ${ev.title} ${ev.rich_desc || ""} ${ev.content} ${ev.note || ""}`.toLowerCase().includes(q);
    });

    if (events.length === 0) {
      container.innerHTML = `<div style="grid-column:1/-1;padding:36px;text-align:center;color:var(--text-muted)">该历史时期或关键词下暂无匹配条目</div>`;
      return;
    }

    container.innerHTML = events.map(ev => {
      const dateLbl = (ev.dates?.textbook?.label || ev.dates?.original?.label || "历史节点").replace(/\n/g, " / ");
      const kw = extractTimelineKeyword(ev.title);
      return `
        <div class="tl-card">
          <div class="tl-date">${highlightText(dateLbl, state.tlQuery)}</div>
          <div class="tl-title">${highlightText(ev.title, state.tlQuery)}</div>
          <div class="tl-desc ${isQuiz ? "tl-quiz-mask" : ""}" style="white-space:pre-line" title="${isQuiz ? "点击揭晓考点详情" : ""}">${highlightText(ev.rich_desc || ev.note || "", state.tlQuery)}</div>
          <div class="tl-card-foot">
            <span style="font-size:0.72rem;color:var(--text-muted)">${isQuiz ? "点击上方模糊区揭晓答案" : "史纲核心时间坐标"}</span>
            <button type="button" class="tl-practice-btn" data-tl-kw="${escapeHtml(kw)}">关联真题/1000题 →</button>
          </div>
        </div>
      `;
    }).join("");

    if (isQuiz) {
      container.querySelectorAll(".tl-quiz-mask").forEach(mask => {
        mask.addEventListener("click", () => {
          mask.classList.toggle("revealed");
        });
      });
    }

    container.querySelectorAll("[data-tl-kw]").forEach(btn => {
      btn.addEventListener("click", () => {
        const kw = btn.getAttribute("data-tl-kw");
        state.filterBank = "all";
        state.filterSubject = "all";
        state.filterChapter = "all";
        state.filterType = "all";
        state.filterStatus = "all";
        state.searchQuery = kw;
        const sInp = document.getElementById("globalSearchInput");
        const cBtn = document.getElementById("btnClearSearch");
        if (sInp) sInp.value = kw;
        if (cBtn) cBtn.style.display = "block";
        document.getElementById("filterBankSelect").value = "all";
        document.getElementById("filterTypeSelect").value = "all";
        document.getElementById("filterStatusSelect").value = "all";
        syncTopSubjectChips();
        syncSidebarBankPills();
        populateChapterDropdown();
        switchView("practice");
        showToast(`已为你检索「${kw}」相关的考研政治试题！`);
      });
    });
  }

  // =========================================================================
  // 导出 Obsidian 错题与收藏笔记 (.md)
  // =========================================================================
  function exportObsidianMarkdown() {
    const targetIds = new Set([...Object.keys(userStore.wrong), ...Object.keys(userStore.starred)]);
    let exportQs = BANK.filter(q => targetIds.has(q.id));

    if (exportQs.length === 0) {
      showToast("当前错题本与收藏夹为空，已为你导出当前筛选的前 20 道精选题！");
      exportQs = state.filteredQuestions.slice(0, 20);
    }

    const lines = [
      "# 考研政治错题与核心收藏复盘笔记",
      "",
      `> 生成时间：${new Date().toLocaleString("zh-CN")} ｜ 共收录 **${exportQs.length}** 道重点题目`,
      "",
      "## 自测题与错题精析",
      ""
    ];

    exportQs.forEach((q, i) => {
      const rec = userStore.answers[q.id];
      const tagStr = [q.subject_short, q.bank_name, q.chapter].filter(Boolean).join(" / ");
      lines.push(`### ${i + 1}. 【${q.type === "single" ? "单选" : q.type === "multiple" ? "多选" : "材料分析"}】 (${tagStr})`);
      lines.push("");
      lines.push(q.content);
      lines.push("");
      if (q.options && q.options.length > 0) {
        q.options.forEach(opt => {
          lines.push(`- **${opt.key}.** ${opt.content}`);
        });
        lines.push("");
      }
      lines.push("> [!success]- 答案（点开）");
      lines.push(`> - **标准答案**：**${q.answer || "见解析"}**${rec ? `（上次作答：\`${rec.userAns}\`）` : ""}`);
      if (q.analysis) {
        q.analysis.split("\n").forEach(ln => {
          lines.push(`> ${ln}`);
        });
      }
      if (q.point_note) {
        lines.push(">");
        q.point_note.split("\n").forEach(ln => {
          lines.push(`> ${ln}`);
        });
      }
      lines.push("");
    });

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `考研政治错题与收藏复盘笔记_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${exportQs.length} 道题至 Obsidian 兼容 Markdown 笔记！`);
  }

  // =========================================================================
  // 辅助 UI 同步与事件绑定
  // =========================================================================
  function setSubjectFilter(subj) {
    state.filterSubject = subj;
    syncTopSubjectChips();
    populateChapterDropdown();
  }

  function syncTopSubjectChips() {
    document.querySelectorAll("#topSubjectChips .subj-chip").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-subj") === state.filterSubject);
    });
  }

  function syncSidebarBankPills() {
    document.querySelectorAll(".bank-pill").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-bank") === state.filterBank);
    });
  }

  function bindGlobalEvents() {
    // 左侧视图切换
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        switchView(btn.getAttribute("data-view"));
      });
    });

    // 左侧五大题库源快速切入
    document.querySelectorAll(".bank-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        const b = btn.getAttribute("data-bank");
        state.filterBank = b;
        state.filterChapter = "all";
        state.filterStatus = "all";
        document.getElementById("filterBankSelect").value = b;
        document.getElementById("filterStatusSelect").value = "all";
        syncSidebarBankPills();
        populateChapterDropdown();
        switchView("practice");
      });
    });

    // 左侧错题/收藏/材料大题一键切入
    document.getElementById("btnQuickWrong").addEventListener("click", () => {
      state.filterBank = "all";
      state.filterSubject = "all";
      state.filterChapter = "all";
      state.filterType = "all";
      state.filterStatus = "wrong";
      document.getElementById("filterBankSelect").value = "all";
      document.getElementById("filterTypeSelect").value = "all";
      document.getElementById("filterStatusSelect").value = "wrong";
      syncTopSubjectChips();
      syncSidebarBankPills();
      populateChapterDropdown();
      switchView("practice");
    });

    document.getElementById("btnQuickStar").addEventListener("click", () => {
      state.filterBank = "all";
      state.filterSubject = "all";
      state.filterChapter = "all";
      state.filterType = "all";
      state.filterStatus = "starred";
      document.getElementById("filterBankSelect").value = "all";
      document.getElementById("filterTypeSelect").value = "all";
      document.getElementById("filterStatusSelect").value = "starred";
      syncTopSubjectChips();
      syncSidebarBankPills();
      populateChapterDropdown();
      switchView("practice");
    });

    document.getElementById("btnQuickEssay").addEventListener("click", () => {
      state.filterBank = "all";
      state.filterSubject = "all";
      state.filterChapter = "all";
      state.filterType = "essay";
      state.filterStatus = "all";
      document.getElementById("filterBankSelect").value = "all";
      document.getElementById("filterTypeSelect").value = "essay";
      document.getElementById("filterStatusSelect").value = "all";
      syncTopSubjectChips();
      syncSidebarBankPills();
      populateChapterDropdown();
      switchView("practice");
    });

    // 顶部学科胶囊
    document.querySelectorAll("#topSubjectChips .subj-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        state.filterSubject = btn.getAttribute("data-subj");
        state.filterChapter = "all";
        syncTopSubjectChips();
        populateChapterDropdown();
        if (state.view === "dashboard") {
          renderChapterCatalog();
        } else if (state.view === "practice") {
          applyFiltersAndRenderPractice();
        }
      });
    });

    // 顶部全文搜索
    const searchInput = document.getElementById("globalSearchInput");
    const clearBtn = document.getElementById("btnClearSearch");
    searchInput.addEventListener("input", () => {
      state.searchQuery = searchInput.value;
      clearBtn.style.display = state.searchQuery ? "block" : "none";
      if (state.view !== "practice") {
        switchView("practice");
      } else {
        applyFiltersAndRenderPractice();
      }
    });
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      state.searchQuery = "";
      clearBtn.style.display = "none";
      applyFiltersAndRenderPractice();
    });

    // Dashboard Hero 按钮
    const resumeBtn = document.getElementById("btnResumeLastSession");
    if (resumeBtn) {
      resumeBtn.addEventListener("click", () => {
        try {
          const snap = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
          state.filterBank = snap.filterBank || "all";
          state.filterSubject = snap.filterSubject || "all";
          state.filterType = snap.filterType || "all";
          state.filterStatus = snap.filterStatus || "all";
          document.getElementById("filterBankSelect").value = state.filterBank;
          document.getElementById("filterTypeSelect").value = state.filterType;
          document.getElementById("filterStatusSelect").value = state.filterStatus;
          syncTopSubjectChips();
          syncSidebarBankPills();
          populateChapterDropdown();
          if (snap.filterChapter && Array.from(document.getElementById("filterChapterSelect").options).some(o => o.value === snap.filterChapter)) {
            state.filterChapter = snap.filterChapter;
            document.getElementById("filterChapterSelect").value = state.filterChapter;
          }
          state.currentIndex = snap.currentIndex || 0;
          state.sheetPage = Math.floor(state.currentIndex / 60);
          state.listPage = Math.floor(state.currentIndex / 20);
          switchView("practice", true);
          showToast("已恢复到上次刷题位置！");
        } catch (e) {
          switchView("practice");
        }
      });
    }

    document.getElementById("btnStartXiao2027").addEventListener("click", () => {
      state.filterBank = "xiao1000_2027";
      state.filterChapter = "all";
      document.getElementById("filterBankSelect").value = "xiao1000_2027";
      syncSidebarBankPills();
      populateChapterDropdown();
      switchView("practice");
    });

    document.getElementById("btnStartPastPapers").addEventListener("click", () => {
      state.filterBank = "past_paper";
      state.filterChapter = "all";
      document.getElementById("filterBankSelect").value = "past_paper";
      syncSidebarBankPills();
      populateChapterDropdown();
      switchView("practice");
    });

    document.getElementById("btnStartRandom30").addEventListener("click", () => {
      switchView("practice");
      state.filteredQuestions = sampleArray(BANK.filter(q => q.type !== "essay"), 30);
      state.currentIndex = 0;
      state.sheetPage = 0;
      renderQuestionStage();
      renderAnswerSheet();
      showToast("已为你随机抽取 30 道客观题热身！");
    });

    // Dashboard 章节目录 Tab
    document.querySelectorAll("#catalogBankTabs .cat-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("#catalogBankTabs .cat-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        state.catalogBank = tab.getAttribute("data-cbank");
        renderChapterCatalog();
      });
    });

    // Practice 下拉选择器
    document.getElementById("filterBankSelect").addEventListener("change", e => {
      state.filterBank = e.target.value;
      state.filterChapter = "all";
      syncSidebarBankPills();
      populateChapterDropdown();
      applyFiltersAndRenderPractice();
    });
    document.getElementById("filterChapterSelect").addEventListener("change", e => {
      state.filterChapter = e.target.value;
      applyFiltersAndRenderPractice();
    });
    document.getElementById("filterTypeSelect").addEventListener("change", e => {
      state.filterType = e.target.value;
      applyFiltersAndRenderPractice();
    });
    document.getElementById("filterStatusSelect").addEventListener("change", e => {
      state.filterStatus = e.target.value;
      applyFiltersAndRenderPractice();
    });

    // 做题模式 / 背题模式
    document.querySelectorAll("#practiceModeSeg .seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#practiceModeSeg .seg-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.practiceMode = btn.getAttribute("data-pmode");
        renderQuestionStage();
      });
    });

    // 单题专注 / 瀑布流列表
    document.querySelectorAll("#layoutModeSeg .seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#layoutModeSeg .seg-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.layoutMode = btn.getAttribute("data-lmode");
        renderQuestionStage();
      });
    });

    // 答对自动移错开关
    const autoCleanBtn = document.getElementById("btnAutoCleanWrong");
    function syncAutoCleanUI() {
      if (!autoCleanBtn) return;
      const on = !!(userStore.settings && userStore.settings.autoRemoveWrong);
      autoCleanBtn.classList.toggle("active-toggle", on);
    }
    syncAutoCleanUI();
    if (autoCleanBtn) {
      autoCleanBtn.addEventListener("click", () => {
        if (!userStore.settings) userStore.settings = {};
        userStore.settings.autoRemoveWrong = !userStore.settings.autoRemoveWrong;
        syncAutoCleanUI();
        saveStore();
        showToast(userStore.settings.autoRemoveWrong ? "已开启：答对错题时自动移出错题本" : "已关闭：答对错题时保留在错题本");
      });
    }

    // 乱序按钮
    document.getElementById("btnShuffleCurrent").addEventListener("click", () => {
      state.filteredQuestions = sampleArray(state.filteredQuestions, state.filteredQuestions.length);
      state.currentIndex = 0;
      state.sheetPage = 0;
      state.listPage = 0;
      renderQuestionStage();
      renderAnswerSheet();
      showToast("已打乱当前题目列表顺序！");
    });

    // 重刷本组按钮
    const resetCurBtn = document.getElementById("btnResetCurrentFilter");
    if (resetCurBtn) {
      resetCurBtn.addEventListener("click", () => {
        const list = state.filteredQuestions;
        if (!list.length) return;
        let doneInList = 0;
        list.forEach(q => { if (userStore.answers[q.id]) doneInList++; });
        if (doneInList === 0) {
          showToast("当前筛选列表还没有作答记录");
          return;
        }
        if (confirm(`确定要清空当前筛选列表（共 ${list.length} 题，已做 ${doneInList} 题）的作答记录并重新开始刷题吗？（错题本与收藏夹不会丢失）`)) {
          list.forEach(q => {
            delete userStore.answers[q.id];
            delete state.draftSelections[q.id];
            delete state.revealedMap[q.id];
          });
          state.currentIndex = 0;
          state.sheetPage = 0;
          state.listPage = 0;
          saveStore();
          renderQuestionStage();
          renderAnswerSheet();
          showToast(`已重置当前列表的 ${doneInList} 条作答记录！`);
        }
      });
    }

    // 模考启动
    document.getElementById("btnLaunchMock").addEventListener("click", launchMockExam);

    // 史纲时间轴控制
    document.getElementById("timelineSearchInput").addEventListener("input", e => {
      state.tlQuery = e.target.value;
      renderTimeline();
    });
    document.querySelectorAll("#timelineEraSeg .seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#timelineEraSeg .seg-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.tlEra = btn.getAttribute("data-tlera");
        renderTimeline();
      });
    });
    document.querySelectorAll("#timelineTopicSeg .seg-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#timelineTopicSeg .seg-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.tlMode = btn.getAttribute("data-tltopic");
        renderTimeline();
      });
    });

    // 导出与备份
    document.getElementById("btnExportMd").addEventListener("click", exportObsidianMarkdown);
    document.getElementById("btnBackupJson").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(userStore, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kaoyan_politics_progress_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("做题进度 JSON 备份已下载！");
    });
    document.getElementById("inputRestoreJson").addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          userStore.answers = data.answers || {};
          userStore.wrong = data.wrong || {};
          userStore.starred = data.starred || {};
          userStore.mastered = data.mastered || {};
          saveStore();
          renderDashboard();
          if (state.view === "practice") applyFiltersAndRenderPractice(true);
          showToast("做题记录恢复成功！");
        } catch (err) {
          showToast("JSON 格式无效，恢复失败");
        }
      };
      reader.readAsText(file);
    });
    document.getElementById("btnResetProgress").addEventListener("click", () => {
      if (confirm("确定要清空所有做题记录、错题本和收藏夹吗？建议先点击「备份记录」。")) {
        userStore = { answers: {}, wrong: {}, starred: {}, mastered: {} };
        state.draftSelections = {};
        state.revealedMap = {};
        saveStore(true);
        renderDashboard();
        if (state.view === "practice") applyFiltersAndRenderPractice(true);
        showToast("已重置全部做题进度");
      }
    });

    // 移动端侧栏开关与遮罩关闭
    document.getElementById("btnToggleSidebar").addEventListener("click", () => {
      const sb = document.getElementById("sidebar");
      const bd = document.getElementById("sidebarBackdrop");
      const isOpen = sb.classList.toggle("open");
      if (bd) bd.classList.toggle("open", isOpen);
    });
    const backdrop = document.getElementById("sidebarBackdrop");
    if (backdrop) {
      backdrop.addEventListener("click", closeMobileSidebar);
    }

    // 键盘极速刷题快捷键
    document.addEventListener("keydown", e => {
      if (state.view !== "practice" || state.layoutMode !== "single") return;
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      const q = state.filteredQuestions[state.currentIndex];
      if (!q) return;

      const key = e.key.toUpperCase();
      const mapKey = { "1": "A", "2": "B", "3": "C", "4": "D", "A": "A", "B": "B", "C": "C", "D": "D" };
      if (mapKey[key] && q.type !== "essay") {
        e.preventDefault();
        handleOptionPick(q.id, mapKey[key], q.type);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (q.type === "multiple" && !state.revealedMap[q.id] && !userStore.answers[q.id]) {
          submitMultipleChoice(q.id);
        } else {
          state.revealedMap[q.id] = true;
          renderQuestionStage();
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goRelativeQuestion(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goRelativeQuestion(-1);
      } else if (key === "S") {
        e.preventDefault();
        if (userStore.starred[q.id]) delete userStore.starred[q.id];
        else userStore.starred[q.id] = 1;
        saveStore();
        renderQuestionStage();
        renderAnswerSheet();
      } else if (key === "W") {
        e.preventDefault();
        if (userStore.wrong[q.id]) delete userStore.wrong[q.id];
        else userStore.wrong[q.id] = 1;
        saveStore();
        renderQuestionStage();
        renderAnswerSheet();
      }
    });
  }

  // =========================================================================
  // 私人密码锁验证 (PIN: 7178，采用简单哈希校验防止明文直看)
  // =========================================================================
  const AUTH_TOKEN_KEY = "kaoyan_politics_auth_v1";
  function checkPinHash(str) {
    let h = 2166136261;
    const s = "ky27_" + String(str || "").trim();
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) === 3893239676;
  }

  function initAuthGate(onUnlocked) {
    const overlay = document.getElementById("authLockOverlay");
    const appLayout = document.getElementById("appLayout");
    if (!overlay || !appLayout) {
      onUnlocked();
      return;
    }
    // 本地 file:// 直接打开免密，或者已验证过免密
    if (location.protocol === "file:" || localStorage.getItem(AUTH_TOKEN_KEY) === "unlocked_3893239676") {
      overlay.style.display = "none";
      appLayout.style.display = "flex";
      onUnlocked();
      return;
    }

    const input = document.getElementById("authPinInput");
    const btn = document.getElementById("btnAuthUnlock");
    const err = document.getElementById("authErrorMsg");

    function tryUnlock() {
      if (checkPinHash(input.value)) {
        localStorage.setItem(AUTH_TOKEN_KEY, "unlocked_3893239676");
        overlay.style.display = "none";
        appLayout.style.display = "flex";
        onUnlocked();
      } else {
        err.textContent = "通行口令不正确，请重新输入";
        input.value = "";
        input.focus();
      }
    }

    btn.addEventListener("click", tryUnlock);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") tryUnlock();
    });
    setTimeout(() => input.focus(), 100);
  }

  // =========================================================================
  // 初始化启动
  // =========================================================================
  function init() {
    initTheme();
    loadStore();
    updateGlobalStatsUI();
    populateChapterDropdown();
    bindGlobalEvents();
    renderDashboard();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
