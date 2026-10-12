const titleInput = document.querySelector('#article-title');
const bodyInput = document.querySelector('#article-body');
const analyzeButton = document.querySelector('#analyze-btn');
const results = document.querySelector('#results');
const error = document.querySelector('#form-error');
const count = document.querySelector('#char-count');
let activePlatform = 'x';
let ideas = [];
const selectedPosts = new Map();
const SHEETS_SETTINGS_KEY = 'kotoba-no-tane-sheets-settings';

// Later, personal preferences and outcomes can adjust the same transparent score.
const preferenceSignals = { liked: [], disliked: [], adopted: [], highResponse: [] };
const MATERIAL_TYPES = [
  { label: '体験談', terms: ['経験','体験','やってみ','始めた','続けた','初めて','実際に'] },
  { label: '失敗談', terms: ['失敗','うまくいかな','後悔','間違','挫折','やめた','困った'] },
  { label: '気づき', terms: ['気づ','分かった','わかった','学ん','発見','考えが変','見方が変'] },
  { label: '本音', terms: ['正直','本当は','実は','ぶっちゃけ','感じて','思ってい'] },
  { label: '共感', terms: ['悩','不安','つら','難しい','大変','迷','苦手'] },
  { label: 'ノウハウ', terms: ['方法','コツ','手順','ポイント','やり方','意識','工夫'] },
  { label: '問題提起', terms: ['なぜ','問題','課題','必要','べき','当たり前','違和感'] },
  { label: '質問', terms: ['？','でしょうか','ですか','ませんか','どう思','ありますか'] },
  { label: '意外な視点', terms: ['意外','実は','逆','一方','思い込み','とは限ら','ところが'] }
];

bodyInput.addEventListener('input', () => { count.textContent = `${bodyInput.value.length.toLocaleString('ja-JP')} 文字`; });
document.querySelector('#edit-btn').addEventListener('click', () => { document.querySelector('#editor-title').scrollIntoView({behavior:'smooth'}); titleInput.focus({preventScroll:true}); });
document.querySelectorAll('.platform').forEach(button => button.addEventListener('click', () => {
  activePlatform = button.dataset.platform;
  document.querySelectorAll('.platform').forEach(item => item.classList.toggle('active', item === button));
  renderIdeas();
}));
const gasUrlInput = document.querySelector('#gas-url');
const gasSecretInput = document.querySelector('#gas-secret');
try {
  const savedSettings = JSON.parse(localStorage.getItem(SHEETS_SETTINGS_KEY) || '{}');
  gasUrlInput.value = savedSettings.url || '';
  gasSecretInput.value = savedSettings.secret || '';
} catch { /* Ignore invalid local settings. */ }
[gasUrlInput, gasSecretInput].forEach(input => input.addEventListener('change', saveSheetsSettings));
document.querySelector('#select-all').addEventListener('change', event => setPlatformSelection(event.target.checked));
document.querySelector('#clear-selection').addEventListener('click', () => { selectedPosts.clear(); renderIdeas(); updateSelectionUI(); });
document.querySelector('#save-sheets').addEventListener('click', saveSelectedPosts);
analyzeButton.addEventListener('click', analyze);

