import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

const FORMATS = ['code_128', 'qr_code', 'ean_13', 'ean_8', 'code_39'];

/**
 * Camera barcode reader (FR-SCAN-2): the browser's BarcodeDetector where it exists (Chrome, Android),
 * otherwise the zxing-wasm ponyfill served from this app, so Safari and Firefox scan too.
 */
export async function createDetector(): Promise<Detector> {
  const Native = (globalThis as any).BarcodeDetector;
  if (Native) {
    try {
      const supported: string[] = await Native.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.includes('code_128') && formats.includes('qr_code')) return new Native({ formats });
    } catch {
      /* fall back to the ponyfill */
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
  return new BarcodeDetector({ formats: FORMATS as any });
}
