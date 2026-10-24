import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import './styles.css';

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

function getProvider(raw) {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
      let id = url.searchParams.get('v');
      if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0];
      if (!id && url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2];
      if (!id && url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2];
      return { provider: 'youtube', id, url: url.toString() };
    }
    if (host === 'open.spotify.com' || host === 'spotify.com' || host.endsWith('.spotify.com')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const typeIndex = parts.findIndex((part) => ['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(part));
      if (typeIndex >= 0 && parts[typeIndex + 1]) {
        const type = parts[typeIndex];
        const id = parts[typeIndex + 1].split('?')[0];
        return { provider: 'spotify', type, id, url: `https://open.spotify.com/${type}/${id}` };
      }
      return { provider: 'spotify', url: url.toString() };
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') return { provider: 'direct', url: url.toString() };
  } catch {
    return { provider: 'invalid' };
  }
  return { provider: 'invalid' };
}

function App() {
  const [activeTab, setActiveTab] = useState('link');
  const [link, setLink] = useState('');
  const [linkInfo, setLinkInfo] = useState(null);
  const [linkMessage, setLinkMessage] = useState('');
  const [file, setFile] = useState(null);
  const [format, setFormat] = useState('mp3');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [outputUrl, setOutputUrl] = useState('');
  const [outputName, setOutputName] = useState('');
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ffm-history') || '[]'); } catch { return []; }
  });
  const ffmpegRef = useRef(null);
  const inputRef = useRef(null);
  const outputUrlRef = useRef('');

  useEffect(() => {
    localStorage.setItem('ffm-history', JSON.stringify(history.slice(0, 10)));
  }, [history]);

  useEffect(() => () => {
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
  }, []);

  const addHistory = (label, detail) => {
    setHistory((old) => [{ id: Date.now(), label, detail, date: new Date().toLocaleString('tr-TR') }, ...old].slice(0, 10));
  };

  const analyzeLink = () => {
    const info = getProvider(link);
    setLinkInfo(info);
    setLinkMessage('');
    if (!link.trim() || info.provider === 'invalid') {
      setLinkMessage('Geçerli bir https:// veya http:// bağlantısı gir.');
      return;
    }
    if (info.provider === 'youtube' && !info.id) {
      setLinkMessage('YouTube bağlantısındaki video kimliğini okuyamadım. Bağlantıyı kontrol et.');
      return;
    }
    if (info.provider === 'spotify' && !info.type) {
      setLinkMessage('Spotify bağlantısı tanındı. İçerik önizlemesini açmak için parça, albüm veya çalma listesi bağlantısı kullan.');
      return;
    }
    if (info.provider === 'direct') {
      setLinkMessage('Doğrudan dosya bağlantısı algılandı. İndirme, karşı sunucunun bağlantıya izin vermesine ve tarayıcı güvenlik kurallarına bağlıdır.');
    } else if (info.provider === 'youtube' || info.provider === 'spotify') {
      setLinkMessage('Platform bağlantısı tanındı. Resmî oynatıcıyı gösterebiliriz; platform akışını MP3/MP4 dosyasına dönüştürme özelliği bu sürümde yok.');
    }
  };

  const downloadDirect = async () => {
    if (!linkInfo || linkInfo.provider !== 'direct') return;
    setBusy(true);
    setLinkMessage('Bağlantı kontrol ediliyor…');
    try {
      const response = await fetch(linkInfo.url, { mode: 'cors' });
      if (!response.ok) throw new Error(`Sunucu ${response.status} yanıtı verdi.`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('Dosya boş görünüyor.');
      const objectUrl = URL.createObjectURL(blob);
      const rawName = new URL(linkInfo.url).pathname.split('/').filter(Boolean).pop() || 'indirilen-dosya';
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = decodeURIComponent(rawName.split('?')[0]);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      setLinkMessage(`İndirme başlatıldı (${(blob.size / 1024 / 1024).toFixed(2)} MB). Dosya bu tarayıcıda işlendi; sunucumuza yüklenmedi.`);
      addHistory('Doğrudan dosya', rawName);
    } catch (error) {
      setLinkMessage(`Tarayıcı bağlantıyı doğrudan alamadı (${error.message || 'CORS veya erişim engeli'}). Bu, sitemizin dosyayı indirdiği anlamına gelmez. Bağlantıyı yeni sekmede açmayı deneyebilirsin.`);
    } finally {
      setBusy(false);
    }
  };

  const loadEngine = async () => {
    if (ffmpegRef.current && ready) return ffmpegRef.current;
    setStatus('Dönüştürme motoru yükleniyor… İlk kullanımda yaklaşık 30 MB veri indirilebilir.');
    const ffmpeg = ffmpegRef.current || new FFmpeg();
    ffmpegRef.current = ffmpeg;
    ffmpeg.on('log', ({ message }) => {
      if (message && /error|invalid|failed/i.test(message)) setStatus(message.slice(0, 240));
    });
    ffmpeg.on('progress', ({ progress: ratio }) => {
      if (Number.isFinite(ratio)) setProgress(Math.max(0, Math.min(100, Math.round(ratio * 100))));
    });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      workerURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.worker.js`, 'text/javascript'),
    });
    setReady(true);
    setStatus('Motor hazır. Dönüştürme cihazında çalışacak.');
    return ffmpeg;
  };

  const pickFile = (picked) => {
    setFile(picked || null);
    setStatus(''); setProgress(0);
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    outputUrlRef.current = ''; setOutputUrl(''); setOutputName('');
    if (picked) {
      if (picked.size > 500 * 1024 * 1024) setStatus('Dosya 500 MB sınırını aşıyor. Daha küçük bir dosyayla dene.');
      else setStatus('Dosya seçildi. Bu dosya cihazından sunucuya yüklenmeyecek.');
    }
  };

  const convert = async () => {
    if (!file) { setStatus('Önce dönüştürülecek bir dosya seç.'); return; }
    if (file.size > 500 * 1024 * 1024) { setStatus('Bu ilk sürümde en fazla 500 MB dosya seçebilirsin.'); return; }
    if (format === 'mp4' && !file.type.startsWith('video/')) {
      setStatus('MP4 için video dosyası seçmelisin. MP3 seçeneği ses dosyalarından da ses çıkarabilir.'); return;
    }
    setBusy(true); setProgress(0); setStatus('Hazırlanıyor…');
    try {
      const ffmpeg = await loadEngine();
      setStatus('Dosya cihaz belleğine alınıyor…');
      const inputName = `input-${Date.now()}.${(file.name.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}`;
      const ext = format === 'mp3' ? 'mp3' : 'mp4';
      const outName = `${file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_ğüşöçıİĞÜŞÖÇ ]/gi, '').trim() || 'formatfree-cikti'}.${ext}`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      setStatus(format === 'mp3' ? 'Ses MP3 biçimine dönüştürülüyor…' : 'Video MP4 biçimine dönüştürülüyor…');
      const args = format === 'mp3'
        ? ['-i', inputName, '-vn', '-codec:a', 'libmp3lame', '-q:a', '2', outName]
        : ['-i', inputName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outName];
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile(outName);
      const blob = new Blob([data], { type: format === 'mp3' ? 'audio/mpeg' : 'video/mp4' });
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
      const url = URL.createObjectURL(blob);
      outputUrlRef.current = url; setOutputUrl(url); setOutputName(outName);
      setProgress(100);
      setStatus(`Tamamlandı · ${(blob.size / 1024 / 1024).toFixed(2)} MB. Çıktı cihazında hazır.`);
      addHistory(format.toUpperCase() + ' dönüştürme', `${file.name} → ${outName}`);
      try { await ffmpeg.deleteFile(inputName); await ffmpeg.deleteFile(outName); } catch { /* cleanup best effort */ }
    } catch (error) {
      setStatus(`Dönüştürme başarısız oldu: ${error.message || 'Desteklenmeyen dosya veya bellek sınırı'}. Başka bir dosyayla tekrar deneyebilirsin.`);
    } finally { setBusy(false); }
  };

  const player = linkInfo?.provider === 'youtube' && linkInfo.id
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(linkInfo.id)}`
    : linkInfo?.provider === 'spotify' && linkInfo.type && linkInfo.id
      ? `https://open.spotify.com/embed/${linkInfo.type}/${encodeURIComponent(linkInfo.id)}`
      : '';

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" onClick={() => setActiveTab('link')} aria-label="FormatFree Media ana sayfa">
          <span className="brand-mark"><span /></span>
          <span>FormatFree <b>Media</b><small>TOOLS FOR YOUR MEDIA</small></span>
        </a>
        <a className="sibling-link" href="https://formatfree-converter.vercel.app/" target="_blank" rel="noreferrer"><span className="sibling-icon">↗</span> FormatFree Converter</a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="pulse" /> V1.0 · TARAYICINDA ÇALIŞIR</div>
            <h1>Medyan, <span>senin kontrolünde.</span></h1>
            <p>Bağlantıları önizle, uygun dosyaları indir ve kendi medya dosyalarını cihazında dönüştür. Dosyaların bize gönderilmez.</p>
            <div className="hero-points"><span><i>✓</i> Sunucuya dosya yükleme yok</span><span><i>✓</i> Hesap gerekmez</span></div>
          </div>
          <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orb-core"><span>FF</span></div><div className="float-chip chip-a">MP3</div><div className="float-chip chip-b">MP4</div><div className="float-chip chip-c">↗</div></div>
        </section>

        <section className="workspace">
          <div className="tabs" role="tablist" aria-label="Araçlar">
            <button role="tab" aria-selected={activeTab === 'link'} className={activeTab === 'link' ? 'tab active' : 'tab'} onClick={() => setActiveTab('link')}><span>↗</span> Bağlantı aracı</button>
            <button role="tab" aria-selected={activeTab === 'convert'} className={activeTab === 'convert' ? 'tab active' : 'tab'} onClick={() => setActiveTab('convert')}><span>⇄</span> Cihazda dönüştür</button>
            <button role="tab" aria-selected={activeTab === 'history'} className={activeTab === 'history' ? 'tab active' : 'tab'} onClick={() => setActiveTab('history')}><span>◷</span> Geçmiş</button>
          </div>

          {activeTab === 'link' && <section className="panel" aria-labelledby="link-title">
            <div className="panel-heading"><div><div className="section-kicker">BAĞLANTIYI YAPIŞTIR</div><h2 id="link-title">Nereden başlayalım?</h2><p>YouTube, Spotify veya doğrudan bir dosya bağlantısı gir.</p></div><span className="panel-icon">⌁</span></div>
            <form className="url-form" onSubmit={(event) => { event.preventDefault(); analyzeLink(); }}>
              <span className="url-icon">🔗</span><input value={link} onChange={(e) => setLink(e.target.value)} type="url" placeholder="https://… bağlantını buraya yapıştır" aria-label="Medya veya dosya bağlantısı" />
              <button className="primary-btn" type="submit">Bağlantıyı tanı <span>→</span></button>
            </form>
            <div className="supported"><span>Desteklenen bağlantı türleri</span><div className="provider-pills"><span className="provider youtube"><b>▶</b> YouTube</span><span className="provider spotify"><b>◖</b> Spotify</span><span className="provider direct"><b>↓</b> Doğrudan dosya</span></div></div>
            {linkMessage && <div className={`notice ${linkInfo?.provider === 'invalid' ? 'notice-error' : ''}`} role="status"><span>{linkInfo?.provider === 'invalid' ? '!' : 'i'}</span><p>{linkMessage}</p></div>}
            {player && <div className="preview-wrap"><div className="preview-title"><div><b>İçerik önizlemesi</b><small>Resmî oynatıcı · Platform koşulları geçerlidir</small></div><a href={linkInfo.url} target="_blank" rel="noreferrer">Platformda aç ↗</a></div><div className="iframe-box"><iframe src={player} title="Resmî medya önizlemesi" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen loading="lazy" /></div><p className="small-note">Bu önizleme indirme bağlantısı değildir. YouTube ve Spotify içeriklerini dosyaya çıkarma işlemi bu sürümde sunulmaz.</p></div>}
            {linkInfo?.provider === 'direct' && <div className="direct-card"><div className="file-badge">↓</div><div className="direct-copy"><b>Doğrudan bağlantı algılandı</b><span>İndirme, kaynağın izinlerine ve tarayıcı CORS kurallarına bağlı.</span></div><button className="secondary-btn" onClick={downloadDirect} disabled={busy}>{busy ? 'Kontrol ediliyor…' : 'İndirmeyi dene'} <span>↓</span></button><a className="text-link" href={linkInfo.url} target="_blank" rel="noreferrer">Yeni sekmede aç ↗</a></div>}
          </section>}

          {activeTab === 'convert' && <section className="panel" aria-labelledby="convert-title">
            <div className="panel-heading"><div><div className="section-kicker">YEREL İŞLEME</div><h2 id="convert-title">Dosyanı cihazında dönüştür.</h2><p>Bir medya dosyası seç. Dosyan sunucuya yüklenmeden tarayıcı belleğinde işlenir.</p></div><span className="panel-icon">⇄</span></div>
            <button className={`dropzone ${file ? 'has-file' : ''}`} onClick={() => inputRef.current?.click()} type="button" disabled={busy} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0]); }}>
              <span className="upload-icon">↑</span><b>{file ? file.name : 'Dosyanı buraya bırak veya seç'}</b><span>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type || 'Medya dosyası'}` : 'Ses ve video dosyaları · En fazla 500 MB'}</span><em>Dosya seç</em>
            </button>
            <input ref={inputRef} className="hidden-input" type="file" accept="audio/*,video/*,.mp3,.mp4,.wav,.m4a,.aac,.ogg,.webm,.mov,.avi,.mkv" onChange={(e) => pickFile(e.target.files?.[0])} />
            <div className="format-row"><div><label htmlFor="format">Çıktı formatı</label><p>İhtiyacına uygun biçimi seç.</p></div><div className="format-switch"><button type="button" className={format === 'mp3' ? 'format-option chosen' : 'format-option'} onClick={() => setFormat('mp3')}><b>MP3</b><small>Ses</small></button><button type="button" className={format === 'mp4' ? 'format-option chosen' : 'format-option'} onClick={() => setFormat('mp4')}><b>MP4</b><small>Video</small></button></div></div>
            <button className="primary-btn convert-btn" onClick={convert} type="button" disabled={busy || !file}>{busy ? 'İşleniyor…' : 'Dönüştürmeyi başlat'} <span>→</span></button>
            {(busy || status) && <div className="progress-area" role="status"><div className="progress-top"><span>{status}</span><b>{progress}%</b></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>}
            {outputUrl && <div className="output-card"><div className="output-check">✓</div><div className="output-details"><b>Dönüştürme tamamlandı</b><span>{outputName}</span></div><a className="secondary-btn download-output" href={outputUrl} download={outputName}>Dosyayı indir ↓</a></div>}
            <div className="privacy-strip"><span>⌑</span><p><b>Gizlilik notu</b> — Medya dosyan tarayıcının yerel belleğinde işlenir. Dönüştürme motoru ilk kullanımda CDN'den yüklenir; dosya içeriği tarafımıza gönderilmez. Büyük dosyalar cihazını yavaşlatabilir.</p></div>
          </section>}

          {activeTab === 'history' && <section className="panel"><div className="panel-heading"><div><div className="section-kicker">BU CİHAZDA</div><h2>Son işlemler</h2><p>Geçmiş sadece bu tarayıcının yerel depolamasında tutulur.</p></div><span className="panel-icon">◷</span></div>{history.length ? <><div className="history-list">{history.map((item) => <div className="history-item" key={item.id}><span className="history-symbol">✓</span><div><b>{item.label}</b><span>{item.detail}</span><small>{item.date}</small></div></div>)}</div><button className="clear-history" onClick={() => setHistory([])}>Geçmişi temizle</button></> : <div className="empty-state"><span>◷</span><b>Henüz işlem yok</b><p>İndirme veya dönüştürme yaptığında burada görünür.</p></div>}</section>}
        </section>

        <section className="bottom-info"><div><span className="bottom-icon">⌑</span><div><b>Önce gizlilik</b><p>İşlemler, desteklenen durumlarda cihazında gerçekleşir.</p></div></div><div><span className="bottom-icon">⚡</span><div><b>Basit ve hızlı</b><p>Hesap açmadan temel medya araçlarını kullan.</p></div></div><div><span className="bottom-icon">◈</span><div><b>Şeffaf kullanım</b><p>Platform kısıtlamaları gizlenmez veya aşılmaz.</p></div></div></section>
      </main>
      <footer><div className="footer-brand">FormatFree <b>Media</b></div><span>Bağımsız proje · V1.0 · Dosyalar sunucuya yüklenmez</span><span>© {new Date().getFullYear()} FormatFree</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