function saveSheetsSettings() {
  try { localStorage.setItem(SHEETS_SETTINGS_KEY, JSON.stringify({url:gasUrlInput.value.trim(), secret:gasSecretInput.value})); }
  catch { showSaveStatus('設定を保存できませんでした。このブラウザのlocalStorageを確認してください。', true); }
}
function makePost(idea, platform) {
  const id = `${idea.id}-${platform}`;
  return {id, plannedDate:'', plannedTime:'', platform:platform === 'x' ? 'X' : 'Threads', text:platform === 'x' ? idea.x : idea.threads, angle:idea.tag, target:idea.audience, score:idea.score, status:'未投稿', articleTitle:idea.articleTitle};
}
function setPlatformSelection(checked) {
  ideas.forEach(idea => {
    const post = makePost(idea, activePlatform);
    if (checked) selectedPosts.set(post.id, post); else selectedPosts.delete(post.id);
  });
  renderIdeas(); updateSelectionUI();
}
function updateSelectionUI() {
  document.querySelector('#selection-count').textContent = `${selectedPosts.size}件選択中`;
  const visible = ideas.map(idea => makePost(idea, activePlatform));
  document.querySelector('#select-all').checked = visible.length > 0 && visible.every(post => selectedPosts.has(post.id));
  document.querySelector('#select-all').indeterminate = visible.some(post => selectedPosts.has(post.id)) && !document.querySelector('#select-all').checked;
}
function showSaveStatus(message, isError = false) {
  const status = document.querySelector('#save-status'); status.textContent = message;
  status.classList.toggle('save-error', isError);
}
async function saveSelectedPosts() {
  const url = gasUrlInput.value.trim();
  if (!url) { showSaveStatus('先にGoogle Apps Script WebアプリURLを設定してください。', true); document.querySelector('#sheets-settings').open = true; gasUrlInput.focus(); return; }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(url)) { showSaveStatus('WebアプリURLの形式を確認してください。', true); return; }
  const posts = [...selectedPosts.values()];
  if (!posts.length) { showSaveStatus('保存する投稿候補を選択してください。', true); return; }
  const button = document.querySelector('#save-sheets'); button.disabled = true; button.textContent = '送信中…';
  showSaveStatus(`${posts.length}件を送信しています…`);
  try {
    // text/plain avoids a CORS preflight; Apps Script accepts the JSON in the POST body.
    await fetch(url, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain;charset=UTF-8'}, body:JSON.stringify({secret:gasSecretInput.value, posts})});
    showSaveStatus(`結果未確認：送信要求は完了しましたが、保存されたかは判定できません（no-corsではHTTPエラーも読み取れません）。スプレッドシートとApps Scriptの実行履歴をご確認ください。`, true);
  } catch (err) {
    showSaveStatus('送信に失敗しました。URL、ネットワーク、Apps Scriptのデプロイ設定をご確認ください。', true);
  } finally { button.disabled = false; button.textContent = 'Googleスプレッドシートへ保存'; }
}

function analyze() {
  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();
  error.hidden = true;
  if (!title || !body) {
    error.textContent = !title && !body ? '記事タイトルと本文を入力してください。' : !title ? '記事タイトルを入力してください。' : '記事本文を入力してください。';
    error.hidden = false;
    (!title ? titleInput : bodyInput).focus();
    return;
  }
  const topic = getTopic(title, body);
  const keywords = getKeywords(title, body);
  const audiences = inferAudiences(body, keywords);
  const targetList = document.querySelector('#target-list');
  targetList.replaceChildren(...audiences.map(item => makeChip(`${item.label} · ${item.reason}`)));
  const materials = extractMaterials(body, keywords);
  renderMaterials(materials);
  const angles = [...new Set(materials.slice(0, 3).map(item => item.type))];
  document.querySelector('#angle-list').replaceChildren(...angles.map(makeChip));
  ideas = buildIdeas(title, body, topic, keywords, materials, audiences);
  document.querySelector('#idea-count').textContent = `${ideas.length}案`;
  results.hidden = false;
  renderIdeas();
  results.scrollIntoView({behavior:'smooth',block:'start'});
}

function makeChip(text) { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = text; return chip; }
function getTopic(title, body) {
  const clean = title.replace(/[「」【】『』！？!?。、:：]/g,' ').trim();
  const match = clean.match(/(.{2,18}?)(?:を|が|で|の|に|と|から|について|とは)/);
  return match ? match[1].trim() : (body.split(/[。！？\n]/).find(part => part.trim().length > 4) || clean).trim().slice(0,18);
}
function getKeywords(title, body) {
  const source = `${title} ${body}`;
  const candidates = [...new Set((source.match(/[一-龠々ぁ-んァ-ヶー]{2,}/g) || []))];
  const stop = new Set(['これから','ところ','こと','もの','ため','自分','今回','記事','方法','理由','そして','しかし','それぞれ','とても','できる','など','ように','という','について','でした','ます','です','ある','いる','なる','する','した','から','まで','より','その','この','また','ために']);
  const useful = candidates.filter(word => !stop.has(word) && !/^(それ|これ|ここ|そこ|あれ|今回)$/.test(word));
  const ranked = useful.map(word => [word, [...source.matchAll(new RegExp(escapeRegExp(word),'g'))].length])
    .sort((a,b) => b[1] * Math.min(b[0].length,6) - a[1] * Math.min(a[0].length,6)).map(item => item[0]);
  return [...new Set([topicWord(title), ...ranked])].filter(Boolean).slice(0,5);
}
function topicWord(title) { return title.replace(/[「」【】『』！？!?。、:：]/g,' ').trim().split(/[をがでのにと]/)[0] || ''; }
function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

