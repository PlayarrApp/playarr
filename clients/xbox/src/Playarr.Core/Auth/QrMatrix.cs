using System.Collections;
using QRCoder;

namespace Playarr.Core.Auth
{
    /// <summary>The dark modules of a QR code, including its 4-module quiet zone, for the text passed to Encode.</summary>
    public static class QrMatrix
    {
        public static bool[,] Encode(string text)
        {
            using var generator = new QRCodeGenerator();
            using var data = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.M);
            var rows = data.ModuleMatrix;
            var size = rows.Count;
            var modules = new bool[size, size];
            for (var y = 0; y < size; y++)
            {
                BitArray row = rows[y];
                for (var x = 0; x < size; x++)
                {
                    modules[y, x] = row[x];
                }
            }

            return modules;
        }
    }
}
