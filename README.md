# Tuya Desktop (Windows)

Klien desktop untuk perangkat **Tuya / Smart Life**, dibuat dengan Electron + TypeScript + React.
Mengontrol perangkat lewat **Tuya Cloud** dan, bila perangkat terjangkau di jaringan yang sama, lewat **LAN** (lebih cepat, tetap jalan tanpa internet).

> Proyek ini **bukan produk resmi Tuya**. Aplikasi resmi bersifat closed-source dan tidak disalin; aplikasi ini memakai Tuya Open API publik dan protokol LAN yang didukung library [`tuyapi`](https://github.com/codetheweb/tuyapi).

## Fitur

| Fitur | Keterangan |
| --- | --- |
| Daftar perangkat | Nama, kategori, status online/offline, indikator LAN |
| Kontrol dasar | Saklar, kecerahan, suhu warna, warna (HSV), mode, tirai, dll. Kontrol dibangun otomatis dari spesifikasi DP tiap perangkat |
| Status realtime | Push dari perangkat via LAN; cloud lewat polling (interval bisa diatur) atau Message Service (opsional, eksperimental) |
| Scene | Menampilkan dan menjalankan scene "Tap-to-Run" dari akun Smart Life |
| Jadwal | Jadwal berulang (hari + jam) atau sekali jalan; aksi = kontrol perangkat atau jalankan scene |
| Hybrid | Perintah dikirim lewat LAN bila tersambung, otomatis jatuh ke cloud bila gagal |
| Tray | Menutup jendela menyembunyikan ke tray agar jadwal tetap berjalan; opsi jalan otomatis saat Windows start |

## Cara memakai

### 1. Siapkan proyek di Tuya IoT Platform (sekali saja)

1. Daftar/masuk di <https://iot.tuya.com> → **Cloud → Development → Create Cloud Project**. Pilih *data center* yang sesuai wilayah akun Smart Life Anda.
2. Di tab **Overview** salin **Access ID** dan **Access Secret**.
3. Tab **Devices → Link Tuya App Account → Add App Account**, lalu scan QR dengan aplikasi Smart Life (*Me → ikon scan*). Perangkat akun itu akan masuk ke proyek.
4. Bila nanti muncul error *permission deny*, subscribe API terkait di tab **Service API** (mis. IoT Core, Authorization Token Management, Device Status Notification, Smart Home Scene Linkage).

### 2. Hubungkan aplikasi

Buka **Pengaturan**, isi Access ID/Secret dan pilih data center yang **sama** dengan proyek, klik **Uji koneksi**, lalu **Simpan pengaturan**. Perangkat akan dimuat otomatis.

- **UID akun aplikasi** (opsional): jika diisi, daftar perangkat dan rumah diambil per akun. Jika kosong, semua perangkat proyek dimuat.
- **LAN**: kunci lokal perangkat diambil otomatis dari cloud; IP ditemukan lewat broadcast UDP (port 6666/6667/7000). Windows mungkin meminta izin firewall saat pertama kali.
- Kredensial disimpan terenkripsi (DPAPI via Electron `safeStorage`) dan tidak pernah dikirim kembali ke antarmuka.

## Pengembangan

```bash
npm install
npm run dev          # jalankan aplikasi dengan hot reload
npm test             # tes unit (Vitest)
npm run typecheck
npm run build        # build main/preload/renderer ke ./out
npm run dist:win     # buat installer Windows (NSIS) di ./dist
```

Untuk melihat UI tanpa Electron/perangkat, jalankan renderer di browser biasa — bila `window.tuya` tidak ada, aplikasi otomatis memakai bridge tiruan (`src/renderer/src/mock.ts`) dengan data contoh.

Installer Windows juga dibangun otomatis oleh GitHub Actions (`.github/workflows/build-windows.yml`); hasilnya ada di *Artifacts* tiap run.

### Struktur

```
src/
  shared/      tipe, wilayah Tuya, helper DP & warna (dipakai main + renderer)
  main/
    tuya/      sign.ts (tanda tangan HMAC) · cloud.ts (OpenAPI) · local.ts (LAN + discovery) · pulsar.ts (realtime)
    manager.ts   gabungan cloud + LAN + realtime; memilih jalur kontrol
    scheduler.ts penjadwal di dalam aplikasi
    controller.ts perekat layanan (tanpa dependensi Electron → mudah diuji)
    store.ts · ipc.ts · index.ts
  preload/     jembatan aman (contextBridge) → window.tuya
  renderer/    UI React
tests/         tes unit
```

Keamanan Electron: `contextIsolation`, `sandbox`, tanpa `nodeIntegration`, CSP ketat pada build produksi, navigasi/jendela baru diblokir, dan setiap handler IPC memeriksa asal pengirim serta bentuk argumen.

## Status verifikasi — baca ini

Pengembangan dilakukan di container Linux **tanpa akses ke server Tuya, tanpa perangkat Tuya, dan tanpa Windows**. Karena itu:

**Sudah diuji otomatis** (86 tes unit + smoke test Electron di Xvfb + screenshot UI):
- struktur & perhitungan tanda tangan request (dihitung ulang secara independen), cache/refresh token, pemetaan error, paging, pemecahan batch
- penggabungan spesifikasi DP, konversi warna, penjadwal (termasuk anti-dobel, jadwal sekali jalan, kegagalan)
- penyimpanan kredensial terenkripsi/fallback, validasi pengaturan, validasi IPC
- routing LAN → cloud, pemetaan DP ↔ kode, reconnect LAN dengan backoff, dekode paket broadcast (memakai encoder tuyapi)
- dekripsi & dekode pesan Message Service (dengan data buatan sendiri)
- aplikasi benar-benar berjalan di Electron (preload, IPC, sandbox), UI di tema gelap & terang, dan kemasan `win-unpacked` terbentuk dengan isi asar yang benar

**Belum bisa diverifikasi — kemungkinan perlu penyesuaian setelah dicoba dengan akun & perangkat sungguhan:**
- Respons asli Tuya OpenAPI. Beberapa endpoint ditulis dari dokumentasi publik/ingatan dan tidak bisa dikonfirmasi dari sini: `/v1.0/devices/status` (status massal; ada cadangan per-perangkat), `/v2.0/cloud/thing/{id}/shadow/properties` (pemetaan DP untuk LAN), `/v1.1/homes/{id}/scenes` dan `.../trigger`, serta daftar perangkat `/v2.0/cloud/thing/device`.
- Mengirim warna lewat cloud sebagai objek JSON (bukan string).
- Kontrol LAN ke perangkat nyata, terutama protokol 3.4/3.5 dan format heksadesimal warna lokal (v1 `rrggbb`+`hhhhssvv`, v2 `hhhhssssvvvv`).
- Message Service (Pulsar): turunan kata sandi WebSocket, endpoint (Singapura belum diketahui → isi manual), dan enkripsi AES-GCM (hanya AES-ECB yang didukung). Karena itu fitur ini default **mati**; polling & LAN tetap jalan.
- Perilaku khusus Windows: tray, DPAPI, login otomatis, installer NSIS, dialog firewall.

Semua kegagalan dicatat di **Pengaturan → Log**, sehingga mudah dilacak.

## Keterbatasan

- Jadwal dijalankan oleh aplikasi ini (bukan timer di perangkat/cloud): aplikasi harus tetap hidup (boleh di tray). Jadwal yang terlewat saat aplikasi mati tidak dijalankan.
- Belum ada pairing perangkat baru, kamera/streaming, automasi berbasis kondisi, atau perangkat manual (tanpa cloud).
- Hanya Windows yang dikonfigurasi untuk rilis; kode inti tidak bergantung pada Windows.
