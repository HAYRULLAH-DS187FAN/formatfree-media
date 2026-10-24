# FormatFree Media — V1.0 başlangıç projesi

FormatFree Converter'dan bağımsız çalışan, Vercel'e uygun Vite + React uygulaması.

## Özellikler

- Türkçe, mobil uyumlu lacivert arayüz.
- YouTube ve Spotify bağlantıları için resmî gömülü oynatıcı önizlemesi.
- CORS izin veriyorsa doğrudan dosya bağlantısını tarayıcıda indirmeyi deneme.
- Kullanıcının cihazından seçtiği ses/video dosyasını FFmpeg WebAssembly ile tarayıcı içinde MP3 veya MP4'e dönüştürme.
- İşlem geçmişini sadece tarayıcının `localStorage` alanında tutma.
- Sunucu/backend veya kullanıcı hesabı gerektirmez.

## Önemli kapsam notu

YouTube/Spotify bağlantılarından akış kopyalama veya korumalı içeriği MP3/MP4'e çıkarma işlevi yoktur. Bu bağlantılar resmî gömülü oynatıcıda önizlenir. MP3/MP4 dönüştürücü, kullanıcının cihazından seçtiği ve dönüştürme yetkisine sahip olduğu medya dosyaları içindir.

Doğrudan bağlantıdan indirme, hedef sunucunun erişim kurallarına ve tarayıcının CORS politikasına bağlıdır; her URL'de çalışması garanti değildir.

## Yerelde çalıştırma

Node.js LTS ve npm kurulu olmalı.

```bash
npm install
npm run dev
```

Terminalde gösterilen yerel adresi aç.

Üretim derlemesi:

```bash
npm run build
npm run preview
```

## GitHub + Vercel

1. Bu klasörün içeriğini GitHub'da yeni bir `formatfree-media` deposuna yükle.
2. Vercel'de **Add New → Project** yolundan o depoyu içe aktar.
3. Vite ayarları genellikle otomatik algılanır: Build Command `npm run build`, Output Directory `dist`.
4. Dağıtımdan sonra Vercel, projeye uygun bir `*.vercel.app` adresi atar. `formatfree-media.vercel.app` adresi ancak boşta ve kullanılabilir durumdaysa seçilebilir.

## Gizlilik ve teknik notlar

- Kullanıcının seçtiği dosyanın içeriği uygulamanın kendi sunucusuna gönderilmez. FFmpeg WebAssembly ilk kullanımda jsDelivr CDN'sinden indirilir; CDN'den kod yüklenirken CDN tarafında olağan istek metaverileri görülebilir.
- İşlemler cihaz RAM'ini kullanır. Bu nedenle ilk sürümde 500 MB üzerindeki dosyalar reddedilir; daha küçük dosyalarda bile performans cihazdan cihaza değişebilir.
- Dönüştürme motorunun ve kodlayıcıların desteklediği giriş/çıktı biçimleri sınırlı olabilir. Her medya dosyasında başarı garantisi yoktur.