function inferAudiences(body, keywords) {
  const cues = [
    [/仕事|職場|会社|働く|キャリア|会議|上司|部下/,'仕事','仕事の進め方や働き方を見直したい人'],
    [/子ども|育児|保育|家族|子育て|学校/,'子育て','子育てや家族との暮らしを大切にする人'],
    [/健康|睡眠|運動|食事|体調|心|ストレス/,'健康','心身の調子を整えたい人'],
    [/お金|投資|貯金|節約|家計/,'お金','家計やお金の扱いを学びたい人'],
    [/勉強|学習|資格|読書|習慣|学び/,'学び','学びや習慣づくりに取り組む人'],
    [/旅行|旅|観光|ホテル|温泉/,'旅行','旅や新しい体験が好きな人'],
    [/料理|レシピ|食材|食べる|ごはん/,'料理','日々の食事や料理を楽しみたい人'],
    [/デザイン|SNS|発信|文章|ブログ|コンテンツ/,'発信','発信やコンテンツづくりを始めたい人']
  ];
  const matches = cues.filter(([pattern]) => pattern.test(body)).map(([,label,reason]) => ({label,reason}));
  return matches.length ? matches.slice(0,4) : [{label:keywords[0] || '記事テーマ',reason:`「${keywords[0] || '記事テーマ'}」に関心があり、実践のヒントを探している人`}];
}

function splitSentences(body) { return body.split(/[。！？\n]+/).map(s => s.trim()).filter(s => s.length >= 10); }
function extractMaterials(body, keywords) {
  return splitSentences(body).map((text, index) => {
    const matched = MATERIAL_TYPES.filter(type => type.terms.some(term => text.includes(term)));
    const type = matched[0]?.label || (/[0-9０-９]/.test(text) ? 'ノウハウ' : '気づき');
    const specificity = Math.min(3, (/[0-9０-９]/.test(text) ? 1 : 0) + (text.length >= 25 ? 1 : 0) + (/(私|自分|失敗|経験|実際|昨日|先月|年前)/.test(text) ? 1 : 0));
    const relevance = keywords.reduce((n, word) => n + (text.includes(word) ? 1 : 0), 0);
    const generic = /(大切です|重要です|頑張りましょう|意識しましょう|誰でも|すべての人)/.test(text);
    const score = Math.max(1, Math.min(5, 1 + specificity + (relevance ? 1 : 0) - (generic ? 2 : 0)));
    return {text, type, score, index, reasons: [specificity >= 2 ? '具体的な経験・描写' : '具体性は控えめ', relevance ? '記事テーマとの結びつき' : 'テーマとの結びつきは弱め', generic ? '一般論の表現を含む' : '一般論に寄りすぎていない']};
  }).sort((a,b) => b.score - a.score || a.index - b.index).slice(0,8);
}
function renderMaterials(materials) {
  const list = document.querySelector('#material-list');
  if (!materials.length) { list.textContent = '素材候補になる文章が見つかりませんでした。本文を少し長く入力してください。'; return; }
  list.replaceChildren(...materials.map(item => {
    const card = document.createElement('article'); card.className = 'material-card';
    const head = document.createElement('div'); head.className = 'material-head';
    const tag = document.createElement('span'); tag.className = 'idea-tag'; tag.textContent = item.type;
    const score = document.createElement('span'); score.className = item.score <= 2 ? 'score score-low' : 'score'; score.textContent = `素材の強さ ${item.score}/5`;
    const quote = document.createElement('p'); quote.textContent = item.text;
    const note = document.createElement('small'); note.textContent = item.reasons.join(' · ');
    head.append(tag,score); card.append(head,quote,note); return card;
  }));
}

