using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using System.Threading.Tasks;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Hosting;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Grabs the window as the compositor presents it (Windows.Graphics.Capture of the root visual), which is the frame a
    /// screenshot shows. RenderTargetBitmap re-renders the XAML tree on its own and omits text the screen does show, so the
    /// layout export's visibility pass compares these frames instead. A failure to capture is an error, never a fallback.
    /// </summary>
    internal static class ScreenGrab
    {
        private static readonly object Gate = new object();
        private static IDirect3DDevice? _device;
        private static Direct3D11CaptureFramePool? _pool;
        private static GraphicsCaptureSession? _session;
        private static UIElement? _rootOfSession;
        private static byte[]? _latest;
        private static int _width;
        private static int _height;
        private static int _pending;
        private static long _arrived;

        [DllImport("d3d11.dll")]
        private static extern int D3D11CreateDevice(IntPtr adapter, uint driverType, IntPtr software, uint flags, IntPtr levels, uint levelCount, uint sdkVersion, out IntPtr device, out uint level, out IntPtr context);

        [DllImport("d3d11.dll")]
        private static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

        private static IDirect3DDevice CreateDevice()
        {
            IntPtr device;
            // Hardware first; the software rasteriser (WARP) when the machine has no usable adapter.
            var hr = D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out device, out _, out var context);
            if (hr < 0)
            {
                hr = D3D11CreateDevice(IntPtr.Zero, 5, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out device, out _, out context);
            }

            Marshal.ThrowExceptionForHR(hr);
            if (context != IntPtr.Zero)
            {
                Marshal.Release(context);
            }

            var dxgiIid = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device, ref dxgiIid, out var dxgi));
            try
            {
                Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out var inspectable));
                try
                {
                    return (IDirect3DDevice)Marshal.GetObjectForIUnknown(inspectable);
                }
                finally
                {
                    Marshal.Release(inspectable);
                }
            }
            finally
            {
                Marshal.Release(dxgi);
                Marshal.Release(device);
            }
        }

        private static void Start(FrameworkElement root)
        {
            _session?.Dispose();
            _pool?.Dispose();
            _latest = null;
            _device ??= CreateDevice();
            var item = GraphicsCaptureItem.CreateFromVisual(ElementCompositionPreview.GetElementVisual(root));
            _pool = Direct3D11CaptureFramePool.CreateFreeThreaded(_device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, item.Size);
            _pool.FrameArrived += OnFrame;
            _session = _pool.CreateCaptureSession(item);
            if (Windows.Foundation.Metadata.ApiInformation.IsPropertyPresent("Windows.Graphics.Capture.GraphicsCaptureSession", "IsCursorCaptureEnabled"))
            {
                _session.IsCursorCaptureEnabled = false;
            }

            _session.StartCapture();
            _rootOfSession = root;
        }

        private static async void OnFrame(Direct3D11CaptureFramePool sender, object args)
        {
            Interlocked.Increment(ref _pending);
            try
            {
                using var frame = sender.TryGetNextFrame();
                if (frame == null)
                {
                    return;
                }

                using var bitmap = await SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface);
                using var bgra = bitmap.BitmapPixelFormat == BitmapPixelFormat.Bgra8 ? SoftwareBitmap.Copy(bitmap) : SoftwareBitmap.Convert(bitmap, BitmapPixelFormat.Bgra8);
                var buffer = new Windows.Storage.Streams.Buffer((uint)(bgra.PixelWidth * bgra.PixelHeight * 4));
                bgra.CopyToBuffer(buffer);
                var bytes = buffer.ToArray();
                lock (Gate)
                {
                    _latest = bytes;
                    _width = bgra.PixelWidth;
                    _height = bgra.PixelHeight;
                    _arrived++;
                }
            }
            catch
            {
                // A frame that cannot be read leaves the previous one; the caller times out if none ever arrives.
            }
            finally
            {
                Interlocked.Decrement(ref _pending);
            }
        }

        /// <summary>The latest composed frame (BGRA, premultiplied) once the compositor has had time to present the last change.</summary>
        public static async Task<(byte[] Pixels, int Width, int Height)> GrabAsync(FrameworkElement root)
        {
            if (_rootOfSession != root || _session == null)
            {
                Start(root);
            }

            // A capture delivers a frame only when the screen changes: give a change time to arrive and be read, then take the latest.
            await Task.Delay(150);
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while ((Volatile.Read(ref _pending) > 0 || Volatile.Read(ref _latest) == null) && DateTime.UtcNow < deadline)
            {
                await Task.Delay(20);
            }

            lock (Gate)
            {
                if (_latest == null)
                {
                    throw new InvalidOperationException("No composed frame arrived from the screen capture.");
                }

                return (_latest, _width, _height);
            }
        }
    }
}
