(function () {
  'use strict';

  // ── 質問リスト ──────────────────────────────────────────
  const QUESTIONS = [
    'Q1.  私を、動物に例えるとしたら何ですか？\n     理由も教えてください。',
    'Q2.  私のことを、初めて会ったとき\n     どんな人だと思いましたか？',
    'Q3.  私が「自分では気づいていない」と\n     思うことがあれば教えてください。',
    'Q4.  私と話していて、一番よく出てくる\n     話題や言葉は何ですか？',
    'Q5.  私は10年後、どんな人間に\n     なっていると思いますか？',
    'Q6.  最後に、私を一文で紹介するとしたら？'
  ];

  // ── セッショントークン（ブラウザ内のみ、サーバーに個人情報とは紐づかない） ──
  const sessionToken = (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  );

  let currentIndex = 0;
  let isSubmitting = false;

  // ── DOM 参照 ────────────────────────────────────────────
  const formSection  = document.getElementById('form-section');
  const questionEl   = document.getElementById('question');
  const progressEl   = document.getElementById('progress');
  const answerEl     = document.getElementById('answer');
  const submitBtn    = document.getElementById('submit-btn');
  const completionEl = document.getElementById('completion');
  const restartBtn   = document.getElementById('restart-btn');

  // ── テキストエリア自動リサイズ ───────────────────────────
  function resizeTextarea() {
    answerEl.style.height = 'auto';
    answerEl.style.height = answerEl.scrollHeight + 'px';
  }

  // ── 質問を表示 ──────────────────────────────────────────
  function showQuestion(index) {
    progressEl.textContent = `${index + 1} / ${QUESTIONS.length}`;
    questionEl.classList.remove('visible');
    answerEl.value = '';
    answerEl.style.height = '';
    submitBtn.disabled = true;

    setTimeout(() => {
      questionEl.textContent = QUESTIONS[index];
      questionEl.classList.add('visible');
      answerEl.focus();
    }, 320);
  }

  // ── パーティクルアニメーション ──────────────────────────
  function createParticles(text, originEl, callback) {
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth;
    const H = window.innerHeight;

    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.cssText = [
      'position:fixed', 'top:0', 'left:0',
      `width:${W}px`, `height:${H}px`,
      'pointer-events:none', 'z-index:9999'
    ].join(';');

    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const rect = originEl.getBoundingClientRect();
    const ox = rect.left + rect.width / 2;
    const oy = rect.top  + rect.height / 2;

    // テキストから文字を抽出（空白除く）
    const chars = text.replace(/\s/g, '').split('');
    // 50〜80粒、文字が少なければ繰り返し使う
    const COUNT = Math.max(40, Math.min(80, chars.length));

    const particles = Array.from({ length: COUNT }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 9;
      return {
        ch:    chars[i % chars.length],
        x:     ox + (Math.random() - 0.5) * rect.width  * 0.6,
        y:     oy + (Math.random() - 0.5) * rect.height * 0.4,
        vx:    Math.cos(angle) * speed,
        vy:    Math.sin(angle) * speed - 1.8,
        rot:   Math.random() * Math.PI * 2,
        rotV:  (Math.random() - 0.5) * 0.18,
        size:  10 + Math.random() * 11,
        alpha: 0.85 + Math.random() * 0.15,
        decay: 0.016 + Math.random() * 0.014
      };
    });

    function animate() {
      ctx.clearRect(0, 0, W, H);
      let alive = false;

      for (const p of particles) {
        if (p.alpha <= 0) continue;
        alive = true;

        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += 0.13;   // 重力
        p.vx *= 0.975;  // 空気抵抗
        p.rot += p.rotV;
        p.alpha -= p.decay;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.font = `bold ${p.size}px 'M PLUS Rounded 1c', sans-serif`;
        // 青とピンクをランダムに混ぜる
        ctx.fillStyle = p.size > 16 ? '#3B5BDB' : '#E879A0';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillText(p.ch, 0, 0);
        ctx.restore();
      }

      if (alive) {
        requestAnimationFrame(animate);
      } else {
        document.body.removeChild(canvas);
        callback();
      }
    }

    requestAnimationFrame(animate);
  }

  // ── 回答を送信 ──────────────────────────────────────────
  async function handleSubmit() {
    const answer = answerEl.value.trim();
    if (!answer || isSubmitting || submitBtn.disabled) return;

    isSubmitting = true;
    submitBtn.disabled = true;
    answerEl.disabled  = true;

    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token:   sessionToken,
          question_number: currentIndex + 1,
          answer
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '送信に失敗しました');

      // パーティクル → 次の質問 or 完了
      createParticles(answer, submitBtn, () => {
        isSubmitting = false;
        answerEl.disabled = false;
        currentIndex++;

        if (currentIndex >= QUESTIONS.length) {
          formSection.style.display = 'none';
          // 少し遅延してからフェードイン
          requestAnimationFrame(() => {
            completionEl.style.display = 'flex';
            requestAnimationFrame(() => completionEl.classList.add('visible'));
          });
        } else {
          showQuestion(currentIndex);
        }
      });

    } catch (err) {
      console.error(err);
      isSubmitting = false;
      answerEl.disabled = false;
      submitBtn.disabled = false;
      alert('送信に失敗しました。再試行してください。\n' + err.message);
    }
  }

  // ── イベントリスナー ────────────────────────────────────
  answerEl.addEventListener('input', () => {
    resizeTextarea();
    submitBtn.disabled = answerEl.value.trim().length === 0;
  });

  // Ctrl+Enter / Cmd+Enter で送信
  answerEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  });

  submitBtn.addEventListener('click', handleSubmit);

  restartBtn.addEventListener('click', () => {
    location.reload();
  });

  // ── 初期化 ──────────────────────────────────────────────
  function init() {
    requestAnimationFrame(() => {
      formSection.classList.add('visible');
      showQuestion(0);
    });
  }

  init();
})();
