// scrypt (RFC 7914) - Node crypto.scryptSync(password, salt, 64) ile AYNI sonuc (N=16384, r=8, p=1).
// Kurulu restoranlardaki Patron sifreleri (patron-auth.json) bu yontemle saklandigi icin C# surumu
// ayni hash'i uretmek zorunda - yoksa guncelleme sonrasi kimse giris yapamazdi.
// Node: salt HEX METIN olarak verilir (ör. "a1b2..."), yani tuz = bu metnin UTF-8 baytlari.
using System;
using System.Security.Cryptography;
using System.Text;

namespace Patron
{
    public static class Scrypt
    {
        public static string HashHex(string password, string salt)
        {
            byte[] dk = Derive(Encoding.UTF8.GetBytes(password ?? ""), Encoding.UTF8.GetBytes(salt ?? ""), 16384, 8, 1, 64);
            var sb = new StringBuilder(dk.Length * 2);
            foreach (byte b in dk) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        public static byte[] Derive(byte[] P, byte[] S, int N, int r, int p, int dkLen)
        {
            int blockLen = 128 * r;
            byte[] B = Pbkdf2Sha256(P, S, 1, p * blockLen);
            var X = new uint[32 * r];
            var V = new uint[32 * r * N];
            var T = new uint[32 * r];
            for (int i = 0; i < p; i++)
            {
                int off = i * blockLen;
                for (int k = 0; k < 32 * r; k++) X[k] = BitConverter.ToUInt32(B, off + k * 4);
                RoMix(X, V, T, N, r);
                for (int k = 0; k < 32 * r; k++) { var bytes = BitConverter.GetBytes(X[k]); Buffer.BlockCopy(bytes, 0, B, off + k * 4, 4); }
            }
            return Pbkdf2Sha256(P, B, 1, dkLen);
        }

        static void RoMix(uint[] X, uint[] V, uint[] T, int N, int r)
        {
            int n = 32 * r;
            for (int i = 0; i < N; i++) { Array.Copy(X, 0, V, i * n, n); BlockMix(X, T, r); }
            for (int i = 0; i < N; i++)
            {
                int j = (int)(X[(2 * r - 1) * 16] & (uint)(N - 1));
                for (int k = 0; k < n; k++) X[k] ^= V[j * n + k];
                BlockMix(X, T, r);
            }
        }

        // BlockMix: Y = X; X[i] = Salsa(X[i-1] ^ B[i]); cikti sirasi: cift indeksler, sonra tekler
        static void BlockMix(uint[] B, uint[] Y, int r)
        {
            var x = new uint[16];
            Array.Copy(B, (2 * r - 1) * 16, x, 0, 16);
            for (int i = 0; i < 2 * r; i++)
            {
                for (int k = 0; k < 16; k++) x[k] ^= B[i * 16 + k];
                Salsa208(x);
                int dest = (i % 2 == 0 ? i / 2 : r + i / 2) * 16;
                Array.Copy(x, 0, Y, dest, 16);
            }
            Array.Copy(Y, 0, B, 0, 32 * r);
        }

        static uint R(uint a, int b) { return (a << b) | (a >> (32 - b)); }
        static void Salsa208(uint[] B)
        {
            uint x0 = B[0], x1 = B[1], x2 = B[2], x3 = B[3], x4 = B[4], x5 = B[5], x6 = B[6], x7 = B[7],
                 x8 = B[8], x9 = B[9], x10 = B[10], x11 = B[11], x12 = B[12], x13 = B[13], x14 = B[14], x15 = B[15];
            for (int i = 0; i < 8; i += 2)
            {
                x4 ^= R(x0 + x12, 7); x8 ^= R(x4 + x0, 9); x12 ^= R(x8 + x4, 13); x0 ^= R(x12 + x8, 18);
                x9 ^= R(x5 + x1, 7); x13 ^= R(x9 + x5, 9); x1 ^= R(x13 + x9, 13); x5 ^= R(x1 + x13, 18);
                x14 ^= R(x10 + x6, 7); x2 ^= R(x14 + x10, 9); x6 ^= R(x2 + x14, 13); x10 ^= R(x6 + x2, 18);
                x3 ^= R(x15 + x11, 7); x7 ^= R(x3 + x15, 9); x11 ^= R(x7 + x3, 13); x15 ^= R(x11 + x7, 18);
                x1 ^= R(x0 + x3, 7); x2 ^= R(x1 + x0, 9); x3 ^= R(x2 + x1, 13); x0 ^= R(x3 + x2, 18);
                x6 ^= R(x5 + x4, 7); x7 ^= R(x6 + x5, 9); x4 ^= R(x7 + x6, 13); x5 ^= R(x4 + x7, 18);
                x11 ^= R(x10 + x9, 7); x8 ^= R(x11 + x10, 9); x9 ^= R(x8 + x11, 13); x10 ^= R(x9 + x8, 18);
                x12 ^= R(x15 + x14, 7); x13 ^= R(x12 + x15, 9); x14 ^= R(x13 + x12, 13); x15 ^= R(x14 + x13, 18);
            }
            B[0] += x0; B[1] += x1; B[2] += x2; B[3] += x3; B[4] += x4; B[5] += x5; B[6] += x6; B[7] += x7;
            B[8] += x8; B[9] += x9; B[10] += x10; B[11] += x11; B[12] += x12; B[13] += x13; B[14] += x14; B[15] += x15;
        }

        static byte[] Pbkdf2Sha256(byte[] password, byte[] salt, int iterations, int dkLen)
        {
            var result = new byte[dkLen];
            using (var h = new HMACSHA256(password))
            {
                int blocks = (dkLen + 31) / 32, pos = 0;
                var buf = new byte[salt.Length + 4];
                Buffer.BlockCopy(salt, 0, buf, 0, salt.Length);
                for (int i = 1; i <= blocks; i++)
                {
                    buf[salt.Length] = (byte)(i >> 24); buf[salt.Length + 1] = (byte)(i >> 16); buf[salt.Length + 2] = (byte)(i >> 8); buf[salt.Length + 3] = (byte)i;
                    byte[] u = h.ComputeHash(buf), t = (byte[])u.Clone();
                    for (int c = 1; c < iterations; c++) { u = h.ComputeHash(u); for (int k = 0; k < t.Length; k++) t[k] ^= u[k]; }
                    int n = Math.Min(32, dkLen - pos);
                    Buffer.BlockCopy(t, 0, result, pos, n);
                    pos += n;
                }
            }
            return result;
        }
    }
}
