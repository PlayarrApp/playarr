using QRCoder;

namespace Playarr.Tizen.Logic;

public static class QrImage
{
    /// <summary>PNG bytes of a QR code, black on white, no quiet zone (the caller pads it).</summary>
    public static byte[] Png(string text, int pixelsPerModule)
    {
        using var data = new QRCodeGenerator().CreateQrCode(text, QRCodeGenerator.ECCLevel.M);
        return new PngByteQRCode(data).GetGraphic(pixelsPerModule, new byte[] { 0, 0, 0 }, new byte[] { 255, 255, 255 }, drawQuietZones: false);
    }
}
