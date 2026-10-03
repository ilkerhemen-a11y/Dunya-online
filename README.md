# Taht Savaşları Mobil

Taht Savaşları'nın mobil arayüzü ve Android uygulaması. APK yatay açılır; giriş ve oyun ekranı kısa yatay telefon ekranlarına uyarlanır. Mevcut Socket.IO olayları ve oyun kuralları korunur. Beş ana sekmeli alt menü ve diğer ekranlar için açılır bölüm menüsü kullanılır.

## Çalıştırma

Node.js gereklidir. Kaynak projedeki bağımlılıklar ve kilit dosyası pakettedir.

Geçici ve ayrı bir MongoDB ile oyunu test etmek için:

```bash
npm ci
npm run start:test
```

`http://localhost:3000` adresini açın. İlk başlatmada test MongoDB ikili dosyası indirilir; test sunucusu kapatıldığında test verileri silinir. Kayıt, giriş, dört görev, asker yetiştirme ve kale saldırısını otomatik doğrulamak için `npm run test:e2e` çalıştırın.

Kalıcı bir MongoDB bağlantısıyla çalıştırmak için:

```bash
npm ci
MONGO_URI=mongodb://localhost:27017/throne_war_mobile npm start
```

Tarayıcıdan `http://localhost:3000` adresini açın. Telefonda denemek için telefonun aynı ağdaki bilgisayara erişmesi ve sunucunun uygun adres/port üzerinden erişilebilir olması gerekir. İnternete açılacak sürüm HTTPS üzerinden sunulmalıdır.

## Android APK

`android/` projesi Android Studio veya GitHub Actions ile derlenir. Uygulama `https://dunya-online.onrender.com/` adresine bağlanır; çevrim dışı çalışmaz. `sensorLandscape` telefonun her iki yatay yönünü destekler. Yeni sürümün `versionCode` değeri önceki APK'den yüksek olmalıdır.

## Kapsam

- Android APK yatay açılır. Kurulu web uygulamasının manifesti de yatay yön ister; sıradan tarayıcı sekmesinde yönü işletim sistemi belirler.
- Alt menü: Durum, Görev, Savaş, Market, Diğer. Bütün eski bölümler açılır menüde bulunur. Ana ekranda dört hızlı erişim kartı; savaş ekranında birlik yetiştirme ve kuşatma adımlarına götüren özet bulunur.
- Oyun çevrim içidir. MongoDB ve Node sunucusu olmadan giriş, savaş veya envanter çalışmaz.
- Yerel test ayrı ve geçici bir MongoDB kullanır; canlı kullanıcı verileriyle karışmaz.

Canlı sürüm `Dunya-online` GitHub deposundan Render'a dağıtılır.