function buildIdeas(title, body, topic, keywords, materials, audiences) {
  const pool = materials.length ? materials : [{text:title,type:'気づき',score:1}];
  const target = audiences[0]?.label || topic;
  const raw = pool.slice(0,5).map((material, index) => {
    const original = material.text;
    const tag = material.type;
    const x = `記事からの素材：${original}\n\n${target}に向けて、この経験から伝えたいことをひとつ添えて投稿する。`;
    const threads = `${original}\n\n${target}の方に聞いてみたいこと：あなたならどうしますか？`;
    const hasFirstPerson = /(私|自分|僕|わたし|当時|昨日|先月)/.test(original);
    const generic = /(大切です|重要です|頑張りましょう|意識しましょう|誰でも)/.test(original);
    let score = 20 + material.score * 10 + (hasFirstPerson ? 12 : 0) + (original.length >= 25 ? 8 : 0) - (generic ? 25 : 0);
    // Extension points for future personal taste and post performance feedback.
    if (preferenceSignals.liked.some(signal => original.includes(signal))) score += 6;
    if (preferenceSignals.disliked.some(signal => original.includes(signal))) score -= 10;
    if (preferenceSignals.adopted.some(signal => original.includes(signal))) score += 8;
    if (preferenceSignals.highResponse.some(signal => original.includes(signal))) score += 12;
    const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `post-${Date.now()}-${index}-${Math.random().toString(36).slice(2,8)}`;
    return {id, articleTitle:title, tag, score:Math.max(1,Math.min(99,score)), x, threads, material, audience:target, index};
  });
  return raw.sort((a,b) => b.score - a.score || a.index - b.index);
}

function renderIdeas() {
  const list = document.querySelector('#idea-list');
  list.replaceChildren(...ideas.map((idea,index)=>{
    const card=document.createElement('article'); card.className='idea-card';
    const top=document.createElement('div');top.className='idea-top';
    const selectLabel=document.createElement('label');selectLabel.className='idea-select';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selectedPosts.has(makePost(idea,activePlatform).id);checkbox.setAttribute('aria-label',`${activePlatform === 'x' ? 'X' : 'Threads'}向け投稿「${idea.tag}」を選択`);
    checkbox.addEventListener('change',()=>{const post=makePost(idea,activePlatform);if(checkbox.checked)selectedPosts.set(post.id,post);else selectedPosts.delete(post.id);updateSelectionUI();});
    const selectText=document.createElement('span');selectText.textContent=activePlatform === 'x' ? 'X' : 'Threads';selectLabel.append(checkbox,selectText);
    const tag=document.createElement('span');tag.className='idea-tag';tag.textContent=`${String(index+1).padStart(2,'0')} · ${idea.tag} · ${idea.audience}向け`;
    const score=document.createElement('span');score.className=idea.score < 45 ? 'score score-low' : 'score';score.textContent=`おすすめ度 ${idea.score}点`;
    top.append(selectLabel,tag,score);
    const text=document.createElement('p');text.textContent=activePlatform==='x'?idea.x:idea.threads;
    const bottom=document.createElement('div');bottom.className='idea-bottom';
    const network=document.createElement('small');network.textContent=activePlatform==='x'?'𝕏  X向け · 素材起点':'◉  Threads向け · 対話起点';
    const copy=document.createElement('button');copy.className='copy-btn';copy.type='button';copy.textContent='▢ コピー';
    copy.addEventListener('click', async () => {
      let copied = false;
      try {
        await navigator.clipboard.writeText(text.textContent);
        copied = true;
      } catch {
        const selection = document.createElement('textarea');
        selection.value = text.textContent;
        selection.setAttribute('readonly', '');
        selection.style.position = 'fixed';
        selection.style.left = '-9999px';
        document.body.append(selection);
        selection.select();
        try { copied = document.execCommand('copy'); } catch { copied = false; }
        selection.remove();
      }
      copy.textContent = copied ? '✓ コピーしました' : 'コピーできませんでした';
      copy.classList.toggle('copied', copied);
      if (copied) setTimeout(() => { copy.textContent = '▢ コピー'; copy.classList.remove('copied'); }, 1600);
    });
    bottom.append(network,copy);card.append(top,text,bottom);return card;
  }));
  updateSelectionUI();
}
