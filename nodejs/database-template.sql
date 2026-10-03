/* SambaPOS Patron Raporu veritabani sablonu
   Rapor paneli mevcut SambaPOS tablolarini okur; bu dosya yeni bir isletme
   veritabani olusturmaz ve SambaPOS verisini kopyalamaz.

   Yeni PC kurulumu:
   1. SambaPOS5 veritabanini SQL Server'a geri yukleyin.
   2. Asagidaki kontrolu calistirin.
   3. C:\ensari\config.json icinde database alanina veritabani adini yazin.
*/
IF DB_ID(N'SAMBAPOS5') IS NULL
    PRINT N'UYARI: SAMBAPOS5 veritabani bulunamadi. Once SambaPOS yedegini geri yukleyin.';
ELSE
    PRINT N'OK: SambaPOS veritabani bulundu.';

SELECT DB_NAME() AS CurrentDatabase;
SELECT name AS RequiredTable
FROM (VALUES (N'Tickets'),(N'Orders'),(N'Payments'),(N'TicketEntities'),(N'MenuItems')) AS Required(name)
WHERE OBJECT_ID(QUOTENAME(DB_NAME()) + N'.dbo.' + QUOTENAME(Required.name)) IS NULL;
