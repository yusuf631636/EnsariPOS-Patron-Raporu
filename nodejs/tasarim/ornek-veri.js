// Tasarim onizlemesi icin ORNEK veri (gercek restoran verisi degil) - hem "simdiki" hem "yeni" ekranda ayni veri.
window.ORNEK = {
  businessName: 'Öz Urfa Yusuf Usta',
  updatedAt: Date.now() - 12000,
  data: {
    sales: {
      summary: { sales: 18450, tickets: 142, average: 129.93, remaining: 2310 },
      hourly: [
        { hour: 11, amount: 820, count: 7 }, { hour: 12, amount: 3150, count: 24 }, { hour: 13, amount: 3920, count: 29 },
        { hour: 14, amount: 1780, count: 15 }, { hour: 15, amount: 690, count: 6 }, { hour: 16, amount: 540, count: 5 },
        { hour: 17, amount: 1210, count: 9 }, { hour: 18, amount: 2640, count: 19 }, { hour: 19, amount: 2890, count: 20 }, { hour: 20, amount: 810, count: 8 }
      ],
      products: [
        { name: 'Adana Kebap', quantity: 64, amount: 5120 }, { name: 'İskender', quantity: 41, amount: 3895 },
        { name: 'Lahmacun', quantity: 88, amount: 2640 }, { name: 'Beyti Kebap', quantity: 22, amount: 2090 },
        { name: 'Ayran', quantity: 131, amount: 1310 }, { name: 'Künefe', quantity: 19, amount: 1140 },
        { name: 'Çoban Salata', quantity: 27, amount: 810 }, { name: 'Kola', quantity: 38, amount: 760 }
      ],
      payments: [{ name: 'Kredi Kartı', amount: 11240, count: 86 }, { name: 'Nakit', amount: 5980, count: 49 }, { name: 'Yemek Kartı', amount: 1230, count: 7 }],
      users: [{ name: 'Mehmet', amount: 7210, count: 55 }, { name: 'Ayşe', amount: 6120, count: 48 }, { name: 'Ali', amount: 5120, count: 39 }],
      departments: [{ name: 'Restoran', amount: 14200, count: 108 }, { name: 'Paket Servis', amount: 4250, count: 34 }],
      recent: [{ date: '2026-09-30 20:14:02', number: '142', amount: 185, user: 'Mehmet' }, { date: '2026-09-30 20:09:47', number: '141', amount: 96, user: 'Ayşe' }]
    },
    openTables: {
      tables: [
        { id: '1', table: 'Masa 4', number: '138', total: 640, remaining: 640, user: 'Mehmet', date: '2026-09-30 19:02:11' },
        { id: '2', table: 'Masa 7', number: '140', total: 285, remaining: 285, user: 'Ayşe', date: '2026-09-30 19:48:30' },
        { id: '3', table: 'Bahçe 2', number: '141', total: 1120, remaining: 520, user: 'Ali', date: '2026-09-30 18:31:05' },
        { id: '4', table: 'Masa 11', number: '143', total: 150, remaining: 150, user: 'Mehmet', date: '2026-09-30 20:10:40' }
      ],
      packages: {
        pending: [{ id: '5', table: 'Ahmet Y. · Yıldırım', number: '139', total: 340, remaining: 340, user: 'Paket', date: '2026-09-30 19:58:00' }],
        enroute: [{ id: '6', table: 'Zeynep K. · Osmangazi', number: '137', total: 275, remaining: 275, user: 'Paket', date: '2026-09-30 19:40:00' }]
      }
    },
    notifications: [
      { kind: 'iptal', date: '2026-09-30 19:22:10', ticket: '131', amount: 180, detail: 'Müşteri vazgeçti' },
      { kind: 'iade', date: '2026-09-30 13:05:44', ticket: '58', amount: 95, detail: 'Yanlış ürün' }
    ],
    courier: { orders: [{ courierName: 'Kurye Hasan', packageStatus: 'Yolda' }], deliverySummary: [{ courier_name: 'Kurye Hasan', count: 12, total: 3180 }] }
  },
  // "yeni" tasarimdaki karsilastirmalar icin (dun ayni saate kadar / gecen hafta ayni gun)
  karsilastirma: {
    dunAyniSaat: { sales: 16230, tickets: 131 },
    gecenHafta: { sales: 17100, tickets: 139 },
    dunSaatlik: [640, 2810, 3400, 1920, 720, 480, 1100, 2310, 2250, 600],
    son7Gun: [15200, 16890, 14320, 19870, 22140, 17660, 18450]
  }
};
